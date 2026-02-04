import { v4 as uuidv4 } from 'uuid';
import { Database } from 'sqlite3';
import { Proxy } from '../database/schema';
import { EncryptionService } from './encryption-service';

export class ProxyManager {
    constructor(private db: Database) { }

    async createProxy(
        name: string,
        protocol: 'http' | 'https' | 'socks5',
        host: string,
        port: number,
        username?: string,
        password?: string,
        group_id?: string
    ): Promise<Proxy> {
        const id = uuidv4();
        const created_at = Date.now();
        const encryptedPassword = password ? EncryptionService.encrypt(password) : null;

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO proxies (id, name, protocol, host, port, username, password, group_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, name, protocol, host, port, username || null, encryptedPassword, group_id || null, created_at],
                function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({
                            id,
                            name,
                            protocol,
                            host,
                            port,
                            username,
                            password, // Note: returning plain password in the object for UI immediate use
                            group_id,
                            created_at,
                        } as any);
                    }
                }
            );
        });
    }

    async getProxy(id: string): Promise<Proxy | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM proxies WHERE id = ?',
                [id],
                (err, row: any) => {
                    if (err) {
                        reject(err);
                    } else if (row) {
                        if (row.password) {
                            row.password = EncryptionService.decrypt(row.password);
                        }
                        resolve(row as Proxy);
                    } else {
                        resolve(null);
                    }
                }
            );
        });
    }

    async listProxies(): Promise<Proxy[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM proxies ORDER BY created_at DESC',
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const proxies = (rows || []).map((row: any) => {
                            if (row.password) {
                                row.password = EncryptionService.decrypt(row.password);
                            }
                            return row as Proxy;
                        });
                        resolve(proxies);
                    }
                }
            );
        });
    }

    async deleteProxy(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM proxies WHERE id = ?', [id], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Format proxy for Chromium --proxy-server flag
     */
    formatProxyString(proxy: Proxy): string {
        const auth = proxy.username && proxy.password
            ? `${proxy.username}:${proxy.password}@`
            : '';

        return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
    }

    /**
     * Test proxy connectivity
     */
    async testProxy(proxyId: string): Promise<{ success: boolean; latency?: number; error?: string }> {
        const proxy = await this.getProxy(proxyId);
        if (!proxy) {
            return { success: false, error: 'Proxy not found' };
        }

        try {
            const { IPChecker } = require('./ip-checker');
            const ipChecker = new IPChecker();
            const result = await ipChecker.checkProxyIP({
                protocol: proxy.protocol,
                host: proxy.host,
                port: proxy.port,
                username: proxy.username,
                password: proxy.password
            });

            return { 
                success: result.success, 
                latency: result.latency, 
                error: result.error 
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Parse proxy string to components
     * Supports formats:
     * - host:port
     * - protocol://host:port
     * - host:port:username:password
     * - protocol://username:password@host:port
     */
    private parseProxyString(proxyStr: string): {
        protocol: 'http' | 'https' | 'socks5';
        host: string;
        port: number;
        username?: string;
        password?: string;
    } | null {
        try {
            proxyStr = proxyStr.trim();

            // Default protocol
            let protocol: 'http' | 'https' | 'socks5' = 'http';
            let host: string;
            let port: number;
            let username: string | undefined;
            let password: string | undefined;

            // Check for protocol prefix
            const protocolMatch = proxyStr.match(/^(https?|socks5):\/\//);
            if (protocolMatch) {
                protocol = protocolMatch[1] as 'http' | 'https' | 'socks5';
                proxyStr = proxyStr.substring(protocolMatch[0].length);
            }

            // Check for auth in URL format (user:pass@host:port)
            const authMatch = proxyStr.match(/^([^:]+):([^@]+)@(.+)$/);
            if (authMatch) {
                username = authMatch[1];
                password = authMatch[2];
                proxyStr = authMatch[3];
            }

            // Parse host:port or host:port:user:pass
            const parts = proxyStr.split(':');

            if (parts.length === 2) {
                // host:port
                host = parts[0];
                port = parseInt(parts[1], 10);
            } else if (parts.length === 4) {
                // host:port:username:password
                host = parts[0];
                port = parseInt(parts[1], 10);
                username = parts[2];
                password = parts[3];
            } else {
                return null;
            }

            if (!host || isNaN(port) || port < 1 || port > 65535) {
                return null;
            }

            return { protocol, host, port, username, password };
        } catch (error) {
            return null;
        }
    }

    /**
     * Bulk import proxies from string (one per line)
     * Supports multiple formats
     */
    async bulkImportFromString(
        proxiesText: string,
        defaultProtocol: 'http' | 'https' | 'socks5' = 'http'
    ): Promise<{
        success: number;
        failed: number;
        errors: Array<{ line: number; proxy: string; error: string }>;
        imported: Proxy[];
    }> {
        const lines = proxiesText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const results: Proxy[] = [];
        const errors: Array<{ line: number; proxy: string; error: string }> = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const parsed = this.parseProxyString(line);

            if (!parsed) {
                errors.push({
                    line: i + 1,
                    proxy: line,
                    error: 'Invalid proxy format'
                });
                continue;
            }

            try {
                const proxy = await this.createProxy(
                    `Proxy ${i + 1}`,
                    parsed.protocol || defaultProtocol,
                    parsed.host,
                    parsed.port,
                    parsed.username,
                    parsed.password
                );
                results.push(proxy);
            } catch (error: any) {
                errors.push({
                    line: i + 1,
                    proxy: line,
                    error: error.message
                });
            }
        }

        return {
            success: results.length,
            failed: errors.length,
            errors,
            imported: results
        };
    }

    /**
     * Bulk import proxies from array
     */
    async bulkImportFromArray(
        proxies: Array<{
            name?: string;
            protocol?: 'http' | 'https' | 'socks5';
            host: string;
            port: number;
            username?: string;
            password?: string;
        }>
    ): Promise<{
        success: number;
        failed: number;
        errors: Array<{ index: number; error: string }>;
        imported: Proxy[];
    }> {
        const results: Proxy[] = [];
        const errors: Array<{ index: number; error: string }> = [];

        for (let i = 0; i < proxies.length; i++) {
            const proxyData = proxies[i];

            try {
                const proxy = await this.createProxy(
                    proxyData.name || `Proxy ${i + 1}`,
                    proxyData.protocol || 'http',
                    proxyData.host,
                    proxyData.port,
                    proxyData.username,
                    proxyData.password
                );
                results.push(proxy);
            } catch (error: any) {
                errors.push({
                    index: i,
                    error: error.message
                });
            }
        }

        return {
            success: results.length,
            failed: errors.length,
            errors,
            imported: results
        };
    }

    /**
     * Delete multiple proxies
     */
    async bulkDelete(proxyIds: string[]): Promise<{
        success: number;
        failed: number;
        errors: Array<{ id: string; error: string }>;
    }> {
        const errors: Array<{ id: string; error: string }> = [];
        let successCount = 0;

        for (const id of proxyIds) {
            try {
                await this.deleteProxy(id);
                successCount++;
            } catch (error: any) {
                errors.push({ id, error: error.message });
            }
        }

        return {
            success: successCount,
            failed: errors.length,
            errors
        };
    }
}
