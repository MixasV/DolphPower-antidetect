import { v4 as uuidv4 } from 'uuid';
import { Database } from 'sqlite3';
import { Proxy } from '../database/schema';
import { ProxyManager } from './proxy-manager';
import { FreeProxyFetcher } from './free-proxy-fetcher';
import { EncryptionService } from './encryption-service';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Interface for proxy performance metrics
 */
interface ProxyMetrics {
    proxyId: string;
    successRate: number; // 0-1
    averageLatency: number; // ms
    lastTested: number; // timestamp
    testCount: number;
    consecutiveFailures: number;
    isActive: boolean;
    country?: string;
    anonymityLevel?: string; // 'elite', 'anonymous', 'transparent'
}

/**
 * Advanced proxy manager with health monitoring, scoring, and intelligent rotation
 */
export class AdvancedProxyManager {
    private readonly db: Database;
    private readonly proxyManager: ProxyManager;
    private readonly freeProxyFetcher: FreeProxyFetcher;
    private readonly encryptionService: EncryptionService;
    private readonly metricsPath: string;
    private readonly TEST_INTERVAL_MS = 300000; // 5 minutes
    private readonly MAX_CONSECUTIVE_FAILURES = 3;
    private readonly MIN_SUCCESS_RATE = 0.5; // 50%

    constructor(db: Database) {
        this.db = db;
        this.proxyManager = new ProxyManager(db);
        this.freeProxyFetcher = new FreeProxyFetcher(db);
        this.encryptionService = EncryptionService;
        this.metricsPath = path.join(os.homedir(), '.antidetect', 'proxy_metrics.json');
        
        // Initialize metrics storage
        this.initializeMetricsStorage();
    }

    private async initializeMetricsStorage(): Promise<void> {
        try {
            await fs.mkdir(path.dirname(this.metricsPath), { recursive: true });
            await fs.access(this.metricsPath);
        } catch (error) {
            // File doesn't exist, create empty metrics object
            await fs.writeFile(this.metricsPath, JSON.stringify({}), { encoding: 'utf8' });
        }
    }

    private async loadMetrics(): Promise<Record<string, ProxyMetrics>> {
        try {
            const data = await fs.readFile(this.metricsPath, { encoding: 'utf8' });
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    private async saveMetrics(metrics: Record<string, ProxyMetrics>): Promise<void> {
        await fs.writeFile(this.metricsPath, JSON.stringify(metrics, null, 2), { encoding: 'utf8' });
    }

    /**
     * Test a proxy and update its metrics
     */
    async testAndUpdateProxyMetrics(proxyId: string): Promise<ProxyMetrics> {
        const proxy = await this.proxyManager.getProxy(proxyId);
        if (!proxy) {
            throw new Error(`Proxy not found: ${proxyId}`);
        }

        try {
            const result = await this.proxyManager.testProxy(proxyId);
            
            // Load existing metrics
            const metrics = await this.loadMetrics();
            const existing = metrics[proxyId] || {
                proxyId,
                successRate: 0.5, // Start neutral
                averageLatency: 0,
                lastTested: Date.now(),
                testCount: 0,
                consecutiveFailures: 0,
                isActive: true
            };

            // Update metrics
            const newTestCount = existing.testCount + 1;
            const success = result.success ? 1 : 0;
            
            // Calculate new success rate (weighted average)
            const newSuccessRate = ((existing.successRate * existing.testCount) + success) / newTestCount;
            
            // Calculate new average latency (only if successful)
            let newAverageLatency = existing.averageLatency;
            if (result.success && result.latency !== undefined) {
                if (existing.averageLatency === 0) {
                    newAverageLatency = result.latency;
                } else {
                    // Weighted average for latency
                    newAverageLatency = ((existing.averageLatency * (existing.testCount - 1)) + result.latency) / existing.testCount;
                }
            }
            
            // Update consecutive failures
            let newConsecutiveFailures = existing.consecutiveFailures;
            if (result.success) {
                newConsecutiveFailures = 0;
            } else {
                newConsecutiveFailures = existing.consecutiveFailures + 1;
            }
            
            // Determine if proxy should be active
            const isActive = newSuccessRate >= this.MIN_SUCCESS_RATE && 
                           newConsecutiveFailures < this.MAX_CONSECUTIVE_FAILURES;

            // Try to get geographic info from the proxy test
            let country: string | undefined;
            let anonymityLevel: string | undefined;
            // In a real implementation, we'd extract this from the proxy test result
            // For now, we'll keep it undefined

            const updatedMetrics: ProxyMetrics = {
                proxyId,
                successRate: newSuccessRate,
                averageLatency: newAverageLatency,
                lastTested: Date.now(),
                testCount: newTestCount,
                consecutiveFailures: newConsecutiveFailures,
                isActive,
                country,
                anonymityLevel
            };

            // Save updated metrics
            metrics[proxyId] = updatedMetrics;
            await this.saveMetrics(metrics);

            return updatedMetrics;
        } catch (error) {
            // Even if test fails, we should update metrics to reflect the failure
            const metrics = await this.loadMetrics();
            const existing = metrics[proxyId] || {
                proxyId,
                successRate: 0.5,
                averageLatency: 0,
                lastTested: Date.now(),
                testCount: 0,
                consecutiveFailures: 0,
                isActive: true
            };

            const newTestCount = existing.testCount + 1;
            const newSuccessRate = (existing.successRate * existing.testCount) / newTestCount;
            const newConsecutiveFailures = existing.consecutiveFailures + 1;
            const isActive = newSuccessRate >= this.MIN_SUCCESS_RATE && 
                           newConsecutiveFailures < this.MAX_CONSECUTIVE_FAILURES;

            const updatedMetrics: ProxyMetrics = {
                proxyId,
                successRate: newSuccessRate,
                averageLatency: existing.averageLatency,
                lastTested: Date.now(),
                testCount: newTestCount,
                consecutiveFailures: newConsecutiveFailures,
                isActive,
                country: existing.country,
                anonymityLevel: existing.anonymityLevel
            };

            metrics[proxyId] = updatedMetrics;
            await this.saveMetrics(metrics);

            return updatedMetrics;
        }
    }

    /**
     * Get the best proxy based on metrics
     */
    async getBestProxy(options: { 
        excludeIds?: string[]; 
        minSuccessRate?: number;
        maxLatency?: number;
        requireActive?: boolean;
        country?: string;
        anonymityLevel?: string;
    } = {}): Promise<Proxy | null> {
        const {
            excludeIds = [],
            minSuccessRate = 0.3,
            maxLatency = 5000, // 5 seconds
            requireActive = true,
            country,
            anonymityLevel
        } = options;

        // Get all proxies
        const proxies = await this.proxyManager.listProxies();
        
        // Filter out excluded proxies
        const filteredProxies = proxies.filter(p => !excludeIds.includes(p.id));
        
        if (filteredProxies.length === 0) {
            return null;
        }

        // Load metrics
        const metrics = await this.loadMetrics();
        
        // Score and filter proxies
        const scoredProxies = await Promise.all(
            filteredProxies.map(async (proxy) => {
                const proxyMetrics = metrics[proxy.id] || {
                    proxyId: proxy.id,
                    successRate: 0.5,
                    averageLatency: 0,
                    lastTested: Date.now(),
                    testCount: 0,
                    consecutiveFailures: 0,
                    isActive: true
                };

                // Check if proxy meets criteria
                if (requireActive && !proxyMetrics.isActive) {
                    return null;
                }
                
                if (proxyMetrics.successRate < minSuccessRate) {
                    return null;
                }
                
                if (proxyMetrics.averageLatency > maxLatency && proxyMetrics.averageLatency > 0) {
                    return null;
                }
                
                if (country && proxyMetrics.country && proxyMetrics.country !== country) {
                    return null;
                }
                
                if (anonymityLevel && proxyMetrics.anonymityLevel && proxyMetrics.anonymityLevel !== anonymityLevel) {
                    return null;
                }

                // Calculate score (higher is better)
                // Weight: 60% success rate, 40% inverse latency (normalized)
                const latencyScore = proxyMetrics.averageLatency > 0 
                    ? Math.max(0, 1 - (proxyMetrics.averageLatency / 10000)) // Normalize to 0-1, 10s max
                    : 0.5; // Unknown latency gets neutral score
                
                const score = (proxyMetrics.successRate * 0.6) + (latencyScore * 0.4);
                
                return { proxy, metrics: proxyMetrics, score };
            })
        );

        // Filter out nulls and sort by score
        const validProxies = scoredProxies
            .filter((p): p is NonNullable<typeof p> => p !== null)
            .sort((a, b) => b.score - a.score);

        return validProxies.length > 0 ? validProxies[0].proxy : null;
    }

    /**
     * Get a list of proxies sorted by performance
     */
    async getProxiesByPerformance(options: { 
        limit?: number; 
        minSuccessRate?: number;
        requireActive?: boolean;
    } = {}): Promise<Array<{ proxy: Proxy; metrics: ProxyMetrics }>> {
        const { limit = 10, minSuccessRate = 0, requireActive = true } = options;
        
        // Get all proxies
        const proxies = await this.proxyManager.listProxies();
        
        // Load metrics
        const metrics = await this.loadMetrics();
        
        // Combine proxies with their metrics
        const proxyMetricsList = await Promise.all(
            proxies.map(async (proxy) => {
                const proxyMetrics = metrics[proxy.id] || {
                    proxyId: proxy.id,
                    successRate: 0.5,
                    averageLatency: 0,
                    lastTested: Date.now(),
                    testCount: 0,
                    consecutiveFailures: 0,
                    isActive: true
                };

                if (requireActive && !proxyMetrics.isActive) {
                    return null;
                }
                
                if (proxyMetrics.successRate < minSuccessRate) {
                    return null;
                }

                return { proxy, metrics: proxyMetrics };
            })
        );

        // Filter out nulls and sort by success rate then latency
        const validList = proxyMetricsList
            .filter((p): p is NonNullable<typeof p> => p !== null)
            .sort((a, b) => {
                if (b.metrics.successRate !== a.metrics.successRate) {
                    return b.metrics.successRate - a.metrics.successRate;
                }
                // If success rates are equal, sort by latency (lower is better)
                const latencyA = a.metrics.averageLatency === 0 ? Infinity : a.metrics.averageLatency;
                const latencyB = b.metrics.averageLatency === 0 ? Infinity : b.metrics.averageLatency;
                return latencyA - latencyB;
            });

        return limit > 0 ? validList.slice(0, limit) : validList;
    }

    /**
     * Automatically test all proxies and update their metrics
     */
    async testAllProxies(): Promise<void> {
        const proxies = await this.proxyManager.listProxies();
        
        // Test proxies concurrently but limit concurrency to avoid overwhelming network
        const batchSize = 5;
        for (let i = 0; i < proxies.length; i += batchSize) {
            const batch = proxies.slice(i, i + batchSize);
            await Promise.all(
                batch.map(proxy => this.testAndUpdateProxyMetrics(proxy.id))
            );
            
            // Small delay between batches to be nice to networks
            if (i + batchSize < proxies.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    /**
     * Fetch free proxies and add them to the system
     */
    async fetchAndAddFreeProxies(protocol: 'http' | 'https' | 'socks5' = 'http', limit: number = 50): Promise<{ added: number; failed: number }> {
        try {
            const freeProxies = await this.freeProxyFetcher.fetchFromProxyScrape(protocol, 10000);
            
            let added = 0;
            let failed = 0;
            
            // Limit to requested number
            const proxiesToAdd = freeProxies.slice(0, limit);
            
            for (const proxyData of proxiesToAdd) {
                try {
                    await this.proxyManager.createProxy(
                        `Free Proxy ${Date.now()}-${added + 1}`,
                        proxyData.protocol,
                        proxyData.host,
                        proxyData.port,
                        undefined, // username
                        undefined  // password
                    );
                    added++;
                } catch (error) {
                    failed++;
                    console.warn(`Failed to add free proxy ${proxyData.host}:${proxyData.port}:`, error);
                }
            }
            
            return { added, failed };
        } catch (error) {
            console.error('Failed to fetch free proxies:', error);
            return { added: 0, failed: 0 };
        }
    }

    /**
     * Get proxy recommendations for different use cases
     */
    async getProxyRecommendations(): Promise<{
        bestOverall: Proxy | null;
        bestForSpeed: Proxy | null;
        bestForReliability: Proxy | null;
        fastest: Proxy | null;
        mostReliable: Proxy | null;
    }> {
        // Get top performers
        const topProxies = await this.getProxiesByPerformance({ limit: 20, requireActive: true, minSuccessRate: 0.3 });
        
        if (topProxies.length === 0) {
            return {
                bestOverall: null,
                bestForSpeed: null,
                bestForReliability: null,
                fastest: null,
                mostReliable: null
            };
        }

        // Best overall: balanced score (already sorted by our performance algorithm)
        const bestOverall = topProxies[0].proxy;
        
        // Best for reliability: highest success rate
        const bestForReliabilityProxy = topProxies.reduce((best, current) => 
            current.metrics.successRate > best.metrics.successRate ? current : best, 
            topProxies[0]
        ).proxy;
        
        // Best for speed: lowest latency (among those with reasonable success rate)
        const speedCandidates = topProxies.filter(p => p.metrics.successRate >= 0.5);
        const bestForSpeedProxy = speedCandidates.length > 0
            ? speedCandidates.reduce((best, current) => 
                (current.metrics.averageLatency === 0 ? Infinity : current.metrics.averageLatency) < 
                (best.metrics.averageLatency === 0 ? Infinity : best.metrics.averageLatency) ? current : best
              , speedCandidates[0]).proxy
            : topProxies[0].proxy; // Fallback to best overall
        
        // Fastest: lowest latency (regardless of success rate, but must be active)
        const allProxies = await this.proxyManager.listProxies();
        const metrics = await this.loadMetrics();
        const fastestProxy = allProxies
            .map(p => {
                const m = metrics[p.id] || {
                    proxyId: p.id,
                    successRate: 0.5,
                    averageLatency: 0,
                    lastTested: Date.now(),
                    testCount: 0,
                    consecutiveFailures: 0,
                    isActive: true
                };
                return { proxy: p, metrics: m };
            })
            .filter(p => p.metrics.isActive)
            .sort((a, b) => {
                const latencyA = a.metrics.averageLatency === 0 ? Infinity : a.metrics.averageLatency;
                const latencyB = b.metrics.averageLatency === 0 ? Infinity : b.metrics.averageLatency;
                return latencyA - latencyB;
            })[0]?.proxy ?? null;
        
        // Most reliable: highest success rate with minimum tests
        const mostReliableProxy = allProxies
            .map(p => {
                const m = metrics[p.id] || {
                    proxyId: p.id,
                    successRate: 0.5,
                    averageLatency: 0,
                    lastTested: Date.now(),
                    testCount: 0,
                    consecutiveFailures: 0,
                    isActive: true
                };
                return { proxy: p, metrics: m };
            })
            .filter(p => p.metrics.testCount >= 3) // At least 3 tests
            .sort((a, b) => b.metrics.successRate - a.metrics.successRate)[0]?.proxy ?? null;

        return {
            bestOverall,
            bestForSpeed: bestForSpeedProxy,
            bestForReliability: bestForReliabilityProxy,
            fastest: fastestProxy,
            mostReliable: mostReliableProxy
        };
    }
}

// Singleton instance
let advancedProxyManager: AdvancedProxyManager | null = null;

export function getAdvancedProxyManager(db: Database): AdvancedProxyManager {
    if (!advancedProxyManager) {
        advancedProxyManager = new AdvancedProxyManager(db);
    }
    return advancedProxyManager;
}
