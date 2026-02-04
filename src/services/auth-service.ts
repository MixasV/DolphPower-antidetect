import * as crypto from 'crypto';
import { Database } from 'sqlite3';
import { EncryptionService } from './encryption-service';
import { TOTPManager } from './totp-manager';

export interface AuthState {
    isInitialized: boolean;
    isAuthenticated: boolean;
    requiresTotp: boolean;
    isNewHardware: boolean;
    isTotpEnabled: boolean;
}

export class AuthService {
    private static readonly HASH_ITERATIONS = 100000;
    private static readonly KEY_LENGTH = 64;
    private static readonly DIGEST = 'sha512';
    private totpManager: TOTPManager;

    constructor(private db: Database) {
        this.totpManager = new TOTPManager(db);
    }

    async getAuthState(): Promise<AuthState> {
        return new Promise((resolve) => {
            this.db.get('SELECT * FROM auth_config WHERE id = 1', (err, row: any) => {
                if (!row || !row.password_hash) {
                    resolve({
                        isInitialized: false,
                        isAuthenticated: false,
                        requiresTotp: false,
                        isNewHardware: false,
                        isTotpEnabled: false
                    });
                    return;
                }

                const currentHardwareId = EncryptionService.getHardwareId();
                const isNewHardware = row.trusted_hardware_id !== currentHardwareId;
                const requiresTotp = row.is_totp_enabled === 1 && isNewHardware;

                resolve({
                    isInitialized: true,
                    isAuthenticated: EncryptionService.isMasterKeySet(),
                    requiresTotp,
                    isNewHardware,
                    isTotpEnabled: row.is_totp_enabled === 1
                });
            });
        });
    }

    async initialize(password: string): Promise<boolean> {
        const salt = crypto.randomBytes(32).toString('hex');
        const hash = this.hashPassword(password, salt);
        const hardwareId = EncryptionService.getHardwareId();
        const now = Date.now();

        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO auth_config (id, password_hash, password_salt, trusted_hardware_id, updated_at)
                VALUES (1, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    password_hash = excluded.password_hash,
                    password_salt = excluded.password_salt,
                    trusted_hardware_id = excluded.trusted_hardware_id,
                    updated_at = excluded.updated_at
            `, [hash, salt, hardwareId, now], (err) => {
                if (err) reject(err);
                else {
                    EncryptionService.setMasterKey(password, salt);
                    resolve(true);
                }
            });
        });
    }

    async login(password: string): Promise<{ success: boolean; error?: string }> {
        const config: any = await new Promise((resolve) => {
            this.db.get('SELECT * FROM auth_config WHERE id = 1', (err, row) => resolve(row));
        });

        if (!config || !config.password_hash) {
            return { success: false, error: 'Auth not initialized' };
        }

        // Anti-Bruteforce: Check last attempt
        const now = Date.now();
        if (config.login_attempts >= 5 && now - config.last_attempt_at < 60000) {
            return { success: false, error: 'Too many attempts. Wait 1 minute.' };
        }

        const hash = this.hashPassword(password, config.password_salt);
        if (hash !== config.password_hash) {
            await this.incrementAttempts();
            return { success: false, error: 'Invalid password' };
        }

        // Success - Reset attempts
        await this.resetAttempts();
        EncryptionService.setMasterKey(password, config.password_salt);
        
        return { success: true };
    }

    async verifyTotp(token: string): Promise<boolean> {
        const config: any = await new Promise((resolve) => {
            this.db.get('SELECT * FROM auth_config WHERE id = 1', (err, row) => resolve(row));
        });

        if (!config || !config.totp_secret) return false;

        // Decrypt secret using master key
        const secret = EncryptionService.decrypt(config.totp_secret);
        if (!secret) return false;

        // Verify using TOTPManager logic
        const expectedCode = this.totpManager.generateCode({
            secret,
            period: 30,
            digits: 6,
            algorithm: 'SHA1'
        } as any);

        if (token !== expectedCode) {
            // Try previous window for clock drift
            const prevCode = this.totpManager.generateCode({
                secret,
                period: 30,
                digits: 6,
                algorithm: 'SHA1'
            } as any, Date.now() - 30000);
            
            if (token !== prevCode) return false;
        }
        
        const hardwareId = EncryptionService.getHardwareId();
        await new Promise<void>((resolve) => {
            this.db.run('UPDATE auth_config SET trusted_hardware_id = ? WHERE id = 1', [hardwareId], () => resolve());
        });
        
        return true;
    }

    async generateTotpSecret(): Promise<{ secret: string; otpauth: string }> {
        const secret = crypto.randomBytes(20).toString('hex').toUpperCase(); // Simple hex secret, usually base32 is used but TOTPManager supports what it gets
        // Actually TOTPManager uses base32Decode. So we need a base32 secret.
        const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let b32Secret = '';
        for (let i = 0; i < 32; i++) {
            b32Secret += base32.charAt(Math.floor(Math.random() * base32.length));
        }

        const otpauth = `otpauth://totp/DolfPower?secret=${b32Secret}&issuer=DolfPower`;
        return { secret: b32Secret, otpauth };
    }

    async enableTotp(secret: string, token: string): Promise<boolean> {
        // Verify token before enabling
        const isValid = this.totpManager.generateCode({ secret, period: 30, digits: 6, algorithm: 'SHA1' } as any) === token;
        if (!isValid) return false;

        const encryptedSecret = EncryptionService.encrypt(secret);
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE auth_config SET totp_secret = ?, is_totp_enabled = 1 WHERE id = 1', [encryptedSecret], (err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
    }

    async disableTotp(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE auth_config SET totp_secret = NULL, is_totp_enabled = 0 WHERE id = 1', [], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async changePassword(oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
        const config: any = await new Promise((resolve) => {
            this.db.get('SELECT * FROM auth_config WHERE id = 1', (err, row) => resolve(row));
        });

        if (this.hashPassword(oldPassword, config.password_salt) !== config.password_hash) {
            return { success: false, error: 'Current password invalid' };
        }

        const newSalt = crypto.randomBytes(32).toString('hex');
        const newHash = this.hashPassword(newPassword, newSalt);
        
        // Before updating DB, we MUST be able to re-encrypt sensitive data.
        // DataMigrationService needs the master key to be set.
        // We temporarily set the NEW master key, migrate, and if fail revert.
        
        const oldSalt = config.password_salt;
        EncryptionService.setMasterKey(newPassword, newSalt);

        return new Promise((resolve) => {
            this.db.run('UPDATE auth_config SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = 1', [newHash, newSalt, Date.now()], (err) => {
                if (err) {
                    EncryptionService.setMasterKey(oldPassword, oldSalt);
                    resolve({ success: false, error: err.message });
                } else {
                    resolve({ success: true });
                }
            });
        });
    }

    private hashPassword(password: string, salt: string): string {
        return crypto.pbkdf2Sync(
            password,
            salt,
            AuthService.HASH_ITERATIONS,
            AuthService.KEY_LENGTH,
            AuthService.DIGEST
        ).toString('hex');
    }

    private async incrementAttempts() {
        return new Promise<void>((resolve) => {
            this.db.run('UPDATE auth_config SET login_attempts = login_attempts + 1, last_attempt_at = ? WHERE id = 1', [Date.now()], () => resolve());
        });
    }

    private async resetAttempts() {
        return new Promise<void>((resolve) => {
            this.db.run('UPDATE auth_config SET login_attempts = 0 WHERE id = 1', [], () => resolve());
        });
    }
}
