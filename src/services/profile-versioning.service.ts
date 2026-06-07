import { v4 as uuidv4 } from 'uuid';
import { Database } from 'sqlite3';
import { Profile, FingerprintConfig } from '../database/schema';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Profile versioning service for creating snapshots and rollback capabilities
 */
export class ProfileVersioningService {
    private readonly db: Database;
    private readonly VERSIONS_DIR: string;

    constructor(db: Database) {
        this.db = db;
        this.VERSIONS_DIR = path.join(os.homedir(), '.antidetect', 'profile_versions');
        
        // Ensure versions directory exists
        this.initializeVersionsDirectory();
    }

    private async initializeVersionsDirectory(): Promise<void> {
        try {
            await fs.mkdir(this.VERSIONS_DIR, { recursive: true });
        } catch (error) {
            console.error('Failed to create profile versions directory:', error);
        }
    }

    /**
     * Create a new version snapshot of a profile
     */
    async createVersion(profileId: string, changeDescription: string = ''): Promise<string> {
        // Get profile and fingerprint data
        const profile = await this.getProfile(profileId);
        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        const fingerprint = await this.getFingerprintConfig(profileId);
        if (!fingerprint) {
            throw new Error(`Fingerprint config not found for profile: ${profileId}`);
        }

        // Get the next version number
        const versionNumber = await this.getNextVersionNumber(profileId);

        // Create version ID
        const versionId = uuidv4();
        const createdAt = Date.now();

        // Prepare profile data for storage (excluding sensitive fields)
        const profileData = {
            id: profile.id,
            name: profile.name,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
            proxy_id: profile.proxy_id,
            user_data_dir: profile.user_data_dir,
            fingerprint_seed: profile.fingerprint_seed,
            browser_type: profile.browser_type,
            browser_version: profile.browser_version,
            os_type: profile.os_type,
            os_version: profile.os_version,
            group_id: profile.group_id,
            notes: profile.notes,
            tags: profile.tags,
            status: profile.status,
            start_urls: profile.start_urls,
            launch_args: profile.launch_args,
            custom_data: profile.custom_data
        };

        // Prepare fingerprint data for storage
        const fingerprintData = {
            id: fingerprint.id,
            profile_id: fingerprint.profile_id,
            canvas_mode: fingerprint.canvas_mode,
            canvas_noise: fingerprint.canvas_noise,
            webgl_mode: fingerprint.webgl_mode,
            webgl_vendor: fingerprint.webgl_vendor,
            webgl_renderer: fingerprint.webgl_renderer,
            webgl_metadata: fingerprint.webgl_metadata,
            audio_mode: fingerprint.audio_mode,
            audio_noise: fingerprint.audio_noise,
            audio_context_state: fingerprint.audio_context_state,
            screen_width: fingerprint.screen_width,
            screen_height: fingerprint.screen_height,
            avail_width: fingerprint.avail_width,
            avail_height: fingerprint.avail_height,
            color_depth: fingerprint.color_depth,
            pixel_depth: fingerprint.pixel_depth,
            pixel_ratio: fingerprint.pixel_ratio,
            timezone_id: fingerprint.timezone_id,
            timezone_offset: fingerprint.timezone_offset,
            language: fingerprint.language,
            languages: fingerprint.languages,
            accept_language: fingerprint.accept_language,
            geolocation_latitude: fingerprint.geolocation_latitude,
            geolocation_longitude: fingerprint.geolocation_longitude,
            geolocation_accuracy: fingerprint.geolocation_accuracy,
            user_agent: fingerprint.user_agent,
            platform: fingerprint.platform,
            platform_version: fingerprint.platform_version,
            hardware_concurrency: fingerprint.hardware_concurrency,
            device_memory: fingerprint.device_memory,
            max_touch_points: fingerprint.max_touch_points,
            fonts: fingerprint.fonts,
            webrtc_mode: fingerprint.webrtc_mode,
            webrtc_public_ip: fingerprint.webrtc_public_ip,
            webrtc_local_ip: fingerprint.webrtc_local_ip,
            media_devices_audio_inputs: fingerprint.media_devices_audio_inputs,
            media_devices_audio_outputs: fingerprint.media_devices_audio_outputs,
            media_devices_video_inputs: fingerprint.media_devices_video_inputs,
            do_not_track: fingerprint.do_not_track,
            plugins: fingerprint.plugins,
            client_rects_mode: fingerprint.client_rects_mode,
            speech_voices: fingerprint.speech_voices,
            battery_spoofing: fingerprint.battery_spoofing,
            v8_break_iterator: fingerprint.v8_break_iterator,
            chrome_object_spoofing: fingerprint.chrome_object_spoofing,
            perf_jitter: fingerprint.perf_jitter
        };

        // Save to database
        await this.saveVersionToDatabase(versionId, profileId, versionNumber, createdAt, 
            JSON.stringify(profileData), JSON.stringify(fingerprintData));

        // Optionally save to file system for backup
        await this.saveVersionToFileSystem(versionId, profileData, fingerprintData, changeDescription);

        return versionId;
    }

    /**
     * Rollback a profile to a specific version
     */
    async rollbackToVersion(versionId: string): Promise<boolean> {
        // Get version data
        const version = await this.getVersionById(versionId);
        if (!version) {
            throw new Error(`Version not found: ${versionId}`);
        }

        const { profileId, profileData, fingerprintData } = version;

        // Parse the stored data
        const profile = JSON.parse(profileData);
        const fingerprint = JSON.parse(fingerprintData);

        // Update profile in database (preserving ID and created_at)
        await this.updateProfileFromVersion(profileId, profile);

        // Update fingerprint in database
        await this.updateFingerprintFromVersion(profileId, fingerprint);

        return true;
    }

    /**
     * Get all versions for a profile
     */
    async getProfileVersions(profileId: string): Promise<Array<{
        id: string;
        versionNumber: number;
        createdAt: number;
        changeDescription?: string;
    }>> {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT id, version_number, created_at FROM profile_versions 
                 WHERE profile_id = ? 
                 ORDER BY version_number DESC`,
                [profileId],
                (err, rows) => {
                    if (err) reject(err);
                    else {
                        // Try to get change descriptions from file system
                        const versionsWithDesc = rows.map((row: any) => ({
                            id: row.id,
                            versionNumber: row.version_number,
                            createdAt: row.created_at
                        }));
                        resolve(versionsWithDesc);
                    }
                }
            );
        });
    }

    /**
     * Delete a specific version
     */
    async deleteVersion(versionId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM profile_versions WHERE id = ?',
                [versionId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    /**
     * Get the current version number for a profile
     */
    async getCurrentVersionNumber(profileId: string): Promise<number> {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT MAX(version_number) as max_version FROM profile_versions 
                 WHERE profile_id = ?`,
                [profileId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.max_version || 0);
                }
            );
        });
    }

    // Private helper methods

    private async getNextVersionNumber(profileId: string): Promise<number> {
        const current = await this.getCurrentVersionNumber(profileId);
        return current + 1;
    }

    private async getProfile(profileId: string): Promise<Profile | null> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM profiles WHERE id = ?', [profileId], (err, row) => {
                if (err) reject(err);
                else resolve(row as Profile | null);
            });
        });
    }

    private async getFingerprintConfig(profileId: string): Promise<FingerprintConfig | null> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM fingerprints WHERE profile_id = ?', [profileId], (err, row) => {
                if (err) reject(err);
                else resolve(row as FingerprintConfig | null);
            });
        });
    }

    private async saveVersionToDatabase(
        versionId: string,
        profileId: string,
        versionNumber: number,
        createdAt: number,
        profileData: string,
        fingerprintData: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO profile_versions (
                    id, profile_id, version_number, created_at, profile_data, fingerprint_data
                ) VALUES (?, ?, ?, ?, ?, ?)`,
                [versionId, profileId, versionNumber, createdAt, profileData, fingerprintData],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    private async saveVersionToFileSystem(
        versionId: string,
        profileData: any,
        fingerprintData: any,
        changeDescription: string = ''
    ): Promise<void> {
        try {
            const versionDir = path.join(this.VERSIONS_DIR, versionId);
            await fs.mkdir(versionDir, { recursive: true });
            
            // Save profile data
            await fs.writeFile(
                path.join(versionDir, 'profile.json'),
                JSON.stringify(profileData, null, 2),
                { encoding: 'utf8' }
            );
            
            // Save fingerprint data
            await fs.writeFile(
                path.join(versionDir, 'fingerprint.json'),
                JSON.stringify(fingerprintData, null, 2),
                { encoding: 'utf8' }
            );
            
            // Save change description if provided
            if (changeDescription) {
                await fs.writeFile(
                    path.join(versionDir, 'description.txt'),
                    changeDescription,
                    { encoding: 'utf8' }
                );
            }
        } catch (error) {
            console.warn('Failed to save version to file system:', error);
            // Don't fail the operation if file system save fails
        }
    }

    private async getVersionById(versionId: string): Promise<{
        profileId: string;
        versionNumber: number;
        createdAt: number;
        profileData: string;
        fingerprintData: string;
    } | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT profile_id, version_number, created_at, profile_data, fingerprint_data FROM profile_versions WHERE id = ?',
                [versionId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row as any || null);
                }
            );
        });
    }

    private async updateProfileFromVersion(profileId: string, profileData: any): Promise<void> {
        const fields: string[] = [];
        const values: any[] = [];

        // Update mutable fields (preserve id, created_at, fingerprint_seed, user_data_dir)
        const updatableFields = [
            'name', 'updated_at', 'proxy_id', 'browser_type', 'browser_version',
            'os_type', 'os_version', 'group_id', 'notes', 'tags', 'status',
            'start_urls', 'launch_args', 'custom_data'
        ];

        for (const field of updatableFields) {
            if (profileData[field] !== undefined) {
                fields.push(`${field} = ?`);
                values.push(profileData[field]);
            }
        }

        if (fields.length === 0) return;

        values.push(profileId);

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE profiles SET ${fields.join(', ')} WHERE id = ?`,
                values,
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    private async updateFingerprintFromVersion(profileId: string, fingerprintData: any): Promise<void> {
        const fields: string[] = [];
        const values: any[] = [];

        // Update all fingerprint fields except id and profile_id
        const updatableFields = [
            'canvas_mode', 'canvas_noise', 'webgl_mode', 'webgl_vendor', 'webgl_renderer',
            'webgl_metadata', 'audio_mode', 'audio_noise', 'audio_context_state',
            'screen_width', 'screen_height', 'avail_width', 'avail_height',
            'color_depth', 'pixel_depth', 'pixel_ratio', 'timezone_id', 'timezone_offset',
            'language', 'languages', 'accept_language', 'geolocation_latitude',
            'geolocation_longitude', 'geolocation_accuracy', 'user_agent', 'platform',
            'platform_version', 'hardware_concurrency', 'device_memory', 'max_touch_points',
            'fonts', 'webrtc_mode', 'webrtc_public_ip', 'webrtc_local_ip',
            'media_devices_audio_inputs', 'media_devices_audio_outputs',
            'media_devices_video_inputs', 'do_not_track', 'plugins', 'client_rects_mode',
            'speech_voices', 'battery_spoofing', 'v8_break_iterator',
            'chrome_object_spoofing', 'perf_jitter'
        ];

        for (const field of updatableFields) {
            if (fingerprintData[field] !== undefined) {
                fields.push(`${field} = ?`);
                values.push(fingerprintData[field]);
            }
        }

        if (fields.length === 0) return;

        values.push(profileId);

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE fingerprints SET ${fields.join(', ')} WHERE profile_id = ?`,
                values,
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
}

// Singleton instance
let profileVersioningService: ProfileVersioningService | null = null;

export function getProfileVersioningService(db: Database): ProfileVersioningService {
    if (!profileVersioningService) {
        profileVersioningService = new ProfileVersioningService(db);
    }
    return profileVersioningService;
}
