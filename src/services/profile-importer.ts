import { v4 as uuidv4 } from 'uuid';
import { Database } from 'sqlite3';
import { ProfileManager } from './profile-manager';

export interface AdsPowerProfile {
    user_id?: string;
    serial_number?: string;
    name: string;
    group_id?: string;
    group_name?: string;
    domain_name?: string;
    username?: string;
    password?: string;
    remark?: string;
    user_proxy_config?: {
        proxy_type?: string;
        proxy_host?: string;
        proxy_port?: string;
        proxy_user?: string;
        proxy_password?: string;
    };
    fingerprint_config?: {
        ua?: string;
        language?: string[];
        webrtc?: string;
        fonts?: string[];
    };
}

export interface DolphinProfile {
    id?: number;
    name: string;
    tags?: string[];
    platform?: string;
    browserType?: string;
    mainWebsite?: string;
    notes?: { content?: string };
    useragent?: { mode?: string; value?: string };
    webrtc?: { mode?: string };
    canvas?: { mode?: string };
    webgl?: { mode?: string };
    proxy?: {
        type?: string;
        host?: string;
        port?: number;
        login?: string;
        password?: string;
    };
}

export interface ExportedProfile {
    id: string;
    name: string;
    created_at: number;
    browser_type: string;
    os_type: string;
    os_version: string;
    group_id?: string;
    notes?: string;
    tags?: string;
    status?: string;
    proxy?: {
        protocol: string;
        host: string;
        port: number;
        username?: string;
        password?: string;
    };
    fingerprint?: any;
}

export class ProfileImporter {
    constructor(private db: Database, private profileManager: ProfileManager) {}

    // Import from AdsPower format
    async importFromAdsPower(profiles: AdsPowerProfile[]): Promise<{ imported: number; failed: number; errors: string[] }> {
        let imported = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const ap of profiles) {
            try {
                const name = ap.name || `AdsPower_${ap.serial_number || uuidv4().slice(0, 8)}`;
                
                // Extract proxy if available
                let proxyId: string | undefined;
                if (ap.user_proxy_config && ap.user_proxy_config.proxy_host) {
                    // Create proxy in our system
                    const proxyResult: any = await new Promise((resolve, reject) => {
                        const id = uuidv4();
                        this.db.run(
                            'INSERT INTO proxies (id, name, protocol, host, port, username, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [
                                id,
                                `Imported_${name}`,
                                ap.user_proxy_config?.proxy_type || 'http',
                                ap.user_proxy_config?.proxy_host,
                                parseInt(ap.user_proxy_config?.proxy_port || '80'),
                                ap.user_proxy_config?.proxy_user,
                                ap.user_proxy_config?.proxy_password
                            ],
                            (err) => err ? reject(err) : resolve({ id })
                        );
                    }).catch(e => console.warn('Failed to import proxy:', e));
                    if (proxyResult) proxyId = proxyResult.id;
                }

                await this.profileManager.createProfile(name, {
                    notes: ap.remark || undefined,
                    groupId: ap.group_name || undefined,
                    osType: 'windows',
                    browserType: 'chrome',
                    proxyId,
                    fingerprintConfig: ap.fingerprint_config ? {
                        navigator: {
                            userAgent: ap.fingerprint_config.ua
                        }
                    } as any : undefined
                });
                
                imported++;
            } catch (error: any) {
                failed++;
                errors.push(`Failed to import "${ap.name}": ${error.message}`);
            }
        }

        return { imported, failed, errors };
    }

    // Import from Dolphin Anty format
    async importFromDolphin(profiles: DolphinProfile[]): Promise<{ imported: number; failed: number; errors: string[] }> {
        let imported = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const dp of profiles) {
            try {
                const name = dp.name || `Dolphin_${uuidv4().slice(0, 8)}`;
                const tags = dp.tags ? dp.tags.join(',') : undefined;
                const notes = dp.notes?.content || undefined;
                
                // Map platform to os_type
                let osType = 'windows';
                if (dp.platform === 'macos') osType = 'mac';
                if (dp.platform === 'linux') osType = 'linux';

                // Extract proxy if available
                let proxyId: string | undefined;
                if (dp.proxy && dp.proxy.host) {
                    const proxyResult: any = await new Promise((resolve, reject) => {
                        const id = uuidv4();
                        this.db.run(
                            'INSERT INTO proxies (id, name, protocol, host, port, username, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [
                                id,
                                `Imported_${name}`,
                                dp.proxy?.type || 'http',
                                dp.proxy?.host,
                                dp.proxy?.port || 80,
                                dp.proxy?.login,
                                dp.proxy?.password
                            ],
                            (err) => err ? reject(err) : resolve({ id })
                        );
                    }).catch(e => console.warn('Failed to import proxy:', e));
                    if (proxyResult) proxyId = proxyResult.id;
                }
                
                await this.profileManager.createProfile(name, {
                    notes,
                    tags,
                    osType,
                    browserType: dp.browserType === 'anty' ? 'chrome' : 'chrome',
                    proxyId,
                    fingerprintConfig: dp.useragent?.value ? {
                        navigator: {
                            userAgent: dp.useragent.value
                        }
                    } as any : undefined
                });
                
                imported++;
            } catch (error: any) {
                failed++;
                errors.push(`Failed to import "${dp.name}": ${error.message}`);
            }
        }

        return { imported, failed, errors };
    }

    // Auto-detect format and import
    async importAuto(data: any): Promise<{ imported: number; failed: number; errors: string[]; format: string }> {
        let format = 'unknown';
        
        // Handle raw text import (e.g. from .txt file)
        if (typeof data === 'string') {
            return this.importFromRawText(data);
        }

        // Detect format
        if (Array.isArray(data)) {
            if (data.length > 0) {
                const sample = data[0];
                if (sample.user_id || sample.serial_number || sample.fingerprint_config) {
                    format = 'adspower';
                    const result = await this.importFromAdsPower(data);
                    return { ...result, format };
                } else if (sample.browserType || sample.useragent || sample.webrtc) {
                    format = 'dolphin';
                    const result = await this.importFromDolphin(data);
                    return { ...result, format };
                } else if (sample.id && sample.name && sample.browser_type) {
                    format = 'dolfpower';
                    const result = await this.importFromDolfPower(data);
                    return { ...result, format };
                }
            }
        } else if (data.data && Array.isArray(data.data)) {
            // Wrapped in { data: [...] }
            return this.importAuto(data.data);
        } else if (data.list && Array.isArray(data.list)) {
            // AdsPower format { list: [...] }
            format = 'adspower';
            const result = await this.importFromAdsPower(data.list);
            return { ...result, format };
        }
        
        return { imported: 0, failed: 0, errors: ['Unknown format'], format };
    }

    /**
     * Import from raw text (often used for proxy:ua or simple lists)
     */
    async importFromRawText(text: string): Promise<{ imported: number; failed: number; errors: string[]; format: string }> {
        const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
        let imported = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const line of lines) {
            try {
                let name = `Imported_${uuidv4().slice(0, 8)}`;
                let proxyStr: string | undefined;
                let ua: string | undefined;

                // Try to detect common delimiters: |, ;, tab, or just whitespace
                let parts: string[] = [];
                if (line.includes('|')) parts = line.split('|');
                else if (line.includes(';')) parts = line.split(';');
                else if (line.includes('\t')) parts = line.split('\t');
                else if (line.split(':').length > 5) {
                    // Likely a name:host:port:user:pass:ua format
                    const rawParts = line.split(':');
                    parts = [rawParts[0], rawParts.slice(1, 5).join(':'), rawParts.slice(5).join(':')];
                }

                if (parts.length >= 3) {
                    name = parts[0].trim();
                    proxyStr = parts[1].trim();
                    ua = parts[2].trim();
                } else if (parts.length === 2) {
                    // Could be name:proxy or proxy:ua
                    if (parts[0].includes(':')) {
                        proxyStr = parts[0].trim();
                        ua = parts[1].trim();
                    } else {
                        name = parts[0].trim();
                        proxyStr = parts[1].trim();
                    }
                } else {
                    // Single part - maybe just a proxy or just a name
                    if (line.includes(':')) proxyStr = line.trim();
                    else name = line.trim();
                }

                let proxyId: string | undefined;
                if (proxyStr && (proxyStr.match(/:/g) || []).length >= 1) {
                    // host:port:user:pass or host:port
                    const p = proxyStr.split(':');
                    const id = uuidv4();
                    const proxyResult: any = await new Promise((resolve, reject) => {
                        this.db.run(
                            'INSERT INTO proxies (id, name, protocol, host, port, username, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [id, `Proxy_${name}`, 'http', p[0], parseInt(p[1] || '80'), p[2], p[3]],
                            (err) => err ? reject(err) : resolve({ id })
                        );
                    }).catch(() => null);
                    if (proxyResult) proxyId = proxyResult.id;
                }

                await this.profileManager.createProfile(name, {
                    proxyId,
                    fingerprintConfig: ua ? { navigator: { userAgent: ua } } as any : undefined,
                    notes: `Imported from raw text: ${line.substring(0, 100)}`
                });

                imported++;
            } catch (e: any) {
                failed++;
                errors.push(`Line fail: ${e.message}`);
            }
        }

        return { imported, failed, errors, format: 'raw_text' };
    }

    // Import DolfPower native format
    async importFromDolfPower(profiles: ExportedProfile[]): Promise<{ imported: number; failed: number; errors: string[] }> {
        let imported = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const p of profiles) {
            try {
                await this.profileManager.createProfile(p.name, {
                    notes: p.notes,
                    tags: p.tags,
                    groupId: p.group_id,
                    osType: p.os_type,
                    browserType: p.browser_type,
                    osVersion: p.os_version,
                    status: p.status,
                });
                
                imported++;
            } catch (error: any) {
                failed++;
                errors.push(`Failed to import "${p.name}": ${error.message}`);
            }
        }

        return { imported, failed, errors };
    }

    // Export profiles to DolfPower format
    async exportProfiles(profileIds?: string[]): Promise<ExportedProfile[]> {
        return new Promise((resolve, reject) => {
            let query = 'SELECT * FROM profiles';
            let params: string[] = [];
            
            if (profileIds && profileIds.length > 0) {
                const placeholders = profileIds.map(() => '?').join(',');
                query += ` WHERE id IN (${placeholders})`;
                params = profileIds;
            }
            
            this.db.all(query, params, async (err, rows: any[]) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const exported: ExportedProfile[] = [];
                
                for (const row of rows || []) {
                    // Get proxy info if exists
                    let proxy;
                    if (row.proxy_id) {
                        proxy = await this.getProxyById(row.proxy_id);
                    }
                    
                    exported.push({
                        id: row.id,
                        name: row.name,
                        created_at: row.created_at,
                        browser_type: row.browser_type,
                        os_type: row.os_type,
                        os_version: row.os_version,
                        group_id: row.group_id,
                        notes: row.notes,
                        tags: row.tags,
                        status: row.status,
                        proxy,
                    });
                }
                
                resolve(exported);
            });
        });
    }

    // Export to AdsPower format
    async exportToAdsPower(profileIds?: string[]): Promise<{ list: AdsPowerProfile[] }> {
        const profiles = await this.exportProfiles(profileIds);
        
        const list: AdsPowerProfile[] = profiles.map((p, i) => ({
            serial_number: String(i + 1),
            name: p.name,
            group_name: p.group_id || '',
            remark: p.notes || '',
            user_proxy_config: p.proxy ? {
                proxy_type: p.proxy.protocol,
                proxy_host: p.proxy.host,
                proxy_port: String(p.proxy.port),
                proxy_user: p.proxy.username,
                proxy_password: p.proxy.password,
            } : undefined,
        }));
        
        return { list };
    }

    // Export to Dolphin format
    async exportToDolphin(profileIds?: string[]): Promise<DolphinProfile[]> {
        const profiles = await this.exportProfiles(profileIds);
        
        return profiles.map(p => ({
            name: p.name,
            tags: p.tags ? p.tags.split(',').map(t => t.trim()) : [],
            platform: p.os_type === 'mac' ? 'macos' : p.os_type,
            browserType: 'anty',
            notes: p.notes ? { content: p.notes } : undefined,
            proxy: p.proxy ? {
                type: p.proxy.protocol,
                host: p.proxy.host,
                port: p.proxy.port,
                login: p.proxy.username,
                password: p.proxy.password,
            } : undefined,
        }));
    }

    private getProxyById(proxyId: string): Promise<any> {
        return new Promise((resolve) => {
            this.db.get('SELECT * FROM proxies WHERE id = ?', [proxyId], (err, row) => {
                if (err || !row) {
                    resolve(undefined);
                } else {
                    resolve({
                        protocol: (row as any).protocol,
                        host: (row as any).host,
                        port: (row as any).port,
                        username: (row as any).username,
                        password: (row as any).password,
                    });
                }
            });
        });
    }
}
