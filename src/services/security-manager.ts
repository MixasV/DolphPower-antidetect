import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

const CONFIG_DIR = path.join(os.homedir(), '.antidetect');
const KEY_FILE = path.join(CONFIG_DIR, '.encryption_key');

export class SecurityManager {
    private masterKey: Buffer | null = null;

    async initialize(password?: string): Promise<void> {
        await fs.mkdir(CONFIG_DIR, { recursive: true });
        
        if (password) {
            // Derive key from password
            const salt = await this.getOrCreateSalt();
            this.masterKey = await this.deriveKey(password, salt);
        } else {
            // Use machine-specific key
            this.masterKey = await this.getMachineKey();
        }
    }

    private async getOrCreateSalt(): Promise<Buffer> {
        const saltFile = path.join(CONFIG_DIR, '.salt');
        try {
            return await fs.readFile(saltFile);
        } catch {
            const salt = crypto.randomBytes(SALT_LENGTH);
            await fs.writeFile(saltFile, salt, { mode: 0o600 });
            return salt;
        }
    }

    private async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(password, salt, 100000, KEY_LENGTH, 'sha512', (err, key) => {
                if (err) reject(err);
                else resolve(key);
            });
        });
    }

    private async getMachineKey(): Promise<Buffer> {
        try {
            const keyData = await fs.readFile(KEY_FILE);
            return keyData;
        } catch {
            // Generate new machine key
            const key = crypto.randomBytes(KEY_LENGTH);
            await fs.writeFile(KEY_FILE, key, { mode: 0o600 });
            return key;
        }
    }

    encrypt(data: string): string {
        if (!this.masterKey) {
            throw new Error('SecurityManager not initialized');
        }

        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.masterKey, iv);
        
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        // Format: iv:authTag:encryptedData
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    }

    decrypt(encryptedData: string): string {
        if (!this.masterKey) {
            throw new Error('SecurityManager not initialized');
        }

        const parts = encryptedData.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted data format');
        }

        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];

        const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, this.masterKey, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    encryptObject(obj: any): string {
        return this.encrypt(JSON.stringify(obj));
    }

    decryptObject<T>(encryptedData: string): T {
        return JSON.parse(this.decrypt(encryptedData));
    }

    // Encrypt sensitive profile data
    encryptProfileData(data: {
        cookies?: any[];
        passwords?: { site: string; username: string; password: string }[];
        walletKeys?: { name: string; key: string }[];
        notes?: string;
    }): string {
        return this.encryptObject(data);
    }

    decryptProfileData(encryptedData: string): {
        cookies?: any[];
        passwords?: { site: string; username: string; password: string }[];
        walletKeys?: { name: string; key: string }[];
        notes?: string;
    } {
        return this.decryptObject(encryptedData);
    }

    // Hash sensitive data for comparison
    hash(data: string): string {
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    // Generate secure random password
    generatePassword(length: number = 24): string {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        const bytes = crypto.randomBytes(length);
        let password = '';
        for (let i = 0; i < length; i++) {
            password += chars[bytes[i] % chars.length];
        }
        return password;
    }

    // Secure file deletion (overwrite before delete)
    async secureDelete(filePath: string): Promise<void> {
        try {
            const stats = await fs.stat(filePath);
            const size = stats.size;
            
            // Overwrite with random data 3 times
            for (let i = 0; i < 3; i++) {
                const randomData = crypto.randomBytes(size);
                await fs.writeFile(filePath, randomData);
            }
            
            // Then delete
            await fs.unlink(filePath);
        } catch (error) {
            // If file doesn't exist, that's fine
            console.error('Secure delete error:', error);
        }
    }

    // Encrypt profile directory
    async encryptProfileDirectory(profileDir: string): Promise<void> {
        const files = await fs.readdir(profileDir, { recursive: true, withFileTypes: true });
        
        for (const file of files) {
            if (file.isFile() && !file.name.endsWith('.encrypted')) {
                const filePath = path.join(file.path || profileDir, file.name);
                const content = await fs.readFile(filePath);
                const encrypted = this.encrypt(content.toString('base64'));
                await fs.writeFile(filePath + '.encrypted', encrypted);
                await this.secureDelete(filePath);
            }
        }
    }

    // Check if data looks like it might contain sensitive info
    detectSensitiveData(text: string): { hasSensitive: boolean; types: string[] } {
        const types: string[] = [];
        
        // Private keys patterns
        if (/-----BEGIN.*PRIVATE KEY-----/.test(text)) {
            types.push('private_key');
        }
        
        // Crypto wallet patterns (simplified)
        if (/^(0x)?[a-fA-F0-9]{64}$/.test(text.trim())) {
            types.push('possible_wallet_key');
        }
        
        // Seed phrases (12 or 24 words)
        const words = text.trim().split(/\s+/);
        if (words.length === 12 || words.length === 24) {
            const allLowerAlpha = words.every(w => /^[a-z]+$/.test(w));
            if (allLowerAlpha) {
                types.push('possible_seed_phrase');
            }
        }
        
        // API keys
        if (/^(sk|pk|api|key)[-_][a-zA-Z0-9]{20,}$/i.test(text.trim())) {
            types.push('api_key');
        }
        
        return {
            hasSensitive: types.length > 0,
            types
        };
    }
}

// Singleton instance
let securityManager: SecurityManager | null = null;

export async function getSecurityManager(): Promise<SecurityManager> {
    if (!securityManager) {
        securityManager = new SecurityManager();
        await securityManager.initialize();
    }
    return securityManager;
}
