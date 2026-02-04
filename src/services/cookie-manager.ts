import { v4 as uuidv4 } from 'uuid';
import { Database } from 'sqlite3';
import { Cookie } from '../database/schema';
import { EncryptionService } from './encryption-service';

export interface CookieInput {
    name: string;
    value: string;
    domain: string;
    path?: string;
    expires?: number;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
}

export class CookieManager {
    constructor(private db: Database) { }

    async addCookie(profileId: string, cookie: CookieInput): Promise<Cookie> {
        const id = uuidv4();

        const cookieData: Cookie = {
            id,
            profile_id: profileId,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            expires: cookie.expires || 0,
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
            sameSite: cookie.sameSite || 'Lax',
        };

        const encryptedValue = EncryptionService.encrypt(cookie.value);

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO cookies (id, profile_id, name, value, domain, path, expires, secure, httpOnly, sameSite)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    cookieData.id,
                    cookieData.profile_id,
                    cookieData.name,
                    encryptedValue,
                    cookieData.domain,
                    cookieData.path,
                    cookieData.expires,
                    cookieData.secure ? 1 : 0,
                    cookieData.httpOnly ? 1 : 0,
                    cookieData.sameSite,
                ],
                function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(cookieData);
                    }
                }
            );
        });
    }

    async getCookies(profileId: string): Promise<Cookie[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM cookies WHERE profile_id = ?',
                [profileId],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const cookies = (rows || []).map((row: any) => {
                            if (row.value) {
                                row.value = EncryptionService.decrypt(row.value);
                            }
                            return row as Cookie;
                        });
                        resolve(cookies);
                    }
                }
            );
        });
    }

    async getCookiesByDomain(profileId: string, domain: string): Promise<Cookie[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM cookies WHERE profile_id = ? AND domain LIKE ?',
                [profileId, `%${domain}%`],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const cookies = (rows || []).map((row: any) => {
                            if (row.value) {
                                row.value = EncryptionService.decrypt(row.value);
                            }
                            return row as Cookie;
                        });
                        resolve(cookies);
                    }
                }
            );
        });
    }

    async deleteCookie(cookieId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM cookies WHERE id = ?', [cookieId], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async deleteAllCookies(profileId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM cookies WHERE profile_id = ?', [profileId], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Import cookies from JSON array
     */
    async importCookies(profileId: string, cookies: CookieInput[]): Promise<number> {
        let imported = 0;

        for (const cookie of cookies) {
            try {
                await this.addCookie(profileId, cookie);
                imported++;
            } catch (error) {
                console.error('Failed to import cookie:', error);
            }
        }

        return imported;
    }

    /**
     * Export cookies to JSON format
     */
    async exportCookies(profileId: string): Promise<CookieInput[]> {
        const cookies = await this.getCookies(profileId);

        return cookies.map(cookie => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            expires: cookie.expires,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite as 'Strict' | 'Lax' | 'None',
        }));
    }

    /**
     * Set cookies via CDP (Chrome DevTools Protocol)
     */
    async setCookiesViaCDP(cdp: any, cookies: Cookie[]): Promise<void> {
        await cdp.Network.enable();

        for (const cookie of cookies) {
            try {
                await cdp.Network.setCookie({
                    name: cookie.name,
                    value: cookie.value,
                    domain: cookie.domain,
                    path: cookie.path,
                    secure: cookie.secure,
                    httpOnly: cookie.httpOnly,
                    sameSite: cookie.sameSite,
                    expires: cookie.expires > 0 ? cookie.expires / 1000 : undefined,
                });
            } catch (error) {
                console.error('Failed to set cookie via CDP:', error);
            }
        }

        console.log(`✓ Set ${cookies.length} cookies via CDP`);
    }

    /**
     * Get cookies from browser via CDP
     */
    async getCookiesFromBrowser(cdp: any): Promise<any[]> {
        await cdp.Network.enable();
        const { cookies } = await cdp.Network.getAllCookies();
        return cookies;
    }

    /**
     * Sync cookies from browser to database
     */
    async syncCookiesFromBrowser(cdp: any, profileId: string): Promise<number> {
        const browserCookies = await this.getCookiesFromBrowser(cdp);

        // Clear existing cookies
        await this.deleteAllCookies(profileId);

        // Import browser cookies
        const cookiesToImport: CookieInput[] = browserCookies.map((cookie: any) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            expires: cookie.expires ? cookie.expires * 1000 : 0,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
        }));

        return await this.importCookies(profileId, cookiesToImport);
    }
}
