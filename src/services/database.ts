import { Database as SQLiteDatabase } from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { EncryptionService } from './encryption-service';

export interface ProxyData {
    name: string;
    protocol: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
    group_id?: string;
}

export class Database {
    private db: SQLiteDatabase;

    constructor(db: SQLiteDatabase) {
        this.db = db;
    }

    async createProxy(data: ProxyData): Promise<string> {
        const id = uuidv4();
        const createdAt = Date.now();
        const encryptedPassword = data.password ? EncryptionService.encrypt(data.password) : null;
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO proxies (id, name, protocol, host, port, username, password, group_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, data.name, data.protocol, data.host, data.port, data.username || null, encryptedPassword, data.group_id || null, createdAt],
                (err) => {
                    if (err) reject(err);
                    else resolve(id);
                }
            );
        });
    }

    async getProxiesByGroup(groupId: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM proxies WHERE group_id = ? ORDER BY created_at DESC',
                [groupId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows as any[] || []);
                }
            );
        });
    }

    async getAllProxies(): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM proxies ORDER BY created_at DESC',
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows as any[] || []);
                }
            );
        });
    }

    async deleteProxiesByGroup(groupId: string): Promise<number> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM proxies WHERE group_id = ?',
                [groupId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    async updateProxyGroup(proxyId: string, groupId: string | null): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE proxies SET group_id = ? WHERE id = ?',
                [groupId, proxyId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
}
