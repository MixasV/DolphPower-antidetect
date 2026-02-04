import axios from 'axios';
import { Database } from './database';

export interface FreeProxy {
    host: string;
    port: number;
    protocol: 'http' | 'https' | 'socks4' | 'socks5';
    country?: string;
    countryCode?: string;
    anonymity?: string;
    speed?: number;
    lastChecked?: Date;
}

export class FreeProxyFetcher {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    async fetchFromProxyScrape(protocol: string = 'http', timeout: number = 5000): Promise<FreeProxy[]> {
        const proxies: FreeProxy[] = [];
        
        try {
            const url = `https://api.proxyscrape.com/v2/?request=displayproxies&protocol=${protocol}&timeout=${timeout}&country=all&ssl=all&anonymity=all`;
            const response = await axios.get(url, { timeout: 10000 });
            
            const lines = response.data.split('\n').filter((line: string) => line.trim());
            
            for (const line of lines) {
                const [host, portStr] = line.trim().split(':');
                const port = parseInt(portStr);
                
                if (host && port && !isNaN(port)) {
                    proxies.push({
                        host,
                        port,
                        protocol: protocol as 'http' | 'https' | 'socks4' | 'socks5'
                    });
                }
            }
        } catch (error) {
            console.error('Failed to fetch from ProxyScrape:', error);
        }
        
        return proxies;
    }

    async fetchFromGeoNode(limit: number = 100): Promise<FreeProxy[]> {
        const proxies: FreeProxy[] = [];
        
        try {
            const url = `https://proxylist.geonode.com/api/proxy-list?limit=${limit}&page=1&sort_by=lastChecked&sort_type=desc`;
            const response = await axios.get(url, { timeout: 10000 });
            
            if (response.data && response.data.data) {
                for (const p of response.data.data) {
                    proxies.push({
                        host: p.ip,
                        port: parseInt(p.port),
                        protocol: (p.protocols?.[0] || 'http').toLowerCase() as any,
                        country: p.country,
                        countryCode: p.countryCode,
                        anonymity: p.anonymityLevel,
                        speed: p.speed,
                        lastChecked: new Date(p.lastChecked)
                    });
                }
            }
        } catch (error) {
            console.error('Failed to fetch from GeoNode:', error);
        }
        
        return proxies;
    }

    async fetchFromPubProxy(limit: number = 20): Promise<FreeProxy[]> {
        const proxies: FreeProxy[] = [];
        
        try {
            for (let i = 0; i < Math.ceil(limit / 5); i++) {
                const url = 'http://pubproxy.com/api/proxy?limit=5&format=json&type=http';
                const response = await axios.get(url, { timeout: 10000 });
                
                if (response.data && response.data.data) {
                    for (const p of response.data.data) {
                        proxies.push({
                            host: p.ip,
                            port: parseInt(p.port),
                            protocol: (p.type || 'http').toLowerCase() as any,
                            country: p.country,
                            countryCode: p.country_code,
                            speed: p.speed
                        });
                    }
                }
                
                // Rate limit
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (error) {
            console.error('Failed to fetch from PubProxy:', error);
        }
        
        return proxies;
    }

    async fetchAll(sources: string[] = ['proxyscrape', 'geonode']): Promise<FreeProxy[]> {
        const allProxies: FreeProxy[] = [];
        
        for (const source of sources) {
            let proxies: FreeProxy[] = [];
            
            switch (source) {
                case 'proxyscrape':
                    proxies = await this.fetchFromProxyScrape('http', 5000);
                    break;
                case 'proxyscrape_socks4':
                    proxies = await this.fetchFromProxyScrape('socks4', 5000);
                    break;
                case 'proxyscrape_socks5':
                    proxies = await this.fetchFromProxyScrape('socks5', 5000);
                    break;
                case 'geonode':
                    proxies = await this.fetchFromGeoNode(100);
                    break;
                case 'pubproxy':
                    proxies = await this.fetchFromPubProxy(20);
                    break;
            }
            
            allProxies.push(...proxies);
        }
        
        // Remove duplicates
        const unique = new Map<string, FreeProxy>();
        for (const p of allProxies) {
            const key = `${p.host}:${p.port}`;
            if (!unique.has(key)) {
                unique.set(key, p);
            }
        }
        
        return Array.from(unique.values());
    }

    async testProxy(proxy: FreeProxy, timeout: number = 8000): Promise<{ success: boolean; latency?: number }> {
        const start = Date.now();
        
        try {
            const net = require('net');
            
            return new Promise((resolve) => {
                const socket = new net.Socket();
                
                socket.setTimeout(timeout);
                
                socket.on('connect', () => {
                    socket.destroy();
                    resolve({ success: true, latency: Date.now() - start });
                });
                
                socket.on('timeout', () => {
                    socket.destroy();
                    resolve({ success: false });
                });
                
                socket.on('error', () => {
                    socket.destroy();
                    resolve({ success: false });
                });
                
                socket.connect(proxy.port, proxy.host);
            });
        } catch {
            return { success: false };
        }
    }

    async importToDatabase(proxies: FreeProxy[], groupId: string = 'free-proxies', sourceName: string = 'Unknown'): Promise<{ imported: number; failed: number }> {
        let imported = 0;
        let failed = 0;
        
        console.log(`Starting import of ${proxies.length} proxies to group "${groupId}"`);
        
        let counter = 1;
        for (const proxy of proxies) {
            try {
                // Format: SOURCENAME_FREE_NUMBER
                const name = `${sourceName.toUpperCase()}_FREE_${counter}`;
                
                // Ensure protocol is valid
                let protocol = proxy.protocol;
                if (protocol === 'socks4') protocol = 'socks5' as any;
                if (!['http', 'https', 'socks5'].includes(protocol)) protocol = 'http' as any;
                
                await this.db.createProxy({
                    name,
                    protocol,
                    host: proxy.host,
                    port: proxy.port,
                    group_id: groupId
                });
                
                imported++;
                counter++;
            } catch (error: any) {
                console.error('Failed to import proxy:', proxy.host, error?.message || error);
                failed++;
            }
        }
        
        console.log(`Import complete: ${imported} imported, ${failed} failed`);
        return { imported, failed };
    }

    async fetchAndImport(
        sources: string[] = ['proxyscrape', 'geonode'],
        groupId: string = 'free-proxies',
        testBeforeImport: boolean = false,
        maxProxies: number = 50
    ): Promise<{ fetched: number; tested: number; working: number; imported: number }> {
        // Fetch proxies
        console.log(`Fetching proxies from sources: ${sources.join(', ')}`);
        let proxies = await this.fetchAll(sources);
        const fetched = proxies.length;
        console.log(`Fetched ${fetched} proxies total`);
        
        // Determine source name for naming
        const sourceName = sources.length === 1 ? sources[0].replace('proxyscrape_', '').toUpperCase() : 'MIXED';
        
        // Limit
        proxies = proxies.slice(0, testBeforeImport ? maxProxies * 3 : maxProxies);
        console.log(`Limited to ${proxies.length} proxies for import`);
        
        let tested = 0;
        let working = 0;
        
        // Test if requested
        if (testBeforeImport) {
            const workingProxies: FreeProxy[] = [];
            
            for (const proxy of proxies) {
                if (workingProxies.length >= maxProxies) break;
                
                tested++;
                const result = await this.testProxy(proxy, 5000);
                
                if (result.success) {
                    proxy.speed = result.latency;
                    workingProxies.push(proxy);
                    working++;
                }
            }
            
            proxies = workingProxies;
        }
        
        // Import with source name
        const { imported } = await this.importToDatabase(proxies, groupId, sourceName);
        
        return { fetched, tested, working, imported };
    }
}
