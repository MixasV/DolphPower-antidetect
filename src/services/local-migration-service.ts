import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { Database } from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { ProfileManager } from './profile-manager';
import { ProxyManager } from './proxy-manager';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export interface LocalProfileInfo {
    id: string;
    name: string;
    browser: 'dolphin' | 'adspower' | 'gologin' | 'octo' | 'multilogin' | 'incogniton' | 'undetectable';
    path: string;
    notes?: string;
    proxy?: any;
    userAgent?: string;
}

export class LocalMigrationService {
    private paths: Record<string, string>;

    constructor(
        private db: Database,
        private profileManager: ProfileManager,
        private proxyManager: ProxyManager
    ) {
        const roaming = path.join(os.homedir(), 'AppData', 'Roaming');
        const local = path.join(os.homedir(), 'AppData', 'Local');
        this.paths = {
            dolphin: path.join(roaming, 'dolphin_anty'),
            adspower: path.join(roaming, 'adspower_global'),
            gologin: path.join(os.homedir(), '.gologin'),
            octo: path.join(roaming, 'Octo Browser'),
            multilogin: path.join(roaming, 'multiloginapp'),
            incogniton: path.join(roaming, 'incogniton'),
            undetectable: path.join(roaming, 'Undetectable'),
            bitbrowser: path.join(local, 'BitBrowser'),
            morelogin: path.join(local, 'MoreLogin'),
            geelark: path.join(local, 'GeeLark')
        };
    }

    async detectBrowsers(): Promise<Record<string, boolean>> {
        const detection: Record<string, boolean> = {};
        for (const [key, dir] of Object.entries(this.paths)) {
            detection[key] = existsSync(dir);
        }
        return detection;
    }

    async listProfiles(browser: string): Promise<LocalProfileInfo[]> {
        switch (browser) {
            case 'dolphin': return this.listDolphinProfiles();
            case 'adspower': return this.listAdsPowerProfiles();
            case 'gologin': return this.listGoLoginProfiles();
            case 'octo': return this.listOctoProfiles();
            case 'multilogin': return this.listMultiloginProfiles();
            case 'incogniton': return this.listIncognitonProfiles();
            case 'undetectable': return this.listUndetectableProfiles();
            case 'bitbrowser': return this.listBitBrowserProfiles();
            case 'morelogin': return this.listMoreLoginProfiles();
            case 'geelark': return this.listGeeLarkProfiles();
            default: return [];
        }
    }

    async listBitBrowserProfiles(): Promise<LocalProfileInfo[]> {
        try {
            const profilesDir = path.join(this.paths.bitbrowser, 'profiles');
            if (!existsSync(profilesDir)) return [];
            const dirs = await fs.readdir(profilesDir);
            return dirs.map(d => ({ id: d, name: `BitBrowser_${d}`, browser: 'bitbrowser', path: path.join(profilesDir, d) }));
        } catch (e) { return []; }
    }

    async listMoreLoginProfiles(): Promise<LocalProfileInfo[]> {
        try {
            const profilesDir = path.join(this.paths.morelogin, 'profiles');
            if (!existsSync(profilesDir)) return [];
            const dirs = await fs.readdir(profilesDir);
            return dirs.map(d => ({ id: d, name: `MoreLogin_${d}`, browser: 'morelogin', path: path.join(profilesDir, d) }));
        } catch (e) { return []; }
    }

    async listGeeLarkProfiles(): Promise<LocalProfileInfo[]> {
        try {
            const profilesDir = path.join(this.paths.geelark, 'profiles');
            if (!existsSync(profilesDir)) return [];
            const dirs = await fs.readdir(profilesDir);
            return dirs.map(d => ({ id: d, name: `GeeLark_${d}`, browser: 'geelark', path: path.join(profilesDir, d) }));
        } catch (e) { return []; }
    }

    async listDolphinProfiles(): Promise<LocalProfileInfo[]> {
        try {
            const profilesDir = path.join(this.paths.dolphin, 'browser_profiles');
            if (!existsSync(profilesDir)) return [];
            
            const dirs = await fs.readdir(profilesDir);
            const profiles: LocalProfileInfo[] = [];

            let dbData: any = {};
            try {
                const dbJson = await fs.readFile(path.join(this.paths.dolphin, 'db.json'), 'utf8');
                dbData = JSON.parse(dbJson);
            } catch (e) {}

            for (const dirName of dirs) {
                const fullPath = path.join(profilesDir, dirName);
                if ((await fs.stat(fullPath)).isDirectory()) {
                    profiles.push({
                        id: dirName,
                        name: dbData.profiles?.[dirName]?.name || `Dolphin_${dirName}`,
                        browser: 'dolphin',
                        path: fullPath
                    });
                }
            }
            return profiles;
        } catch (e) {
            return [];
        }
    }

    async listAdsPowerProfiles(): Promise<LocalProfileInfo[]> {
        try {
            const profilesDir = path.join(this.paths.adspower, 'cwd_global'); 
            if (!existsSync(profilesDir)) return [];

            const dirs = await fs.readdir(profilesDir);
            const profiles: LocalProfileInfo[] = [];

            // Try to get names from SQLite
            const dbPath = path.join(this.paths.adspower, 'databases', 'Databases.db');
            const nameMap: Record<string, string> = {};
            if (existsSync(dbPath)) {
                try {
                    const rows: any[] = await new Promise((resolve, reject) => {
                        const tempDb = new (require('sqlite3').Database)(dbPath);
                        tempDb.all('SELECT name, origin FROM Databases', (err: any, rows: any) => {
                            tempDb.close();
                            if (err) reject(err);
                            else resolve(rows);
                        });
                    });
                    for (const row of rows) {
                        if (row.origin) nameMap[row.origin] = row.name;
                    }
                } catch (e) {}
            }

            for (const dirName of dirs) {
                if (dirName.startsWith('chrome_')) continue;
                
                const fullPath = path.join(profilesDir, dirName);
                if ((await fs.stat(fullPath)).isDirectory()) {
                    profiles.push({
                        id: dirName,
                        name: nameMap[dirName] || `AdsPower_${dirName}`,
                        browser: 'adspower',
                        path: fullPath
                    });
                }
            }
            return profiles;
        } catch (e) {
            return [];
        }
    }

    async listGoLoginProfiles(): Promise<LocalProfileInfo[]> {
        try {
            const profilesDir = path.join(this.paths.gologin, 'profiles');
            if (!existsSync(profilesDir)) return [];
            const dirs = await fs.readdir(profilesDir);
            const profiles: LocalProfileInfo[] = [];

            for (const d of dirs) {
                const configPath = path.join(profilesDir, d, 'config.json');
                let name = `GoLogin_${d}`;
                if (existsSync(configPath)) {
                    try {
                        const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
                        if (config.name) name = config.name;
                    } catch (e) {}
                }
                profiles.push({ id: d, name, browser: 'gologin', path: path.join(profilesDir, d) });
            }
            return profiles;
        } catch (e) { return []; }
    }

    async listOctoProfiles(): Promise<LocalProfileInfo[]> {
        try {
            const profilesDir = path.join(this.paths.octo, 'profiles');
            if (!existsSync(profilesDir)) return [];
            const dirs = await fs.readdir(profilesDir);
            const profiles: LocalProfileInfo[] = [];

            for (const d of dirs) {
                const fullPath = path.join(profilesDir, d);
                if (!(await fs.stat(fullPath)).isDirectory()) continue;

                let name = `Octo_${d}`;
                const configPath = path.join(fullPath, 'config.json');
                if (existsSync(configPath)) {
                    try {
                        const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
                        if (config.name) name = config.name;
                    } catch (e) {}
                }
                profiles.push({ id: d, name, browser: 'octo', path: fullPath });
            }
            return profiles;
        } catch (e) { return []; }
    }

    async listMultiloginProfiles(): Promise<LocalProfileInfo[]> {
        try {
            const profilesDir = path.join(this.paths.multilogin, 'profiles');
            if (!existsSync(profilesDir)) return [];
            const dirs = await fs.readdir(profilesDir);
            const profiles: LocalProfileInfo[] = [];

            for (const d of dirs) {
                const fullPath = path.join(profilesDir, d);
                if (!(await fs.stat(fullPath)).isDirectory()) continue;

                let name = `Multilogin_${d}`;
                const metadataPath = path.join(fullPath, 'metadata.json');
                if (existsSync(metadataPath)) {
                    try {
                        const meta = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
                        if (meta.name) name = meta.name;
                    } catch (e) {}
                }
                profiles.push({ id: d, name, browser: 'multilogin', path: fullPath });
            }
            return profiles;
        } catch (e) { return []; }
    }

    async listIncognitonProfiles(): Promise<LocalProfileInfo[]> {
        try {
            const profilesDir = path.join(this.paths.incogniton, 'config');
            if (!existsSync(profilesDir)) return [];
            const dirs = await fs.readdir(profilesDir);
            return dirs.map(d => ({ id: d, name: `Incogniton_${d}`, browser: 'incogniton', path: path.join(profilesDir, d) }));
        } catch (e) { return []; }
    }

    async listUndetectableProfiles(): Promise<LocalProfileInfo[]> {
        try {
            const profilesDir = path.join(this.paths.undetectable, 'profiles');
            if (!existsSync(profilesDir)) return [];
            const dirs = await fs.readdir(profilesDir);
            const profiles: LocalProfileInfo[] = [];

            for (const d of dirs) {
                const fullPath = path.join(profilesDir, d);
                if (!(await fs.stat(fullPath)).isDirectory()) continue;

                let name = `Undetectable_${d}`;
                const configPath = path.join(fullPath, 'config.json');
                if (existsSync(configPath)) {
                    try {
                        const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
                        if (config.name) name = config.name;
                    } catch (e) {}
                }
                profiles.push({ id: d, name, browser: 'undetectable', path: fullPath });
            }
            return profiles;
        } catch (e) { return []; }
    }

    async deepScan(rootPath: string, depth: number = 2): Promise<LocalProfileInfo[]> {
        const found: LocalProfileInfo[] = [];
        try {
            await this.scanRecursive(rootPath, depth, found);
        } catch (e) {}
        return found;
    }

    private async scanRecursive(dir: string, depth: number, found: LocalProfileInfo[]) {
        if (depth < 0) return;
        
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const fullPath = path.join(dir, entry.name);
                
                // Check if it's a profile directory by looking for markers
                const markers = [
                    'Default/Cookies',
                    'Default/Login Data',
                    'Preferences',
                    'config.json',
                    'metadata.json'
                ];

                let isProfile = false;
                for (const marker of markers) {
                    if (existsSync(path.join(fullPath, marker))) {
                        isProfile = true;
                        break;
                    }
                }

                if (isProfile) {
                    let name = `Found_${entry.name}`;
                    // Try to extract name from config.json if it exists
                    const configPath = path.join(fullPath, 'config.json');
                    if (existsSync(configPath)) {
                        try {
                            const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
                            if (config.name) name = config.name;
                        } catch (e) {}
                    }

                    found.push({
                        id: entry.name,
                        name,
                        browser: 'dolphin', // Default logic for transfer
                        path: fullPath
                    });
                } else {
                    // Continue recursion
                    await this.scanRecursive(fullPath, depth - 1, found);
                }
            }
        } catch (e) {}
    }

    async migrateProfile(source: LocalProfileInfo): Promise<string> {
        const newProfile = await this.profileManager.createProfile(source.name, {
            notes: `Migrated from ${source.browser} (${source.id})`,
            tags: 'migrated'
        });

        const targetDir = newProfile.user_data_dir;

        if (source.browser === 'dolphin') {
            await this.transferDolphinData(source.id, targetDir);
        } else if (source.browser === 'adspower') {
            await this.transferAdsPowerData(source.path, targetDir);
        } else {
            // For others, generic directory copy if it looks like a Chromium user data dir
            if (existsSync(source.path)) {
                await this.copyDir(source.path, targetDir);
            }
        }
        
        return newProfile.id;
    }

    private async transferDolphinData(dolphinId: string, targetDir: string) {
        const sourceDir = path.join(this.paths.dolphin, 'browser_profiles', dolphinId);
        const zipPath = path.join(sourceDir, `${dolphinId}.datadir.zip`);

        if (existsSync(zipPath)) {
            // Dolphin stores data in a zip. We need to extract it to targetDir
            try {
                // Using PowerShell's Expand-Archive which is available on Windows
                await execAsync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`);
                console.log(`✓ Extracted Dolphin data for ${dolphinId}`);
            } catch (e) {
                console.error(`Failed to extract Dolphin zip:`, e);
            }
        } else {
            // If not zipped, maybe it's raw? (Less common for Dolphin but possible)
            const rawDir = path.join(sourceDir, 'Default');
            if (existsSync(rawDir)) {
                await this.copyDir(rawDir, path.join(targetDir, 'Default'));
            }
        }
    }

    private async transferAdsPowerData(sourcePath: string, targetDir: string) {
        // AdsPower usually stores data in a structured way.
        // We copy the whole directory content
        await this.copyDir(sourcePath, targetDir);
    }

    private async copyDir(src: string, dest: string) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this.copyDir(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }
}

