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
                
                await this.profileManager.createProfile(name, {
                    notes: ap.remark || undefined,
                    groupId: ap.group_name || undefined,
                    osType: 'windows',
                    browserType: 'chrome',
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
                
                await this.profileManager.createProfile(name, {
                    notes,
                    tags,
                    osType,
                    browserType: dp.browserType === 'anty' ? 'chrome' : 'chrome',
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
