import { v4 as uuidv4 } from 'uuid';
import { Database } from 'sqlite3';

export interface Group {
    id: string;
    name: string;
    color: string;
    description: string | null;
    created_at: number;
    profile_count?: number;
}

export class GroupManager {
    constructor(private db: Database) {
        this.initTable();
    }

    private initTable(): void {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT DEFAULT '#6366f1',
                description TEXT,
                created_at INTEGER NOT NULL
            )
        `);
    }

    async createGroup(
        name: string,
        options: { color?: string; description?: string } = {}
    ): Promise<Group> {
        const id = uuidv4();
        const created_at = Date.now();

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO groups (id, name, color, description, created_at) VALUES (?, ?, ?, ?, ?)`,
                [id, name, options.color || '#6366f1', options.description || null, created_at],
                (err) => {
                    if (err) reject(err);
                    else resolve({
                        id,
                        name,
                        color: options.color || '#6366f1',
                        description: options.description || null,
                        created_at,
                        profile_count: 0,
                    });
                }
            );
        });
    }

    async listGroups(): Promise<Group[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT g.*, 
                    (SELECT COUNT(*) FROM profiles WHERE group_id = g.id) as profile_count,
                    (SELECT COUNT(*) FROM proxies WHERE group_id = g.id) as proxy_count
                 FROM groups g 
                 ORDER BY g.name ASC`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve((rows || []) as Group[]);
                }
            );
        });
    }

    async getGroup(id: string): Promise<Group | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT g.*, 
                    (SELECT COUNT(*) FROM profiles WHERE group_id = g.id) as profile_count,
                    (SELECT COUNT(*) FROM proxies WHERE group_id = g.id) as proxy_count
                 FROM groups g 
                 WHERE g.id = ?`,
                [id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row as Group | null);
                }
            );
        });
    }

    async updateGroup(
        id: string,
        updates: { name?: string; color?: string; description?: string }
    ): Promise<void> {
        const fields: string[] = [];
        const values: any[] = [];

        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.color !== undefined) {
            fields.push('color = ?');
            values.push(updates.color);
        }
        if (updates.description !== undefined) {
            fields.push('description = ?');
            values.push(updates.description);
        }

        if (fields.length === 0) return;

        values.push(id);

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE groups SET ${fields.join(', ')} WHERE id = ?`,
                values,
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async deleteGroup(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE profiles SET group_id = NULL WHERE group_id = ?`,
                [id],
                (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    this.db.run('DELETE FROM groups WHERE id = ?', [id], (err2) => {
                        if (err2) reject(err2);
                        else resolve();
                    });
                }
            );
        });
    }

    async getGroupProfiles(groupId: string): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM profiles WHERE group_id = ? ORDER BY created_at DESC',
                [groupId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve((rows || []) as any[]);
                }
            );
        });
    }

    async moveProfilesToGroup(profileIds: string[], groupId: string | null): Promise<number> {
        return new Promise((resolve, reject) => {
            const placeholders = profileIds.map(() => '?').join(',');
            this.db.run(
                `UPDATE profiles SET group_id = ? WHERE id IN (${placeholders})`,
                [groupId, ...profileIds],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    async bulkAssignProxy(groupId: string, proxyId: string | null): Promise<number> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE profiles SET proxy_id = ? WHERE group_id = ?`,
                [proxyId, groupId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }
}
