import { v4 as uuidv4 } from 'uuid';
import { Database } from 'sqlite3';
import crypto from 'crypto';
import { EncryptionService } from './encryption-service';

export interface TOTPSecret {
    id: string;
    profile_id: string;
    name: string;
    secret: string;
    issuer: string | null;
    digits: number;
    period: number;
    algorithm: 'SHA1' | 'SHA256' | 'SHA512';
    created_at: number;
}

export class TOTPManager {
    constructor(private db: Database) {
        this.initTable();
    }

    private initTable(): void {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS totp_secrets (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL,
                name TEXT NOT NULL,
                secret TEXT NOT NULL,
                issuer TEXT,
                digits INTEGER DEFAULT 6,
                period INTEGER DEFAULT 30,
                algorithm TEXT DEFAULT 'SHA1',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            )
        `);
    }

    async addSecret(
        profileId: string,
        name: string,
        secret: string,
        options: {
            issuer?: string;
            digits?: number;
            period?: number;
            algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
        } = {}
    ): Promise<TOTPSecret> {
        const id = uuidv4();
        const created_at = Date.now();

        const normalizedSecret = this.normalizeSecret(secret);
        const encryptedSecret = EncryptionService.encrypt(normalizedSecret);

        const totpSecret: TOTPSecret = {
            id,
            profile_id: profileId,
            name,
            secret: normalizedSecret,
            issuer: options.issuer || null,
            digits: options.digits || 6,
            period: options.period || 30,
            algorithm: options.algorithm || 'SHA1',
            created_at,
        };

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO totp_secrets (id, profile_id, name, secret, issuer, digits, period, algorithm, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, profileId, name, encryptedSecret, totpSecret.issuer, totpSecret.digits, totpSecret.period, totpSecret.algorithm, created_at],
                (err) => {
                    if (err) reject(err);
                    else resolve(totpSecret);
                }
            );
        });
    }

    private normalizeSecret(secret: string): string {
        return secret.replace(/\s+/g, '').toUpperCase();
    }

    async getSecrets(profileId: string): Promise<TOTPSecret[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM totp_secrets WHERE profile_id = ? ORDER BY created_at DESC',
                [profileId],
                (err, rows) => {
                    if (err) reject(err);
                    else {
                        const results = (rows || []).map((row: any) => {
                            if (row.secret) {
                                row.secret = EncryptionService.decrypt(row.secret);
                            }
                            return row as TOTPSecret;
                        });
                        resolve(results);
                    }
                }
            );
        });
    }

    async getSecret(id: string): Promise<TOTPSecret | null> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM totp_secrets WHERE id = ?', [id], (err, row: any) => {
                if (err) reject(err);
                else if (row) {
                    if (row.secret) {
                        row.secret = EncryptionService.decrypt(row.secret);
                    }
                    resolve(row as TOTPSecret);
                } else {
                    resolve(null);
                }
            });
        });
    }

    async deleteSecret(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM totp_secrets WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    generateCode(secret: TOTPSecret, timestamp?: number): string {
        const time = timestamp || Date.now();
        const counter = Math.floor(time / 1000 / secret.period);

        return this.generateHOTP(secret.secret, counter, secret.digits, secret.algorithm);
    }

    private generateHOTP(
        secret: string,
        counter: number,
        digits: number,
        algorithm: 'SHA1' | 'SHA256' | 'SHA512'
    ): string {
        const decodedSecret = this.base32Decode(secret);

        const buffer = Buffer.alloc(8);
        for (let i = 7; i >= 0; i--) {
            buffer[i] = counter & 0xff;
            counter = counter >> 8;
        }

        const algorithmMap: Record<string, string> = {
            'SHA1': 'sha1',
            'SHA256': 'sha256',
            'SHA512': 'sha512',
        };

        const hmac = crypto.createHmac(algorithmMap[algorithm], decodedSecret);
        hmac.update(buffer);
        const hmacResult = hmac.digest();

        const offset = hmacResult[hmacResult.length - 1] & 0x0f;

        const code = (
            ((hmacResult[offset] & 0x7f) << 24) |
            ((hmacResult[offset + 1] & 0xff) << 16) |
            ((hmacResult[offset + 2] & 0xff) << 8) |
            (hmacResult[offset + 3] & 0xff)
        ) % Math.pow(10, digits);

        return code.toString().padStart(digits, '0');
    }

    private base32Decode(input: string): Buffer {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const cleanInput = input.replace(/=+$/, '').toUpperCase();

        let bits = '';
        for (const char of cleanInput) {
            const val = alphabet.indexOf(char);
            if (val === -1) {
                throw new Error(`Invalid base32 character: ${char}`);
            }
            bits += val.toString(2).padStart(5, '0');
        }

        const bytes: number[] = [];
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            bytes.push(parseInt(bits.substring(i, i + 8), 2));
        }

        return Buffer.from(bytes);
    }

    getTimeRemaining(period: number = 30): number {
        const now = Math.floor(Date.now() / 1000);
        return period - (now % period);
    }

    parseOtpAuthUri(uri: string): {
        secret: string;
        issuer?: string;
        account?: string;
        digits?: number;
        period?: number;
        algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
    } | null {
        try {
            const url = new URL(uri);
            if (url.protocol !== 'otpauth:') return null;

            const params = url.searchParams;
            const secret = params.get('secret');
            if (!secret) return null;

            const pathParts = decodeURIComponent(url.pathname).split(':');
            const account = pathParts.length > 1 ? pathParts[1] : pathParts[0].replace('/', '');

            return {
                secret,
                issuer: params.get('issuer') || undefined,
                account,
                digits: params.has('digits') ? parseInt(params.get('digits')!) : undefined,
                period: params.has('period') ? parseInt(params.get('period')!) : undefined,
                algorithm: (params.get('algorithm')?.toUpperCase() as 'SHA1' | 'SHA256' | 'SHA512') || undefined,
            };
        } catch {
            return null;
        }
    }
}
