import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { Database } from 'sqlite3';
import { Profile, FingerprintConfig, FingerprintData } from '../database/schema';
import { FingerprintGenerator } from './fingerprint-generator';

const PROFILES_DIR = path.join(os.homedir(), '.antidetect', 'profiles');

export class ProfileManager {
    constructor(private db: Database) { }

    /**
     * Create a new browser profile with complete fingerprint configuration
     */
    async createProfile(
        name: string,
        options: {
            proxyId?: string;
            template?: string;
            browserType?: string;
            browserVersion?: string;
            osType?: string;
            osVersion?: string;
            groupId?: string;
            notes?: string;
            tags?: string;
            status?: string;
            startUrls?: string;
            launchArgs?: string;
            fingerprintConfig?: Partial<FingerprintData>;
        } = {}
    ): Promise<Profile> {
        const id = uuidv4();
        const created_at = Date.now();
        const fingerprint_seed = uuidv4();
        const user_data_dir = path.join(PROFILES_DIR, id);

        // Ensure profile directory exists
        await fs.mkdir(user_data_dir, { recursive: true });

        // Generate fingerprint
        const generator = new FingerprintGenerator(fingerprint_seed, options.browserVersion);
        const template = options.template || 'windows_chrome';
        const fingerprint = generator.generateFingerprint(template);

        // Deep merge with custom fingerprint config if provided
        // This ensures nested objects like 'navigator' aren't completely overwritten
        // Note: Timezone is ALWAYS automatic and cannot be overridden by config
        let safeConfig = options.fingerprintConfig ? { ...options.fingerprintConfig } : {};
        if (safeConfig.timezone) delete safeConfig.timezone;

        // Screen resolution limit - cap to current screen resolution
        let maxScreenWidth = 3840, maxScreenHeight = 2160;
        try {
            const { execSync } = require('child_process');
            if (process.platform === 'win32') {
                // Get screen resolution using .NET
                const output = execSync('powershell "(Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | Where-Object {$_.Primary -eq $true} | Select-Object -ExpandProperty Bounds | ForEach-Object {\"$($_.Width) $($_.Height)\" })"', { encoding: 'utf8' });
                const match = output.trim().match(/(\d+)\s+(\d+)/);
                if (match) {
                    maxScreenWidth = parseInt(match[1]);
                    maxScreenHeight = parseInt(match[2]);
                }
            }
        } catch (e) { /* Use defaults */ }
        if (safeConfig.screen) {
            if (safeConfig.screen.width && safeConfig.screen.width > maxScreenWidth) {
                safeConfig.screen.width = maxScreenWidth;
            }
            if (safeConfig.screen.height && safeConfig.screen.height > maxScreenHeight) {
                safeConfig.screen.height = maxScreenHeight;
            }
        }

        const finalFingerprint = options.fingerprintConfig
            ? this.deepMerge(fingerprint, safeConfig)
            : fingerprint;

        // Create profile
        const profile: any = {
            id,
            name,
            created_at,
            updated_at: created_at,
            proxy_id: options.proxyId || null,
            user_data_dir,
            fingerprint_seed,
            browser_type: options.browserType || 'chrome',
            browser_version: options.browserVersion || finalFingerprint.navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '120.0.6099.130',
            os_type: options.osType || (template.includes('mac') ? 'mac' : template.includes('linux') ? 'linux' : 'windows'),
            os_version: options.osVersion || '10',
            group_id: options.groupId || null,
            notes: options.notes || null,
            tags: options.tags || null,
            status: options.status || 'new',
            start_urls: options.startUrls || null,
            launch_args: options.launchArgs || null,
            custom_data: null,
        };

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO profiles (
          id, name, created_at, updated_at, proxy_id, user_data_dir, fingerprint_seed,
          browser_type, browser_version, os_type, os_version, group_id, notes, tags, 
          status, start_urls, launch_args, custom_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    profile.id,
                    profile.name,
                    profile.created_at,
                    profile.updated_at,
                    profile.proxy_id,
                    profile.user_data_dir,
                    profile.fingerprint_seed,
                    profile.browser_type,
                    profile.browser_version,
                    profile.os_type,
                    profile.os_version,
                    profile.group_id,
                    profile.notes,
                    profile.tags,
                    profile.status,
                    profile.start_urls,
                    profile.launch_args,
                    profile.custom_data,
                ],
                (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        // Create fingerprint configuration
                        this.createFingerprintConfig(id, finalFingerprint)
                            .then(async () => {
                                // AUTO-ASSIGN EXTENSIONS AND BOOKMARKS BASED ON GROUP (only if not explicitly provided)
                                try {
                                    // 1. Extensions
                                    const extensions: any[] = await new Promise((res) => {
                                        this.db.all('SELECT id FROM extensions WHERE group_id IS NULL OR group_id = ?', [options.groupId], (err, rows) => res(rows || []));
                                    });
                                    for (const ext of extensions) {
                                        await new Promise((res) => this.db.run('INSERT OR IGNORE INTO profile_extensions (profile_id, extension_id) VALUES (?, ?)', [id, ext.id], res));
                                    }

                                    // 2. Bookmarks
                                    const bookmarks: any[] = await new Promise((res) => {
                                        this.db.all('SELECT id FROM bookmarks WHERE group_id IS NULL OR group_id = ?', [options.groupId], (err, rows) => res(rows || []));
                                    });
                                    for (const bm of bookmarks) {
                                        await new Promise((res) => this.db.run('INSERT OR IGNORE INTO profile_bookmarks (profile_id, bookmark_id) VALUES (?, ?)', [id, bm.id], res));
                                    }
                                } catch (e) {
                                    console.error('[ProfileManager] Auto-assignment failed:', e);
                                }
                                
                                resolve(profile);
                            })
                            .catch(reject);
                    }
                }
            );
        });
    }

    /**
     * Create fingerprint configuration for a profile
     */
    private async createFingerprintConfig(
        profileId: string,
        fingerprint: FingerprintData
    ): Promise<void> {
        const id = uuidv4();

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO fingerprints (
          id, profile_id,
          canvas_mode, canvas_noise,
          webgl_mode, webgl_vendor, webgl_renderer, webgl_metadata,
          audio_mode, audio_noise, audio_context_state,
          screen_width, screen_height, avail_width, avail_height,
          color_depth, pixel_depth, pixel_ratio,
          timezone_id, timezone_offset,
          language, languages, accept_language,
          geolocation_latitude, geolocation_longitude, geolocation_accuracy,
          user_agent, platform, platform_version,
          hardware_concurrency, device_memory, max_touch_points,
          fonts,
          webrtc_mode, webrtc_public_ip, webrtc_local_ip,
          media_devices_audio_inputs, media_devices_audio_outputs, media_devices_video_inputs,
          do_not_track, plugins,
          client_rects_mode,
          speech_voices,
          battery_spoofing, v8_break_iterator, chrome_object_spoofing, perf_jitter
        ) VALUES (
          ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?,
          ?,
          ?, ?, ?, ?
        )`,
                [
                    id,
                    profileId,
                    fingerprint.canvas.mode,
                    fingerprint.canvas.noise,
                    fingerprint.webgl.mode,
                    fingerprint.webgl.vendor,
                    fingerprint.webgl.renderer,
                    JSON.stringify(fingerprint.webgl.metadata || {}),
                    fingerprint.audio.mode,
                    fingerprint.audio.noise,
                    'suspended',
                    fingerprint.screen.width,
                    fingerprint.screen.height,
                    fingerprint.screen.availWidth,
                    fingerprint.screen.availHeight,
                    fingerprint.screen.colorDepth,
                    fingerprint.screen.pixelDepth,
                    fingerprint.screen.pixelRatio,
                    fingerprint.timezone.id,
                    fingerprint.timezone.offset,
                    fingerprint.languages.language,
                    JSON.stringify(fingerprint.languages.languages),
                    fingerprint.languages.acceptLanguage,
                    fingerprint.geolocation?.latitude || null,
                    fingerprint.geolocation?.longitude || null,
                    fingerprint.geolocation?.accuracy || 100,
                    fingerprint.navigator.userAgent,
                    fingerprint.navigator.platform,
                    fingerprint.navigator.platformVersion,
                    fingerprint.navigator.hardwareConcurrency,
                    fingerprint.navigator.deviceMemory,
                    fingerprint.navigator.maxTouchPoints,
                    JSON.stringify(fingerprint.fonts),
                    fingerprint.webrtc.mode,
                    fingerprint.webrtc.publicIp || null,
                    fingerprint.webrtc.localIp || null,
                    fingerprint.mediaDevices.audioInputs,
                    fingerprint.mediaDevices.audioOutputs,
                    fingerprint.mediaDevices.videoInputs,
                    fingerprint.navigator.doNotTrack,
                    JSON.stringify(fingerprint.plugins),
                    fingerprint.clientRects.mode,
                    JSON.stringify(fingerprint.speech_voices || []),
                    fingerprint.ultraStealth?.battery ? 1 : 0,
                    fingerprint.ultraStealth?.v8BreakIterator ? 1 : 0,
                    fingerprint.ultraStealth?.chromeObject ? 1 : 0,
                    fingerprint.ultraStealth?.perfJitter ? 1 : 0,
                ],
                (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    async getProfile(id: string): Promise<Profile | null> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM profiles WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row as Profile | null);
            });
        });
    }

    async getProfileWithFingerprint(id: string): Promise<{
        profile: Profile;
        fingerprint: FingerprintConfig;
    } | null> {
        const profile = await this.getProfile(id);
        if (!profile) return null;

        const fingerprint = await this.getFingerprintConfig(id);
        if (!fingerprint) return null;

        return { profile, fingerprint };
    }

    async getFingerprintConfig(profileId: string): Promise<FingerprintConfig | null> {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM fingerprints WHERE profile_id = ?',
                [profileId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row as FingerprintConfig | null);
                }
            );
        });
    }

    async listProfiles(includeDeleted: boolean = false): Promise<Profile[]> {
        return new Promise((resolve, reject) => {
            const query = includeDeleted 
                ? 'SELECT * FROM profiles ORDER BY created_at DESC' 
                : 'SELECT * FROM profiles WHERE deleted_at IS NULL ORDER BY created_at DESC';
            this.db.all(query, (err, rows) => {
                if (err) reject(err);
                else resolve((rows || []) as Profile[]);
            });
        });
    }

    async listTrash(): Promise<Profile[]> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM profiles WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC', (err, rows) => {
                if (err) reject(err);
                else resolve((rows || []) as Profile[]);
            });
        });
    }

    async softDeleteProfile(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE profiles SET deleted_at = ? WHERE id = ?', [Date.now(), id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async deleteProfile(id: string): Promise<void> {
        return this.softDeleteProfile(id);
    }

    async updateProfile(id: string, updates: Partial<Profile>): Promise<void> {
        const fields: string[] = [];
        const values: any[] = [];
        // Normalize start_urls from array to newline-separated string
        const normalizedUpdates = { ...updates };
        if (Array.isArray(normalizedUpdates.start_urls)) {
            normalizedUpdates.start_urls = normalizedUpdates.start_urls.join('\n');
        }

        for (const [key, value] of Object.entries(normalizedUpdates)) {
            if (key === 'id') continue;
            fields.push(`${key} = ?`);
            values.push(value);
        }

        if (fields.length === 0) return;

        fields.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);

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

    async updateProfileIP(id: string, info: { ip: string; country: string; city: string; proxy_error?: boolean }): Promise<void> {
        return new Promise((resolve, reject) => {
            const fields = [];
            const values = [];
            if (info.proxy_error) {
                // When proxy error, just update timestamp but don't change IP
                values.push(Date.now());
            } else {
                values.push(info.ip, info.country, info.city, Date.now());
            }
            values.push(Date.now());
            values.push(id);
            const sql = info.proxy_error
                ? `UPDATE profiles SET last_checked_time = ?, updated_at = ? WHERE id = ?`
                : `UPDATE profiles SET last_checked_ip = ?, last_checked_country = ?, last_checked_city = ?, last_checked_time = ?, updated_at = ? WHERE id = ?`;
            this.db.run(sql, values, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async restoreProfile(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE profiles SET deleted_at = NULL WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async deleteProfilePermanently(id: string): Promise<void> {
        const profile = await this.getProfile(id);
        if (!profile) throw new Error('Profile not found');

        // Attempt to clean up directory with retries for EPERM
        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await fs.rm(profile.user_data_dir, { recursive: true, force: true });
                break;
            } catch (error: any) {
                if (error.code === 'EPERM' && i < maxRetries - 1) {
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }
                console.error(`Failed to delete user data directory (Attempt ${i+1}):`, error);
            }
        }

        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM profiles WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async cleanupOldTrash(days: number = 10): Promise<void> {
        const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
        return new Promise((resolve, reject) => {
            this.db.all('SELECT id FROM profiles WHERE deleted_at < ?', [threshold], async (err, rows: any[]) => {
                if (err) return reject(err);
                for (const row of rows) {
                    try { await this.deleteProfilePermanently(row.id); } catch (e) {}
                }
                resolve();
            });
        });
    }

    /**
     * Update fingerprint configuration for a profile
     */
    async updateFingerprintConfig(
        profileId: string,
        fingerprint: Partial<FingerprintData>
    ): Promise<void> {
        // Get existing fingerprint
        const existing = await this.getFingerprintConfig(profileId);
        if (!existing) {
            throw new Error('Fingerprint configuration not found');
        }

        const fields: string[] = [];
        const values: any[] = [];

        // Protection: NEVER update timezone manually
        const fpUpdate = { ...fingerprint };
        if (fpUpdate.timezone) {
            delete fpUpdate.timezone;
        }

        // Canvas
        if (fpUpdate.canvas) {
            if (fpUpdate.canvas.mode !== undefined) {
                fields.push('canvas_mode = ?');
                values.push(fpUpdate.canvas.mode);
            }
            if (fpUpdate.canvas.noise !== undefined) {
                fields.push('canvas_noise = ?');
                values.push(fpUpdate.canvas.noise);
            }
        }

        // WebGL
        if (fpUpdate.webgl) {
            if (fpUpdate.webgl.mode !== undefined) {
                fields.push('webgl_mode = ?');
                values.push(fpUpdate.webgl.mode);
            }
            if (fpUpdate.webgl.vendor !== undefined) {
                fields.push('webgl_vendor = ?');
                values.push(fpUpdate.webgl.vendor);
            }
            if (fpUpdate.webgl.renderer !== undefined) {
                fields.push('webgl_renderer = ?');
                values.push(fpUpdate.webgl.renderer);
            }
            if (fpUpdate.webgl.metadata !== undefined) {
                fields.push('webgl_metadata = ?');
                values.push(JSON.stringify(fpUpdate.webgl.metadata));
            }
        }

        // Audio
        if (fpUpdate.audio) {
            if (fpUpdate.audio.mode !== undefined) {
                fields.push('audio_mode = ?');
                values.push(fpUpdate.audio.mode);
            }
            if (fpUpdate.audio.noise !== undefined) {
                fields.push('audio_noise = ?');
                values.push(fpUpdate.audio.noise);
            }
        }

        // Screen
        if (fpUpdate.screen) {
            if (fpUpdate.screen.width !== undefined) {
                fields.push('screen_width = ?');
                values.push(fpUpdate.screen.width);
            }
            if (fpUpdate.screen.height !== undefined) {
                fields.push('screen_height = ?');
                values.push(fpUpdate.screen.height);
            }
            if (fpUpdate.screen.availWidth !== undefined) {
                fields.push('avail_width = ?');
                values.push(fpUpdate.screen.availWidth);
            }
            if (fpUpdate.screen.availHeight !== undefined) {
                fields.push('avail_height = ?');
                values.push(fpUpdate.screen.availHeight);
            }
            if (fpUpdate.screen.colorDepth !== undefined) {
                fields.push('color_depth = ?');
                values.push(fpUpdate.screen.colorDepth);
            }
            if (fpUpdate.screen.pixelDepth !== undefined) {
                fields.push('pixel_depth = ?');
                values.push(fpUpdate.screen.pixelDepth);
            }
            if (fpUpdate.screen.pixelRatio !== undefined) {
                fields.push('pixel_ratio = ?');
                values.push(fpUpdate.screen.pixelRatio);
            }
        }

        // Languages
        if (fpUpdate.languages) {
            if (fpUpdate.languages.language !== undefined) {
                fields.push('language = ?');
                values.push(fpUpdate.languages.language);
            }
            if (fpUpdate.languages.languages !== undefined) {
                fields.push('languages = ?');
                values.push(JSON.stringify(fpUpdate.languages.languages));
            }
            if (fpUpdate.languages.acceptLanguage !== undefined) {
                fields.push('accept_language = ?');
                values.push(fpUpdate.languages.acceptLanguage);
            }
        }

        // Geolocation
        if (fpUpdate.geolocation) {
            if (fpUpdate.geolocation.latitude !== undefined) {
                fields.push('geolocation_latitude = ?');
                values.push(fpUpdate.geolocation.latitude);
            }
            if (fpUpdate.geolocation.longitude !== undefined) {
                fields.push('geolocation_longitude = ?');
                values.push(fpUpdate.geolocation.longitude);
            }
            if (fpUpdate.geolocation.accuracy !== undefined) {
                fields.push('geolocation_accuracy = ?');
                values.push(fpUpdate.geolocation.accuracy);
            }
        }

        // Navigator
        if (fpUpdate.navigator) {
            if (fpUpdate.navigator.userAgent !== undefined) {
                fields.push('user_agent = ?');
                values.push(fpUpdate.navigator.userAgent);
            }
            if (fpUpdate.navigator.platform !== undefined) {
                fields.push('platform = ?');
                values.push(fpUpdate.navigator.platform);
            }
            if (fpUpdate.navigator.platformVersion !== undefined) {
                fields.push('platform_version = ?');
                values.push(fpUpdate.navigator.platformVersion);
            }
            if (fpUpdate.navigator.hardwareConcurrency !== undefined) {
                fields.push('hardware_concurrency = ?');
                values.push(fpUpdate.navigator.hardwareConcurrency);
            }
            if (fpUpdate.navigator.deviceMemory !== undefined) {
                fields.push('device_memory = ?');
                values.push(fpUpdate.navigator.deviceMemory);
            }
            if (fpUpdate.navigator.maxTouchPoints !== undefined) {
                fields.push('max_touch_points = ?');
                values.push(fpUpdate.navigator.maxTouchPoints);
            }
            if (fpUpdate.navigator.doNotTrack !== undefined) {
                fields.push('do_not_track = ?');
                values.push(fpUpdate.navigator.doNotTrack);
            }
        }

        // Fonts
        if (fpUpdate.fonts !== undefined) {
            fields.push('fonts = ?');
            values.push(JSON.stringify(fpUpdate.fonts));
        }

        // WebRTC
        if (fpUpdate.webrtc) {
            if (fpUpdate.webrtc.mode !== undefined) {
                fields.push('webrtc_mode = ?');
                values.push(fpUpdate.webrtc.mode);
            }
            if (fpUpdate.webrtc.publicIp !== undefined) {
                fields.push('webrtc_public_ip = ?');
                values.push(fpUpdate.webrtc.publicIp);
            }
            if (fpUpdate.webrtc.localIp !== undefined) {
                fields.push('webrtc_local_ip = ?');
                values.push(fpUpdate.webrtc.localIp);
            }
        }

        // Media Devices
        if (fpUpdate.mediaDevices) {
            if (fpUpdate.mediaDevices.audioInputs !== undefined) {
                fields.push('media_devices_audio_inputs = ?');
                values.push(fpUpdate.mediaDevices.audioInputs);
            }
            if (fpUpdate.mediaDevices.audioOutputs !== undefined) {
                fields.push('media_devices_audio_outputs = ?');
                values.push(fpUpdate.mediaDevices.audioOutputs);
            }
            if (fpUpdate.mediaDevices.videoInputs !== undefined) {
                fields.push('media_devices_video_inputs = ?');
                values.push(fpUpdate.mediaDevices.videoInputs);
            }
        }

        // Plugins
        if (fpUpdate.plugins !== undefined) {
            fields.push('plugins = ?');
            values.push(JSON.stringify(fpUpdate.plugins));
        }

        // ClientRects
        if (fpUpdate.clientRects) {
            if (fpUpdate.clientRects.mode !== undefined) {
                fields.push('client_rects_mode = ?');
                values.push(fpUpdate.clientRects.mode);
            }
        }

        // Speech Voices
        if (fpUpdate.speech_voices !== undefined) {
            fields.push('speech_voices = ?');
            values.push(JSON.stringify(fpUpdate.speech_voices));
        }

        // Ultra Stealth
        if (fpUpdate.ultraStealth) {
            if (fpUpdate.ultraStealth.battery !== undefined) {
                fields.push('battery_spoofing = ?');
                values.push(fpUpdate.ultraStealth.battery ? 1 : 0);
            }
            if (fpUpdate.ultraStealth.v8BreakIterator !== undefined) {
                fields.push('v8_break_iterator = ?');
                values.push(fpUpdate.ultraStealth.v8BreakIterator ? 1 : 0);
            }
            if (fpUpdate.ultraStealth.chromeObject !== undefined) {
                fields.push('chrome_object_spoofing = ?');
                values.push(fpUpdate.ultraStealth.chromeObject ? 1 : 0);
            }
            if (fpUpdate.ultraStealth.perfJitter !== undefined) {
                fields.push('perf_jitter = ?');
                values.push(fpUpdate.ultraStealth.perfJitter ? 1 : 0);
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

    getTemplates(): Array<{
        id: string;
        name: string;
        description: string;
        os: string;
        browser: string;
    }> {
        return [
            {
                id: 'windows_chrome',
                name: 'Windows 11 - Chrome 132',
                description: 'Standard Windows 11 profile with Chrome 132',
                os: 'windows',
                browser: 'chrome',
            },
            {
                id: 'mac_chrome',
                name: 'macOS 15 - Chrome 132',
                description: 'macOS Sequoia with Chrome 132',
                os: 'mac',
                browser: 'chrome',
            },
            {
                id: 'linux_chrome',
                name: 'Linux - Chrome 132',
                description: 'Ubuntu 24.04 with Chrome 132',
                os: 'linux',
                browser: 'chrome',
            },
        ];
    }

    /**
     * Bulk create profiles
     */
    async bulkCreateProfiles(
        count: number,
        options: {
            namePrefix?: string;
            template?: string;
            proxyIds?: string[];
            groupId?: string;
            tags?: string;
            fingerprintConfig?: Partial<FingerprintData>;
            extensionIds?: string[];
            bookmarkIds?: string[];
            proxyOptions?: {
                onlyFree?: boolean;
                allowReuse?: boolean;
            };
        } = {}
    ): Promise<{
        success: number;
        failed: number;
        errors: Array<{ index: number; error: string }>;
        created: Profile[];
    }> {
        const results: Profile[] = [];
        const errors: Array<{ index: number; error: string }> = [];
        const namePrefix = options.namePrefix || 'Profile';

        // Resolve proxies
        let availableProxyIds: string[] = [];
        if (options.proxyIds && options.proxyIds.length > 0) {
            // Check if it's a group reference
            if (options.proxyIds[0].startsWith('__group__')) {
                const proxyGroupId = options.proxyIds[0].replace('__group__', '');
                const proxies: any[] = await new Promise((resolve, reject) => {
                    this.db.all('SELECT id FROM proxies WHERE group_id = ?', [proxyGroupId], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    });
                });
                availableProxyIds = proxies.map(p => p.id);
            } else {
                availableProxyIds = [...options.proxyIds];
            }
        }

        // Get used proxies for prioritization/filtering
        const usedProxyIds: string[] = await new Promise((resolve, reject) => {
            this.db.all('SELECT DISTINCT proxy_id FROM profiles WHERE proxy_id IS NOT NULL', (err, rows: any[]) => {
                if (err) reject(err);
                else resolve(rows.map(r => r.proxy_id));
            });
        });
        const usedSet = new Set(usedProxyIds);
        
        const freeProxies = availableProxyIds.filter(id => !usedSet.has(id));
        const inUseProxies = availableProxyIds.filter(id => usedSet.has(id));

        let proxyPool: string[];
        if (options.proxyOptions?.onlyFree) {
            proxyPool = freeProxies;
        } else {
            // Priority to free proxies: free ones first, then used ones
            proxyPool = [...freeProxies, ...inUseProxies];
        }

        const allowReuse = options.proxyOptions?.allowReuse !== false; // Default to true

        for (let i = 0; i < count; i++) {
            try {
                const name = `${namePrefix} ${i + 1}`;
                
                let proxyId: string | undefined = undefined;
                if (proxyPool.length > 0) {
                    if (allowReuse) {
                        proxyId = proxyPool[i % proxyPool.length];
                    } else {
                        proxyId = proxyPool.shift();
                    }
                }

                const profile = await this.createProfile(name, {
                    proxyId,
                    template: options.template,
                    groupId: options.groupId,
                    tags: options.tags,
                    fingerprintConfig: options.fingerprintConfig,
                });

                // Assign extensions if provided
                if (options.extensionIds && options.extensionIds.length > 0) {
                    for (const extId of options.extensionIds) {
                        await new Promise<void>((resolve, reject) => {
                            this.db.run(
                                'INSERT INTO profile_extensions (profile_id, extension_id) VALUES (?, ?)',
                                [profile.id, extId],
                                (err) => err ? reject(err) : resolve()
                            );
                        }).catch(e => console.error(`Failed to assign extension ${extId} to profile ${profile.id}:`, e));
                    }
                }

                // Assign bookmarks if provided
                if (options.bookmarkIds && options.bookmarkIds.length > 0) {
                    for (const bmId of options.bookmarkIds) {
                        await new Promise<void>((resolve, reject) => {
                            this.db.run(
                                'INSERT OR IGNORE INTO profile_bookmarks (profile_id, bookmark_id) VALUES (?, ?)',
                                [profile.id, bmId],
                                (err) => err ? reject(err) : resolve()
                            );
                        }).catch(e => console.error(`Failed to assign bookmark ${bmId} to profile ${profile.id}:`, e));
                    }
                }

                results.push(profile);
            } catch (error: any) {
                errors.push({ index: i, error: error.message });
            }
        }

        return {
            success: results.length,
            failed: errors.length,
            errors,
            created: results,
        };
    }

    /**
     * Bulk delete profiles
     */
    async bulkDeleteProfiles(profileIds: string[]): Promise<{
        success: number;
        failed: number;
        errors: Array<{ id: string; error: string }>;
    }> {
        const errors: Array<{ id: string; error: string }> = [];
        let successCount = 0;

        for (const id of profileIds) {
            try {
                await this.softDeleteProfile(id);
                successCount++;
            } catch (error: any) {
                errors.push({ id, error: error.message });
            }
        }

        return {
            success: successCount,
            failed: errors.length,
            errors,
        };
    }

    /**
     * Assign bookmarks to multiple profiles
     */
    async assignBookmarksToProfiles(profileIds: string[], bookmarkIds: string[]): Promise<void> {
        for (const profileId of profileIds) {
            for (const bookmarkId of bookmarkIds) {
                await new Promise<void>((resolve, reject) => {
                    this.db.run(
                        'INSERT OR IGNORE INTO profile_bookmarks (profile_id, bookmark_id) VALUES (?, ?)',
                        [profileId, bookmarkId],
                        (err) => err ? reject(err) : resolve()
                    );
                });
            }
        }
    }

    /**
     * Remove bookmarks from multiple profiles
     */
    async removeBookmarksFromProfiles(profileIds: string[], bookmarkIds: string[]): Promise<void> {
        for (const profileId of profileIds) {
            for (const bookmarkId of bookmarkIds) {
                await new Promise<void>((resolve, reject) => {
                    this.db.run(
                        'DELETE FROM profile_bookmarks WHERE profile_id = ? AND bookmark_id = ?',
                        [profileId, bookmarkId],
                        (err) => err ? reject(err) : resolve()
                    );
                });
            }
        }
    }

    /**
     * Remove all bookmarks from multiple profiles
     */
    async removeAllBookmarksFromProfiles(profileIds: string[]): Promise<void> {
        for (const profileId of profileIds) {
            await new Promise<void>((resolve, reject) => {
                this.db.run(
                    'DELETE FROM profile_bookmarks WHERE profile_id = ?',
                    [profileId],
                    (err) => err ? reject(err) : resolve()
                );
            });
        }
    }

    /**
     * Get profiles by group ID
     */
    async getProfilesByGroup(groupId: string): Promise<Profile[]> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM profiles WHERE group_id = ? AND deleted_at IS NULL', [groupId], (err, rows) => {
                if (err) reject(err);
                else resolve((rows || []) as Profile[]);
            });
        });
    }

    /**
     * Simple deep merge for configuration objects
     */
    private deepMerge(target: any, source: any): any {
        const result = { ...target };
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }
}
