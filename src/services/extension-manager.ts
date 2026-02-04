import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { Database } from 'sqlite3';
import axios from 'axios';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const EXTENSIONS_DIR = path.join(os.homedir(), '.antidetect', 'extensions');

export interface Extension {
    id: string;
    name: string;
    path: string;
    enabled: boolean;
    created_at: number;
    version?: string;
    description?: string;
}

export interface ProfileExtension {
    profile_id: string;
    extension_id: string;
    enabled: boolean;
}

export class ExtensionManager {
    constructor(private db: Database) {
        this.initTables();
    }

    private initTables(): void {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS extensions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                created_at INTEGER NOT NULL,
                version TEXT,
                description TEXT
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS profile_extensions (
                profile_id TEXT NOT NULL,
                extension_id TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                PRIMARY KEY (profile_id, extension_id),
                FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
                FOREIGN KEY (extension_id) REFERENCES extensions(id) ON DELETE CASCADE
            )
        `);
    }

    async addExtension(name: string, sourcePath: string): Promise<Extension> {
        const id = uuidv4();
        const created_at = Date.now();

        await fs.mkdir(EXTENSIONS_DIR, { recursive: true });

        const extensionDir = path.join(EXTENSIONS_DIR, id);
        await fs.mkdir(extensionDir, { recursive: true });

        const stats = await fs.stat(sourcePath);
        
        if (stats.isDirectory()) {
            await this.copyDirectory(sourcePath, extensionDir);
        } else if (sourcePath.endsWith('.crx') || sourcePath.endsWith('.zip')) {
            const tempFile = path.join(extensionDir, 'temp' + path.extname(sourcePath));
            await fs.copyFile(sourcePath, tempFile);
            await this.unpackExtension(tempFile, extensionDir);
            await fs.unlink(tempFile);
        } else {
            throw new Error('Extension must be a directory, .crx, or .zip file');
        }

        // Read manifest
        const manifest = await this.readManifest(extensionDir);

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO extensions (id, name, path, enabled, created_at, version, description) VALUES (?, ?, ?, 1, ?, ?, ?)`,
                [id, manifest.name || name, extensionDir, created_at, manifest.version, manifest.description],
                (err) => {
                    if (err) reject(err);
                    else resolve({ 
                        id, 
                        name: manifest.name || name, 
                        path: extensionDir, 
                        enabled: true, 
                        created_at,
                        version: manifest.version,
                        description: manifest.description
                    });
                }
            );
        });
    }

    async installFromChromeStore(extensionId: string): Promise<Extension> {
        const id = uuidv4();
        const created_at = Date.now();
        const extensionDir = path.join(EXTENSIONS_DIR, id);
        const crxPath = path.join(extensionDir, 'extension.crx');

        await fs.mkdir(extensionDir, { recursive: true });

        const downloadUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0&acceptformat=crx2,crx3&x=id%3D${extensionId}%26installsource%3Dondemand%26uc`;

        try {
            const response = await axios({
                method: 'get',
                url: downloadUrl,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            const writer = createWriteStream(crxPath);
            response.data.pipe(writer);

            await new Promise<void>((resolve, reject) => {
                writer.on('finish', () => resolve());
                writer.on('error', (err) => reject(err));
            });

            // Unpack CRX
            await this.unpackExtension(crxPath, extensionDir);
            await fs.unlink(crxPath);

            // Read manifest
            const manifest = await this.readManifest(extensionDir);

            return new Promise((resolve, reject) => {
                this.db.run(
                    `INSERT INTO extensions (id, name, path, enabled, created_at, version, description) VALUES (?, ?, ?, 1, ?, ?, ?)`,
                    [id, manifest.name || `Chrome Extension ${extensionId}`, extensionDir, created_at, manifest.version, manifest.description],
                    (err) => {
                        if (err) reject(err);
                        else resolve({ 
                            id, 
                            name: manifest.name || `Chrome Extension ${extensionId}`, 
                            path: extensionDir, 
                            enabled: true, 
                            created_at,
                            version: manifest.version,
                            description: manifest.description
                        });
                    }
                );
            });
        } catch (error: any) {
            console.error('Chrome Store install error:', error.message);
            throw new Error(`Failed to download extension: ${error.message}`);
        }
    }

    private async unpackExtension(filePath: string, targetDir: string): Promise<void> {
        // Strip CRX header if present
        try {
            const buffer = await fs.readFile(filePath);
            const header = buffer.toString('utf8', 0, 4);
            
            if (header === 'Cr24') {
                // Find zip start (PK\x03\x04)
                const zipStart = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
                if (zipStart !== -1) {
                    await fs.writeFile(filePath, buffer.subarray(zipStart));
                    console.log(`[ExtensionManager] Stripped CRX header, zip starts at ${zipStart}`);
                } else {
                    // Alternative for CRX3: header structure is more complex
                    // Magic (4) + Version (4) + Header length (4)
                    const headerLength = buffer.readUInt32LE(8);
                    const zipStartAlt = 12 + headerLength;
                    if (buffer.length > zipStartAlt && buffer[zipStartAlt] === 0x50 && buffer[zipStartAlt+1] === 0x4b) {
                        await fs.writeFile(filePath, buffer.subarray(zipStartAlt));
                        console.log(`[ExtensionManager] Stripped CRX3 header, zip starts at ${zipStartAlt}`);
                    } else {
                        console.warn('[ExtensionManager] Could not find ZIP start in CRX file');
                    }
                }
            }
        } catch (e) {
            console.error('Error stripping CRX header:', e);
        }

        const platform = os.platform();
        const arch = os.arch();
        let binaryName = platform === 'win32' ? '7za.exe' : '7za';
        let platformDir = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux';
        let archDir = arch === 'arm64' ? 'arm64' : 'x64';
        
        // Use full path to 7za
        const sevenZipPath = path.join(process.cwd(), 'node_modules', '7zip-bin', platformDir, archDir, binaryName);
        
        try {
            // Ensure target directory exists
            await fs.mkdir(targetDir, { recursive: true });
            
            // Execute extraction
            const { stdout, stderr } = await execPromise(`"${sevenZipPath}" x "${filePath}" -o"${targetDir}" -y`);
            if (stderr && !stderr.includes('Everything is Ok')) {
                console.warn('[ExtensionManager] Extraction stderr:', stderr);
            }
        } catch (error: any) {
            console.error('Extraction error:', error.message);
            // If it failed, let's log the first few bytes of the file for debugging
            try {
                const debugBuf = await fs.readFile(filePath);
                console.log(`[ExtensionManager] File header (first 16 bytes): ${debugBuf.subarray(0, 16).toString('hex')}`);
            } catch (err) {}
            throw new Error('Failed to extract extension. Ensure 7zip-bin is correctly installed.');
        }
    }

    private async readManifest(dir: string): Promise<any> {
        try {
            const manifestPath = path.join(dir, 'manifest.json');
            const content = await fs.readFile(manifestPath, 'utf8');
            return JSON.parse(content);
        } catch {
            return {};
        }
    }

    private async copyDirectory(src: string, dest: string): Promise<void> {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this.copyDirectory(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }

    async listExtensions(): Promise<Extension[]> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM extensions ORDER BY created_at DESC', (err, rows) => {
                if (err) reject(err);
                else resolve((rows || []) as Extension[]);
            });
        });
    }

    async getExtension(id: string): Promise<Extension | null> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM extensions WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row as Extension | null);
            });
        });
    }

    async deleteExtension(id: string): Promise<void> {
        const extension = await this.getExtension(id);
        if (extension) {
            try {
                await fs.rm(extension.path, { recursive: true, force: true });
            } catch (error) {
                console.error('Failed to delete extension directory:', error);
            }
        }

        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM extensions WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async assignToProfile(profileId: string, extensionId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO profile_extensions (profile_id, extension_id, enabled) VALUES (?, ?, 1)`,
                [profileId, extensionId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async removeFromProfile(profileId: string, extensionId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM profile_extensions WHERE profile_id = ? AND extension_id = ?`,
                [profileId, extensionId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async getProfileExtensions(profileId: string): Promise<Extension[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT e.* FROM extensions e 
                 JOIN profile_extensions pe ON e.id = pe.extension_id 
                 WHERE pe.profile_id = ? AND pe.enabled = 1`,
                [profileId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve((rows || []) as Extension[]);
                }
            );
        });
    }

    getExtensionArgs(extensions: Extension[]): string[] {
        if (extensions.length === 0) return [];

        const paths = extensions.map(ext => ext.path);
        return [`--load-extension=${paths.join(',')}`];
    }

    // ==================== DEFAULT EXTENSIONS API ====================

    async getAllExtensions(): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM default_extensions ORDER BY created_at DESC', (err, rows) => {
                if (err) reject(err);
                else resolve((rows || []) as any[]);
            });
        });
    }

    async addDefaultExtension(name: string, extPath: string, isDefault: boolean = true): Promise<string> {
        const id = `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const created_at = new Date().toISOString();

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO default_extensions (id, name, path, is_default, created_at) VALUES (?, ?, ?, ?, ?)`,
                [id, name, extPath, isDefault ? 1 : 0, created_at],
                (err) => {
                    if (err) reject(err);
                    else resolve(id);
                }
            );
        });
    }

    async removeExtension(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM default_extensions WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getDefaultExtensions(): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM default_extensions WHERE is_default = 1', (err, rows) => {
                if (err) reject(err);
                else resolve((rows || []) as any[]);
            });
        });
    }
}
