import { Database } from 'sqlite3';
import { EncryptionService } from './encryption-service';

export class DataMigrationService {
    constructor(private db: Database) {}

    /**
     * Re-encrypts all sensitive data in the database using the currently set Master Key.
     * This should be called once the master password is set or changed.
     */
    async reencryptAllData(): Promise<{ success: boolean; error?: string }> {
        if (!EncryptionService.isMasterKeySet()) {
            return { success: false, error: 'Master key not set' };
        }

        try {
            await this.reencryptJarvisConfig();
            await this.reencryptTotpSecrets();
            await this.reencryptProxyPasswords();
            await this.reencryptCookies();
            await this.reencryptJarvisSessions();
            await this.reencryptAuthConfig();
            
            console.log('✓ All sensitive data re-encrypted with master key');
            return { success: true };
        } catch (e: any) {
            console.error('Migration failed:', e);
            return { success: false, error: e.message };
        }
    }

    private async reencryptCookies() {
        const rows: any[] = await new Promise((res) => {
            this.db.all('SELECT id, value FROM cookies', (err, rows) => res(rows || []));
        });

        for (const row of rows) {
            if (row.value) {
                const decrypted = EncryptionService.decrypt(row.value);
                const encrypted = EncryptionService.encrypt(decrypted);
                await new Promise((res, rej) => {
                    this.db.run('UPDATE cookies SET value = ? WHERE id = ?', [encrypted, row.id], (err) => err ? rej(err) : res(null));
                });
            }
        }
    }

    private async reencryptJarvisSessions() {
        const rows: any[] = await new Promise((res) => {
            this.db.all('SELECT id, history, attached_files FROM jarvis_sessions', (err, rows) => res(rows || []));
        });

        for (const row of rows) {
            const updates: string[] = [];
            const params: any[] = [];

            if (row.history) {
                const decrypted = EncryptionService.decrypt(row.history);
                const encrypted = EncryptionService.encrypt(decrypted);
                updates.push('history = ?');
                params.push(encrypted);
            }

            if (row.attached_files) {
                const decrypted = EncryptionService.decrypt(row.attached_files);
                const encrypted = EncryptionService.encrypt(decrypted);
                updates.push('attached_files = ?');
                params.push(encrypted);
            }

            if (updates.length > 0) {
                params.push(row.id);
                await new Promise((res, rej) => {
                    this.db.run(`UPDATE jarvis_sessions SET ${updates.join(', ')} WHERE id = ?`, params, (err) => err ? rej(err) : res(null));
                });
            }
        }

        // Re-encrypt execution logs
        const logRows: any[] = await new Promise((res) => {
            this.db.all('SELECT id, log_data FROM jarvis_execution_logs WHERE log_data IS NOT NULL', (err, rows) => res(rows || []));
        });

        for (const logRow of logRows) {
            const decrypted = EncryptionService.decrypt(logRow.log_data);
            const encrypted = EncryptionService.encrypt(decrypted);
            await new Promise((res, rej) => {
                this.db.run('UPDATE jarvis_execution_logs SET log_data = ? WHERE id = ?', [encrypted, logRow.id], (err) => err ? rej(err) : res(null));
            });
        }
    }

    private async reencryptProxyPasswords() {
        const rows: any[] = await new Promise((res) => {
            this.db.all('SELECT id, password FROM proxies WHERE password IS NOT NULL', (err, rows) => res(rows || []));
        });

        for (const row of rows) {
            // Decrypt (handles hardware fallback)
            const decrypted = EncryptionService.decrypt(row.password);
            // Encrypt with master key
            const encrypted = EncryptionService.encrypt(decrypted);
            await new Promise((res, rej) => {
                this.db.run('UPDATE proxies SET password = ? WHERE id = ?', [encrypted, row.id], (err) => err ? rej(err) : res(null));
            });
        }
    }

    private async reencryptJarvisConfig() {
        const row: any = await new Promise((res) => {
            this.db.get('SELECT api_key, tg_token, tg_chat_id, tg_whitelist FROM jarvis_config WHERE id = 1', (err, row) => res(row));
        });

        if (!row) return;

        const updates: any = {};
        const fields = ['api_key', 'tg_token', 'tg_chat_id', 'tg_whitelist'];

        for (const field of fields) {
            if (row[field]) {
                // Decrypt (will try master key first, then fallback to hardware key)
                const decrypted = EncryptionService.decrypt(row[field]);
                // Encrypt (will use master key since it is set)
                updates[field] = EncryptionService.encrypt(decrypted);
            }
        }

        if (Object.keys(updates).length > 0) {
            const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
            await new Promise((res, rej) => {
                this.db.run(`UPDATE jarvis_config SET ${setClause} WHERE id = 1`, Object.values(updates), (err) => err ? rej(err) : res(null));
            });
        }
    }

    private async reencryptTotpSecrets() {
        const rows: any[] = await new Promise((res) => {
            this.db.all('SELECT id, secret FROM totp_secrets', (err, rows) => res(rows || []));
        });

        for (const row of rows) {
            const decrypted = EncryptionService.decrypt(row.secret);
            const encrypted = EncryptionService.encrypt(decrypted);
            await new Promise((res, rej) => {
                this.db.run('UPDATE totp_secrets SET secret = ? WHERE id = ?', [encrypted, row.id], (err) => err ? rej(err) : res(null));
            });
        }
    }

    private async reencryptAuthConfig() {
        const row: any = await new Promise((res) => {
            this.db.get('SELECT totp_secret FROM auth_config WHERE id = 1', (err, row) => res(row));
        });

        if (row && row.totp_secret) {
            const decrypted = EncryptionService.decrypt(row.totp_secret);
            const encrypted = EncryptionService.encrypt(decrypted);
            await new Promise((res, rej) => {
                this.db.run('UPDATE auth_config SET totp_secret = ? WHERE id = 1', [encrypted], (err) => err ? rej(err) : res(null));
            });
        }
    }
}
