import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Database } from 'sqlite3';
import { ProfileManager } from '../services/profile-manager';
import { FingerprintGenerator } from '../services/fingerprint-generator';
import { ChromiumManager } from '../services/chromium-manager';
import { ProxyManager } from '../services/proxy-manager';
import { CookieManager } from '../services/cookie-manager';
import { RPAEngine } from '../services/rpa-engine';
import { ExtensionManager } from '../services/extension-manager';
import { TOTPManager } from '../services/totp-manager';
import { IPChecker } from '../services/ip-checker';
import { GroupManager } from '../services/group-manager';
import { FreeProxyFetcher } from '../services/free-proxy-fetcher';
import { Database as DbService } from '../services/database';
import { ProfileImporter } from '../services/profile-importer';
import { JarvisService } from '../services/jarvis-service';
import { JarvisController } from '../services/jarvis-controller';
import { EncryptionService } from '../services/encryption-service';
import { JarvisTaskManager } from '../services/jarvis-task-manager';
import { JarvisToolManager } from '../services/jarvis-tool-manager';
import { TelegramService } from '../services/telegram-service';
import { AuthService } from '../services/auth-service';
import { DataMigrationService } from '../services/data-migration-service';
import { SecurityService } from '../services/security-service';
import { LocalMigrationService } from '../services/local-migration-service';

export function createApp(db: Database): Express {
    const app = express();
    const dbService = new DbService(db);
    const authService = new AuthService(db);
    const migrationService = new DataMigrationService(db);
    const securityService = new SecurityService();
    const profileManager = new ProfileManager(db);
    const chromiumManager = new ChromiumManager(db);
    const profileImporter = new ProfileImporter(db, profileManager);
    const proxyManager = new ProxyManager(db);
    const cookieManager = new CookieManager(db);
    const localMigrationService = new LocalMigrationService(db, profileManager, proxyManager);
    const extensionManager = new ExtensionManager(db);
    const totpManager = new TOTPManager(db);
    const ipChecker = new IPChecker();
    const groupManager = new GroupManager(db);
    const freeProxyFetcher = new FreeProxyFetcher(dbService);
    const jarvisService = new JarvisService();
    const jarvisController = new JarvisController(chromiumManager, jarvisService);
    const rpaEngine = new RPAEngine(db, jarvisService, extensionManager);
    const jarvisTaskManager = new JarvisTaskManager(db, chromiumManager, rpaEngine, profileManager);
    const telegramService = new TelegramService();
    let jarvisToolManager: JarvisToolManager | null = null;

    // Helper to refresh Jarvis & Telegram configuration from DB
    const refreshJarvisServices = async () => {
        return new Promise<void>((resolve) => {
            db.get('SELECT * FROM jarvis_config WHERE id = 1', (err, row: any) => {
                if (row) {
                    jarvisService.setConfig(row);
                    telegramService.updateConfig(row);
                    
                    jarvisToolManager = new JarvisToolManager(
                        db, 
                        row, 
                        profileManager, 
                        proxyManager, 
                        chromiumManager, 
                        rpaEngine,
                        jarvisTaskManager,
                        extensionManager,
                        jarvisController,
                        jarvisService.getMCPManager()
                    );

                    // Set up Telegram command handler
                    telegramService.setCommandHandler(async (message, chatId) => {
                        console.log(`[Telegram] Command from ${chatId}: ${message}`);
                        
                        // 1. Check if it's a PIN for a pending action
                        const pinMatch = message.match(/^\d{6}$/);
                        if (pinMatch) {
                            const pending = securityService.getPendingActionByPin(message);
                            if (pending && pending.chatId === chatId) {
                                const result = await jarvisToolManager?.executeTool(pending.action, { ...pending.args, confirmed: true }, 'telegram');
                                securityService.resolveAction(pending.id);
                                if (result?.success) {
                                    return `✅ <b>Confirmed!</b> Action executed successfully.\n\nResult: <code>${JSON.stringify(result.data, null, 2)}</code>`;
                                } else {
                                    return `❌ <b>Failed:</b> ${result?.error}`;
                                }
                            }
                        }

                        // 2. Standard Jarvis processing
                        const response = await jarvisService.askJarvis(message, [], [], undefined, 'telegram');
                        let finalResponse = response;

                        // Handle tool calls from Telegram
                        if (response.includes('"action": "callTool"') && jarvisToolManager) {
                            try {
                                const jsonMatch = response.match(/\{[\s\S]*"action":\s*"callTool"[\s\S]*\}/);
                                if (jsonMatch) {
                                    const toolCall = JSON.parse(jsonMatch[0]);
                                    
                                    // Check tool against whitelist and 2FA requirement
                                    const result = await jarvisToolManager.executeTool(toolCall.tool, toolCall.args, 'telegram');
                                    
                                    if (result.requiresConfirmation) {
                                        const pending = securityService.createPendingAction(toolCall.tool, chatId, toolCall.args);
                                        return `${response}\n\n⚠️ <b>SECURITY CONFIRMATION REQUIRED</b>\nTo execute this action, please enter this PIN in the chat:\n\n<code>${pending.pin}</code>\n\n(Expires in 5 minutes)`;
                                    }

                                    if (result.success) {
                                        finalResponse = `${response}\n\n✅ <b>Result:</b> ${JSON.stringify(result.data, null, 2)}`;
                                    } else {
                                        finalResponse = `${response}\n\n❌ <b>Error:</b> ${result.error}`;
                                    }
                                }
                            } catch (e: any) {
                                finalResponse = `${response}\n\n⚠️ Tool parsing error: ${e.message}`;
                            }
                        }

                        return finalResponse;
                    });
                }
                resolve();
            });
        });
    };

    // Initial load (will skip sensitive parts if locked)
    refreshJarvisServices();

    // Initial task run
    jarvisTaskManager.runPendingTasks().catch(e => console.error('Failed to start jarvis tasks:', e));

    // Trash Cleanup (Run every 12 hours)
    const cleanupTrash = () => {
        console.log('🧹 Running automatic trash cleanup (10-day threshold)...');
        profileManager.cleanupOldTrash(10).catch(e => console.error('Trash cleanup failed:', e));
    };
    cleanupTrash();
    setInterval(cleanupTrash, 12 * 60 * 60 * 1000);

    // Middleware
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));

    // Serve static UI files
    const path = require('path');
    const uiPath = path.join(__dirname, '../ui');
    app.use('/ui', express.static(uiPath));
    console.log(`📁 Serving UI from: ${uiPath}`);

    // Request logging
    app.use((req: Request, res: Response, next: NextFunction) => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
        next();
    });

    // Error handling wrapper
    const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };

    /**
     * Auth Middleware: Blocks access to all API routes if master key is not set.
     * Exceptions: /v1.0/auth/state, login, initialize.
     */
    const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
        const publicRoutes = [
            '/v1.0/auth/state',
            '/v1.0/auth/login',
            '/v1.0/auth/initialize',
            '/v1.0/auth/verify-2fa'
        ];

        // Allow access to UI files and public auth routes
        if (req.path.startsWith('/ui') || publicRoutes.includes(req.path)) {
            return next();
        }

        if (!EncryptionService.isMasterKeySet()) {
            return res.status(401).json({ 
                success: false, 
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        next();
    };

    app.use(authMiddleware);

    // ==================== AUTH ENDPOINTS ====================

    /**
     * Get current authentication state
     */
    app.get('/v1.0/auth/state', asyncHandler(async (req: Request, res: Response) => {
        const state = await authService.getAuthState();
        res.json({ success: true, data: state });
    }));

    /**
     * Initialize master password
     */
    app.post('/v1.0/auth/initialize', asyncHandler(async (req: Request, res: Response) => {
        const { password } = req.body;
        if (!password || password.length < 8) {
            return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
        }

        const state = await authService.getAuthState();
        if (state.isInitialized) {
            return res.status(400).json({ success: false, error: 'Auth already initialized' });
        }

        await authService.initialize(password);
        
        // Refresh services with the new master key
        await refreshJarvisServices();
        
        // Migrate existing data to be protected by the new master password
        await migrationService.reencryptAllData().catch(e => console.error('Initial migration failed:', e));
        
        res.json({ success: true });
    }));

    /**
     * Login with master password
     */
    app.post('/v1.0/auth/login', asyncHandler(async (req: Request, res: Response) => {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ success: false, error: 'Password required' });
        }

        const result = await authService.login(password);
        if (result.success) {
            // Refresh services with the provided master key
            await refreshJarvisServices();
            
            // Ensure data is up to date with the latest key (handles transitions)
            await migrationService.reencryptAllData().catch(e => console.error('Migration on login failed:', e));
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: result.error });
        }
    }));

    /**
     * Verify 2FA code (for new hardware)
     */
    app.post('/v1.0/auth/verify-2fa', asyncHandler(async (req: Request, res: Response) => {
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ success: false, error: 'Code required' });
        }

        const success = await authService.verifyTotp(code);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Invalid 2FA code' });
        }
    }));

    /**
     * Logout (clear master key from memory)
     */
    app.post('/v1.0/auth/logout', (req: Request, res: Response) => {
        EncryptionService.clearMasterKey();
        // Clear any pending security actions
        if (securityService) {
            const pending = securityService.getAllPending();
            for (const p of pending) {
                securityService.resolveAction(p.id);
            }
        }
        console.log('🔒 User logged out, master key and pending actions cleared');
        res.json({ success: true });
    });

    /**
     * Change master password
     */
    app.post('/v1.0/auth/change-password', asyncHandler(async (req: Request, res: Response) => {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'Both passwords required' });
        }

        const result = await authService.changePassword(oldPassword, newPassword);
        if (result.success) {
            // Re-encrypt all data with new key
            await migrationService.reencryptAllData();
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: result.error });
        }
    }));

    /**
     * Generate TOTP secret for setup
     */
    app.get('/v1.0/auth/totp/generate', asyncHandler(async (req: Request, res: Response) => {
        if (!EncryptionService.isMasterKeySet()) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const data = await authService.generateTotpSecret();
        res.json({ success: true, data });
    }));

    /**
     * Enable TOTP after verification
     */
    app.post('/v1.0/auth/totp/enable', asyncHandler(async (req: Request, res: Response) => {
        const { secret, token } = req.body;
        if (!secret || !token) {
            return res.status(400).json({ success: false, error: 'Secret and token required' });
        }

        const success = await authService.enableTotp(secret, token);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, error: 'Invalid verification token' });
        }
    }));

    /**
     * Disable TOTP
     */
    app.post('/v1.0/auth/totp/disable', asyncHandler(async (req: Request, res: Response) => {
        const { password } = req.body;
        // Verify password first
        const loginCheck = await authService.login(password);
        if (!loginCheck.success) {
            return res.status(401).json({ success: false, error: 'Invalid password' });
        }

        await authService.disableTotp();
        res.json({ success: true });
    }));

    // ==================== PROFILE ENDPOINTS ====================

    /**
     * Create new profile with full fingerprint configuration
     */
    app.post('/v1.0/browser_profiles/create', asyncHandler(async (req: Request, res: Response) => {
        const {
            name,
            proxy_id,
            template,
            browser_type,
            browser_version,
            os_type,
            os_version,
            group_id,
            notes,
            tags,
            status,
            start_urls,
            launch_args,
            fingerprint_config,
        } = req.body;

        if (!name) {
            res.status(400).json({ error: 'name is required' });
            return;
        }

        // Get actual Chromium version to ensure fingerprint consistency
        const actualVersion = await chromiumManager.getChromiumVersion();

        const profile = await profileManager.createProfile(name, {
            proxyId: proxy_id,
            template: template || 'windows_chrome',
            browserType: browser_type,
            browserVersion: browser_version || actualVersion,
            osType: os_type,
            osVersion: os_version,
            groupId: group_id,
            notes,
            tags,
            status,
            startUrls: start_urls,
            launchArgs: launch_args,
            fingerprintConfig: fingerprint_config,
        });

        res.json({
            success: true,
            data: profile,
        });
    }));

    /**
     * List all profiles
     */
    app.get('/v1.0/browser_profiles', asyncHandler(async (req: Request, res: Response) => {
        const profiles = await profileManager.listProfiles();
        res.json({
            success: true,
            data: profiles,
        });
    }));

    /**
     * Export profiles (must be before :id route)
     */
    app.get('/v1.0/browser_profiles/export', asyncHandler(async (req: Request, res: Response) => {
        const format = req.query.format as string || 'dolfpower';
        const ids = req.query.ids ? (req.query.ids as string).split(',') : undefined;
        
        let data;
        if (format === 'adspower') {
            data = await profileImporter.exportToAdsPower(ids);
        } else if (format === 'dolphin') {
            data = await profileImporter.exportToDolphin(ids);
        } else {
            data = await profileImporter.exportProfiles(ids);
        }
        
        res.json({ success: true, data, format });
    }));

    /**
     * Migration Endpoints
     */
    app.get('/v1.0/migration/detect', asyncHandler(async (req: Request, res: Response) => {
        const detection = await localMigrationService.detectBrowsers();
        res.json({ success: true, data: detection });
    }));

    app.get('/v1.0/migration/list/:browser', asyncHandler(async (req: Request, res: Response) => {
        const { browser } = req.params;
        const profiles = await localMigrationService.listProfiles(browser);
        res.json({ success: true, data: profiles });
    }));

    app.post('/v1.0/migration/migrate', asyncHandler(async (req: Request, res: Response) => {
        const { profile } = req.body;
        if (!profile) return res.status(400).json({ error: 'Profile info required' });
        
        const newId = await localMigrationService.migrateProfile(profile);
        res.json({ success: true, data: { id: newId } });
    }));

    app.post('/v1.0/migration/deep-scan', asyncHandler(async (req: Request, res: Response) => {
        const { path } = req.body;
        if (!path) return res.status(400).json({ error: 'Path required' });
        
        const profiles = await localMigrationService.deepScan(path);
        res.json({ success: true, data: profiles });
    }));

    /**
     * Import profiles (must be before :id route)
     */
    app.post('/v1.0/browser_profiles/import', asyncHandler(async (req: Request, res: Response) => {
        const { profiles, format } = req.body;
        
        if (!profiles) {
            return res.status(400).json({ success: false, error: 'profiles data required' });
        }
        
        let result;
        if (format === 'adspower') {
            result = await profileImporter.importFromAdsPower(Array.isArray(profiles) ? profiles : profiles.list || []);
        } else if (format === 'dolphin') {
            result = await profileImporter.importFromDolphin(profiles);
        } else {
            result = await profileImporter.importAuto(profiles);
        }
        
        res.json({ success: true, data: result });
    }));

    /**
     * Get profile by ID
     */
    app.get('/v1.0/browser_profiles/:id', asyncHandler(async (req: Request, res: Response) => {
        const profileData = await profileManager.getProfileWithFingerprint(req.params.id);

        if (!profileData) {
            res.status(404).json({ error: 'Profile not found' });
            return;
        }

        res.json({
            success: true,
            data: profileData,
        });
    }));

    /**
     * Update profile
     */
    app.put('/v1.0/browser_profiles/:id', asyncHandler(async (req: Request, res: Response) => {
        await profileManager.updateProfile(req.params.id, req.body);
        res.json({ success: true });
    }));

    /**
     * Delete profile (Soft Delete)
     */
    app.delete('/v1.0/browser_profiles/:id', asyncHandler(async (req: Request, res: Response) => {
        if (chromiumManager.isProfileRunning(req.params.id)) {
            await chromiumManager.terminateProfile(req.params.id);
        }
        await profileManager.softDeleteProfile(req.params.id);

        res.json({ success: true });
    }));

    /**
     * Bulk soft delete profiles
     */
    app.post('/v1.0/browser_profiles/bulk-delete', asyncHandler(async (req: Request, res: Response) => {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) {
            return res.status(400).json({ success: false, error: 'ids array required' });
        }

        for (const id of ids) {
            if (chromiumManager.isProfileRunning(id)) {
                await chromiumManager.terminateProfile(id).catch(() => {});
            }
            await profileManager.softDeleteProfile(id);
        }

        res.json({ success: true });
    }));

    /**
     * List Trash Bin
     */
    app.get('/v1.0/trash/profiles', asyncHandler(async (req: Request, res: Response) => {
        const profiles = await profileManager.listTrash();
        res.json({ success: true, data: profiles });
    }));

    /**
     * Restore profile from Trash
     */
    app.post('/v1.0/trash/profiles/:id/restore', asyncHandler(async (req: Request, res: Response) => {
        await profileManager.restoreProfile(req.params.id);
        res.json({ success: true });
    }));

    /**
     * Permanent delete profile
     */
    app.delete('/v1.0/trash/profiles/:id', asyncHandler(async (req: Request, res: Response) => {
        if (chromiumManager.isProfileRunning(req.params.id)) {
            await chromiumManager.terminateProfile(req.params.id);
        }
        await profileManager.deleteProfilePermanently(req.params.id);
        res.json({ success: true });
    }));

    /**
     * Create random unique profile
     */
    app.post('/v1.0/browser_profiles/create-unique', asyncHandler(async (req: Request, res: Response) => {
        const { template, name_prefix } = req.body || {};
        const profile = await profileManager.createProfile(
            `${name_prefix || 'Random Profile'} ${Date.now().toString(36)}`, 
            { template: template || 'windows_chrome' }
        );
        res.json({ success: true, data: profile });
    }));

    /**
     * Bulk create profiles
     */
    app.post('/v1.0/browser_profiles/bulk-create', asyncHandler(async (req: Request, res: Response) => {
        const { count, options } = req.body;
        if (!count || count < 1) {
            return res.status(400).json({ success: false, error: 'count must be at least 1' });
        }

        const result = await profileManager.bulkCreateProfiles(count, options || {});
        res.json({ success: true, data: result });
    }));

    /**
     * Duplicate profile
     */
    app.post('/v1.0/browser_profiles/:id/duplicate', asyncHandler(async (req: Request, res: Response) => {
        const profileData = await profileManager.getProfileWithFingerprint(req.params.id);
        
        if (!profileData) {
            res.status(404).json({ error: 'Profile not found' });
            return;
        }
        
        const { profile } = profileData;
        const newName = `${profile.name}_copy_${Date.now().toString(36)}`;
        
        const newProfile = await profileManager.createProfile(newName, {
            proxyId: profile.proxy_id || undefined,
            browserType: profile.browser_type,
            browserVersion: profile.browser_version,
            osType: profile.os_type,
            osVersion: profile.os_version,
            groupId: profile.group_id || undefined,
            notes: profile.notes || undefined,
            tags: profile.tags || undefined,
            status: 'new',
        });
        
        res.json({ success: true, data: newProfile });
    }));

    // ==================== PROFILE TEMPLATES ====================

    /**
     * Get available profile templates
     */
    app.get('/v1.0/browser_profiles/templates/list', asyncHandler(async (req: Request, res: Response) => {
        const templates = profileManager.getTemplates();
        res.json({
            success: true,
            data: templates,
        });
    }));

    // ==================== FINGERPRINT ENDPOINTS ====================

    /**
     * Get fingerprint for profile
     */
    app.get('/v1.0/browser_profiles/:id/fingerprint', asyncHandler(async (req: Request, res: Response) => {
        const fingerprint = await profileManager.getFingerprintConfig(req.params.id);

        if (!fingerprint) {
            res.status(404).json({ error: 'Fingerprint not found' });
            return;
        }

        res.json({
            success: true,
            data: fingerprint,
        });
    }));

    /**
     * Generate random fingerprint
     */
    app.post('/v1.0/fingerprint/generate', asyncHandler(async (req: Request, res: Response) => {
        const { template } = req.body;
        const actualVersion = await chromiumManager.getChromiumVersion();
        const generator = new FingerprintGenerator(Date.now().toString(), actualVersion);
        const fingerprint = generator.generateFingerprint(template || 'windows_chrome');

        res.json({
            success: true,
            data: fingerprint,
        });
    }));

    /**
     * Update fingerprint for profile
     */
    app.put('/v1.0/browser_profiles/:id/fingerprint', asyncHandler(async (req: Request, res: Response) => {
        await profileManager.updateFingerprintConfig(req.params.id, req.body);
        res.json({ success: true });
    }));

    // ==================== BROWSER CONTROL ENDPOINTS ====================

    /**
     * Start browser profile
     */
    app.get('/v1.0/browser_profiles/:id/start', asyncHandler(async (req: Request, res: Response) => {
        const profileData = await profileManager.getProfileWithFingerprint(req.params.id);

        if (!profileData) {
            res.status(404).json({ error: 'Profile not found' });
            return;
        }

        if (chromiumManager.isProfileRunning(req.params.id)) {
            res.status(400).json({ error: 'Profile is already running' });
            return;
        }

        const { profile, fingerprint } = profileData;
        const actualVersion = await chromiumManager.getChromiumVersion();
        const actualMajorVersion = actualVersion.split('.')[0];

        // Map DB fingerprint to FingerprintData structure for CDP
        const fingerprintDataToApply: any = {
            canvas: { mode: fingerprint.canvas_mode, noise: fingerprint.canvas_noise },
            webgl: { 
                mode: fingerprint.webgl_mode, 
                vendor: fingerprint.webgl_vendor, 
                renderer: fingerprint.webgl_renderer,
                metadata: fingerprint.webgl_metadata ? JSON.parse(fingerprint.webgl_metadata) : {}
            },
            audio: { mode: fingerprint.audio_mode, noise: fingerprint.audio_noise },
            screen: {
                width: fingerprint.screen_width,
                height: fingerprint.screen_height,
                availWidth: fingerprint.avail_width,
                availHeight: fingerprint.avail_height,
                colorDepth: fingerprint.color_depth,
                pixelDepth: fingerprint.pixel_depth,
                pixelRatio: fingerprint.pixel_ratio
            },
            timezone: { id: fingerprint.timezone_id, offset: fingerprint.timezone_offset },
            languages: {
                language: fingerprint.language,
                languages: fingerprint.languages ? JSON.parse(fingerprint.languages) : ['en-US', 'en'],
                acceptLanguage: fingerprint.accept_language
            },
            navigator: {
                // Dynamically update version at launch to match host while keeping other UA parts
                userAgent: fingerprint.user_agent.replace(/Chrome\/[\d.]+/, `Chrome/${actualVersion}`),
                platform: fingerprint.platform,
                platformVersion: fingerprint.platform_version,
                hardwareConcurrency: fingerprint.hardware_concurrency,
                deviceMemory: fingerprint.device_memory,
                maxTouchPoints: fingerprint.max_touch_points,
                doNotTrack: fingerprint.do_not_track
            },
            geolocation: fingerprint.geolocation_latitude ? {
                latitude: fingerprint.geolocation_latitude,
                longitude: fingerprint.geolocation_longitude,
                accuracy: fingerprint.geolocation_accuracy
            } : undefined,
            fonts: fingerprint.fonts ? JSON.parse(fingerprint.fonts) : [],
            webrtc: { 
                mode: fingerprint.webrtc_mode, 
                publicIp: fingerprint.webrtc_public_ip || undefined,
                localIp: fingerprint.webrtc_local_ip || undefined
            },
            mediaDevices: {
                audioInputs: fingerprint.media_devices_audio_inputs,
                audioOutputs: fingerprint.media_devices_audio_outputs,
                videoInputs: fingerprint.media_devices_video_inputs
            },
            clientRects: { mode: fingerprint.client_rects_mode },
            plugins: fingerprint.plugins ? JSON.parse(fingerprint.plugins) : [],
            speech_voices: fingerprint.speech_voices ? JSON.parse(fingerprint.speech_voices) : [],
            ultraStealth: {
                battery: fingerprint.battery_spoofing === 1,
                v8BreakIterator: fingerprint.v8_break_iterator === 1,
                chromeObject: fingerprint.chrome_object_spoofing === 1,
                perfJitter: fingerprint.perf_jitter === 1
            }
        };

        // Get proxy if assigned
        let proxyString: string | undefined;
        let proxyAuth: { username?: string; password?: string } | undefined;
        let proxyInfo: any = null;

        if (profile.proxy_id) {
            const proxy = await proxyManager.getProxy(profile.proxy_id);
            if (proxy) {
                proxyInfo = proxy;
                // For the flag, we should use protocol://host:port
                proxyString = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
                if (proxy.username && proxy.password) {
                    proxyAuth = { username: proxy.username, password: proxy.password };
                }
                
                // Pre-test proxy connectivity before launching browser
                console.log(`🔍 Pre-testing proxy ${proxy.name} (${proxy.host}:${proxy.port})...`);
                try {
                    const proxyTestResult = await ipChecker.checkProxyIP(proxyInfo);
                    if (!proxyTestResult.success) {
                        return res.status(400).json({ 
                            error: `Proxy connection failed: ${proxyTestResult.error || 'Unknown error'}`,
                            proxy_error: true
                        });
                    }
                    console.log(`🔍 Proxy test successful, latency: ${proxyTestResult.latency}ms`);
                } catch (proxyError: any) {
                    return res.status(400).json({ 
                        error: `Proxy test failed: ${proxyError.message || 'Unable to connect to proxy'}`,
                        proxy_error: true
                    });
                }
            }
        }

        // Auto-Sync logic (Sync Language, Timezone, Geolocation and WebRTC with Proxy IP)
        if (profile.proxy_id || fingerprint.language === 'auto_ip') {
            try {
                console.log(`🌐 Synchronizing profile ${profile.name} with ${profile.proxy_id ? 'Proxy' : 'Direct'} IP...`);
                const result = proxyInfo 
                    ? await ipChecker.checkProxyIP(proxyInfo)
                    : await ipChecker.getMyIP();
                
                if (result.success && result.info) {
                    console.log(`🌐 Syncing with IP: ${result.info.ip} (${result.info.countryCode}, ${result.info.timezone})`);
                    
                    // 1. Sync Language
                    const locale = ipChecker.getLanguageForCountry(result.info.countryCode || 'US');
                    fingerprintDataToApply.languages.language = locale;
                    fingerprintDataToApply.languages.languages = [locale, locale.split('-')[0], 'en-US', 'en'];
                    fingerprintDataToApply.languages.acceptLanguage = `${locale},${locale.split('-')[0]};q=0.9,en-US;q=0.8,en;q=0.7`;
                    
                    // 3. Sync Geolocation
                    if (result.info.lat && result.info.lon) {
                        fingerprintDataToApply.geolocation = {
                            latitude: result.info.lat,
                            longitude: result.info.lon,
                            accuracy: 100
                        };
                    }

                    // 4. Sync WebRTC Public IP
                    if (fingerprint.webrtc_mode === 'altered') {
                        fingerprintDataToApply.webrtc.publicIp = result.info.ip;
                    }
                    
                    // Update profile IP cache in DB
                    await profileManager.updateProfileIP(profile.id, {
                        ip: result.info.ip,
                        country: result.info.countryCode || result.info.country,
                        city: result.info.city
                    });
                }
            } catch (e: any) {
                console.error(`🌐 Auto-Sync failed: ${e.message}`);
            }
        }

        // Update last_opened_at and open_count
        await new Promise<void>((resolve) => {
            db.run(
                `UPDATE profiles SET last_opened_at = ?, open_count = COALESCE(open_count, 0) + 1 WHERE id = ?`,
                [Date.now(), req.params.id],
                () => resolve()
            );
        });

        const headless = req.query.headless === 'true';
        const processInfo = await chromiumManager.launchProfile(
            req.params.id,
            profile.user_data_dir,
            {
                headless,
                proxy: proxyString,
                proxyAuth,
                windowWidth: fingerprint.screen_width,
                windowHeight: fingerprint.screen_height,
                restoreTabs: profile.restore_tabs === 1
            }
        );

        // Wait a bit for browser to start
        await new Promise(resolve => setTimeout(resolve, 1500));

        try {
            const startUrls = profile.start_urls ? profile.start_urls.split('\n').filter((u: string) => u.trim()) : [];
            await chromiumManager.applyFingerprintViaCDP(req.params.id, processInfo.devToolsPort, fingerprintDataToApply, startUrls, {
                restoreTabs: profile.restore_tabs === 1
            });
            
            // Auto-inject Jarvis Overlay for Master Profile
            const config: any = await new Promise((resolve) => {
                db.get('SELECT master_profile_id FROM jarvis_config WHERE id = 1', (err, row) => resolve(row));
            });
            
            if (config && config.master_profile_id === req.params.id) {
                console.log(`[Jarvis] Auto-injecting overlay to Master Profile ${req.params.id}`);
                // Try to get last active session for auto-context
                const lastSession: any = await new Promise((resolve) => {
                    db.get('SELECT id FROM jarvis_sessions ORDER BY updated_at DESC LIMIT 1', (err, row) => resolve(row));
                });
                
                // Small delay to let page load
                setTimeout(() => jarvisController.injectOverlay(req.params.id, lastSession?.id), 3000);
            }
        } catch (error) {
            console.error('Failed to apply fingerprint via CDP:', error);
        }

        const wsEndpoint = await chromiumManager.getDevToolsEndpoint(processInfo.devToolsPort);

        res.json({
            success: true,
            data: {
                profile_id: req.params.id,
                devtools_port: processInfo.devToolsPort,
                ws_endpoint: wsEndpoint,
                pid: processInfo.pid,
            },
        });
    }));

    /**
     * Stop browser profile
     */
    app.get('/v1.0/browser_profiles/:id/stop', asyncHandler(async (req: Request, res: Response) => {
        if (!chromiumManager.isProfileRunning(req.params.id)) {
            res.status(400).json({ error: 'Profile is not running' });
            return;
        }

        await chromiumManager.terminateProfile(req.params.id);
        res.json({ success: true });
    }));

    /**
     * Get profile status
     */
    app.get('/v1.0/browser_profiles/:id/status', asyncHandler(async (req: Request, res: Response) => {
        const isRunning = chromiumManager.isProfileRunning(req.params.id);
        const devToolsPort = chromiumManager.getDevToolsPort(req.params.id);

        res.json({
            success: true,
            data: {
                profile_id: req.params.id,
                is_running: isRunning,
                devtools_port: devToolsPort,
            },
        });
    }));

    /**
     * Unlock profile proxy tunnel after IP check
     */
    app.post('/v1.0/browser_profiles/:id/unlock', asyncHandler(async (req: Request, res: Response) => {
        await chromiumManager.unlockProfile(req.params.id);
        res.json({ success: true });
    }));

    // ==================== PROXY ENDPOINTS ====================

    app.post('/v1.0/proxies/create', asyncHandler(async (req: Request, res: Response) => {
        const { name, protocol, host, port, username, password, group_id } = req.body;

        if (!name || !protocol || !host || !port) {
            res.status(400).json({ error: 'name, protocol, host, and port are required' });
            return;
        }

        const proxy = await proxyManager.createProxy(name, protocol, host, port, username, password, group_id);
        res.json({ success: true, data: proxy });
    }));

    app.get('/v1.0/proxies', asyncHandler(async (req: Request, res: Response) => {
        const proxies = await proxyManager.listProxies();
        res.json({ success: true, data: proxies });
    }));

    app.get('/v1.0/proxies/:id', asyncHandler(async (req: Request, res: Response) => {
        const proxy = await proxyManager.getProxy(req.params.id);
        if (!proxy) {
            res.status(404).json({ error: 'Proxy not found' });
            return;
        }
        res.json({ success: true, data: proxy });
    }));

    app.delete('/v1.0/proxies/:id', asyncHandler(async (req: Request, res: Response) => {
        await proxyManager.deleteProxy(req.params.id);
        res.json({ success: true });
    }));

    app.post('/v1.0/proxies/:id/test', asyncHandler(async (req: Request, res: Response) => {
        const result = await proxyManager.testProxy(req.params.id);
        res.json({ success: true, data: result });
    }));

    // ==================== BULK PROXY ENDPOINTS ====================

    /**
     * Bulk import proxies from string (one per line)
     */
    app.post('/v1.0/proxies/bulk/import', asyncHandler(async (req: Request, res: Response) => {
        const { proxies_text, default_protocol } = req.body;

        if (!proxies_text) {
            res.status(400).json({ error: 'proxies_text is required' });
            return;
        }

        const result = await proxyManager.bulkImportFromString(proxies_text, default_protocol);
        res.json({ success: true, data: result });
    }));

    /**
     * Bulk import proxies from array
     */
    app.post('/v1.0/proxies/bulk/import-array', asyncHandler(async (req: Request, res: Response) => {
        const { proxies } = req.body;

        if (!Array.isArray(proxies)) {
            res.status(400).json({ error: 'proxies array is required' });
            return;
        }

        const result = await proxyManager.bulkImportFromArray(proxies);
        res.json({ success: true, data: result });
    }));

    /**
     * Bulk delete proxies
     */
    app.post('/v1.0/proxies/bulk/delete', asyncHandler(async (req: Request, res: Response) => {
        const { proxy_ids } = req.body;

        if (!Array.isArray(proxy_ids)) {
            res.status(400).json({ error: 'proxy_ids array is required' });
            return;
        }

        const result = await proxyManager.bulkDelete(proxy_ids);
        res.json({ success: true, data: result });
    }));

    // ==================== BULK PROFILE ENDPOINTS ====================

    /**
     * Bulk create profiles
     */
    app.post('/v1.0/browser_profiles/bulk/create', asyncHandler(async (req: Request, res: Response) => {
        const { count, name_prefix, template, proxy_ids, group_id, tags, options } = req.body;

        if (!count || count < 1) {
            res.status(400).json({ error: 'count must be at least 1' });
            return;
        }

        if (count > 1000) {
            res.status(400).json({ error: 'count cannot exceed 1000 per request' });
            return;
        }

        const result = await profileManager.bulkCreateProfiles(count, {
            namePrefix: name_prefix,
            template,
            proxyIds: proxy_ids,
            groupId: group_id,
            tags,
            ...(options || {})
        });

        res.json({ success: true, data: result });
    }));

    /**
     * Bulk delete profiles
     */
    app.post('/v1.0/browser_profiles/bulk/delete', asyncHandler(async (req: Request, res: Response) => {
        const { profile_ids } = req.body;

        if (!Array.isArray(profile_ids)) {
            res.status(400).json({ error: 'profile_ids array is required' });
            return;
        }

        // Stop running profiles first
        for (const id of profile_ids) {
            if (chromiumManager.isProfileRunning(id)) {
                await chromiumManager.terminateProfile(id);
            }
        }

        const result = await profileManager.bulkDeleteProfiles(profile_ids);
        res.json({ success: true, data: result });
    }));

    // ==================== COOKIE ENDPOINTS ====================

    app.get('/v1.0/browser_profiles/:id/cookies', asyncHandler(async (req: Request, res: Response) => {
        const cookies = await cookieManager.getCookies(req.params.id);
        res.json({ success: true, data: cookies });
    }));

    app.post('/v1.0/browser_profiles/:id/cookies', asyncHandler(async (req: Request, res: Response) => {
        const { cookies } = req.body;

        if (!Array.isArray(cookies)) {
            res.status(400).json({ error: 'cookies array is required' });
            return;
        }

        const imported = await cookieManager.importCookies(req.params.id, cookies);
        res.json({ success: true, data: { imported } });
    }));

    app.delete('/v1.0/browser_profiles/:id/cookies', asyncHandler(async (req: Request, res: Response) => {
        await cookieManager.deleteAllCookies(req.params.id);
        res.json({ success: true });
    }));

    app.get('/v1.0/browser_profiles/:id/cookies/export', asyncHandler(async (req: Request, res: Response) => {
        const cookies = await cookieManager.exportCookies(req.params.id);
        res.json({ success: true, data: cookies });
    }));

    // ==================== RPA ENDPOINTS ====================

    app.post('/v1.0/rpa/scenarios/create', asyncHandler(async (req: Request, res: Response) => {
        const { name, actions, profile_id } = req.body;

        if (!name || !actions) {
            res.status(400).json({ error: 'name and actions are required' });
            return;
        }

        const scenario = await rpaEngine.createScenario(name, actions, profile_id);
        res.json({ success: true, data: scenario });
    }));

    app.get('/v1.0/rpa/scenarios', asyncHandler(async (req: Request, res: Response) => {
        const profileId = req.query.profile_id as string;
        const scenarios = await rpaEngine.listScenarios(profileId);
        res.json({ success: true, data: scenarios });
    }));

    app.get('/v1.0/rpa/scenarios/:id', asyncHandler(async (req: Request, res: Response) => {
        const scenario = await rpaEngine.getScenario(req.params.id);
        if (!scenario) {
            res.status(404).json({ error: 'Scenario not found' });
            return;
        }
        res.json({ success: true, data: scenario });
    }));

    app.delete('/v1.0/rpa/scenarios/:id', asyncHandler(async (req: Request, res: Response) => {
        await rpaEngine.deleteScenario(req.params.id);
        res.json({ success: true });
    }));

    /**
     * Run RPA scenario
     */
    app.post('/v1.0/rpa/scenarios/:id/run', asyncHandler(async (req: Request, res: Response) => {
        const { profile_id } = req.body;
        const scenario = await rpaEngine.getScenario(req.params.id);

        if (!scenario) {
            return res.status(404).json({ success: false, error: 'Scenario not found' });
        }

        if (!profile_id) {
            return res.status(400).json({ success: false, error: 'profile_id is required' });
        }

        if (!chromiumManager.isProfileRunning(profile_id)) {
            return res.status(400).json({ success: false, error: 'Profile is not running. Start it first.' });
        }

        const devToolsPort = chromiumManager.getDevToolsPort(profile_id);
        if (!devToolsPort) {
            return res.status(500).json({ success: false, error: 'Could not get DevTools port' });
        }

        // We need puppeteer to connect and run actions
        const puppeteer = require('puppeteer-core');
        const wsEndpoint = await chromiumManager.getDevToolsEndpoint(devToolsPort);
        
        // Run in background
        (async () => {
            try {
                const browser = await puppeteer.connect({
                    browserWSEndpoint: wsEndpoint,
                    defaultViewport: null
                });
                const pages = await browser.pages();
                const page = pages.length > 0 ? pages[0] : await browser.newPage();
                
                await rpaEngine.executeScenario(page, scenario, {}, profile_id);
                await browser.disconnect();
                console.log(`✓ RPA Scenario "${scenario.name}" completed for profile ${profile_id}`);
            } catch (error) {
                console.error(`RPA Execution Error:`, error);
            }
        })();

        res.json({ success: true, message: 'Scenario execution started' });
    }));

    // ==================== EXTENSION ENDPOINTS ====================

    app.post('/v1.0/extensions/add', asyncHandler(async (req: Request, res: Response) => {
        const { name, path: sourcePath } = req.body;

        if (!name || !sourcePath) {
            res.status(400).json({ error: 'name and path are required' });
            return;
        }

        const extension = await extensionManager.addExtension(name, sourcePath);
        res.json({ success: true, data: extension });
    }));

    app.get('/v1.0/extensions', asyncHandler(async (req: Request, res: Response) => {
        const extensions = await extensionManager.listExtensions();
        res.json({ success: true, data: extensions });
    }));

    app.delete('/v1.0/extensions/:id', asyncHandler(async (req: Request, res: Response) => {
        await extensionManager.deleteExtension(req.params.id);
        res.json({ success: true });
    }));

    app.post('/v1.0/browser_profiles/:id/extensions', asyncHandler(async (req: Request, res: Response) => {
        const { extension_id } = req.body;

        if (!extension_id) {
            res.status(400).json({ error: 'extension_id is required' });
            return;
        }

        await extensionManager.assignToProfile(req.params.id, extension_id);
        res.json({ success: true });
    }));

    app.delete('/v1.0/browser_profiles/:id/extensions/:extensionId', asyncHandler(async (req: Request, res: Response) => {
        await extensionManager.removeFromProfile(req.params.id, req.params.extensionId);
        res.json({ success: true });
    }));

    app.get('/v1.0/browser_profiles/:id/extensions', asyncHandler(async (req: Request, res: Response) => {
        const extensions = await extensionManager.getProfileExtensions(req.params.id);
        res.json({ success: true, data: extensions });
    }));

    // ==================== PROFILE BOOKMARKS ENDPOINTS ====================

    app.get('/v1.0/browser_profiles/:id/bookmarks', asyncHandler(async (req: Request, res: Response) => {
        const bookmarks = await new Promise<any[]>((resolve, reject) => {
            db.all(
                `SELECT b.* FROM bookmarks b 
                 JOIN profile_bookmarks pb ON b.id = pb.bookmark_id 
                 WHERE pb.profile_id = ?`,
                [req.params.id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
        res.json({ success: true, data: bookmarks });
    }));

    app.post('/v1.0/browser_profiles/:id/bookmarks', asyncHandler(async (req: Request, res: Response) => {
        const { bookmark_id } = req.body;
        if (!bookmark_id) return res.status(400).json({ error: 'bookmark_id is required' });

        await new Promise<void>((resolve, reject) => {
            db.run(
                'INSERT OR IGNORE INTO profile_bookmarks (profile_id, bookmark_id) VALUES (?, ?)',
                [req.params.id, bookmark_id],
                (err) => err ? reject(err) : resolve()
            );
        });
        res.json({ success: true });
    }));

    app.delete('/v1.0/browser_profiles/:id/bookmarks/:bookmarkId', asyncHandler(async (req: Request, res: Response) => {
        await new Promise<void>((resolve, reject) => {
            db.run(
                'DELETE FROM profile_bookmarks WHERE profile_id = ? AND bookmark_id = ?',
                [req.params.id, req.params.bookmarkId],
                (err) => err ? reject(err) : resolve()
            );
        });
        res.json({ success: true });
    }));

    app.post('/v1.0/extensions/chrome-store/install', asyncHandler(async (req: Request, res: Response) => {
        const { extensionId } = req.body;
        if (!extensionId) {
            return res.status(400).json({ success: false, error: 'extensionId is required' });
        }
        const extension = await extensionManager.installFromChromeStore(extensionId);
        res.json({ success: true, data: extension });
    }));

    // ==================== 2FA/TOTP ENDPOINTS ====================

    app.post('/v1.0/browser_profiles/:id/totp', asyncHandler(async (req: Request, res: Response) => {
        const { name, secret, issuer, digits, period, algorithm } = req.body;

        if (!name || !secret) {
            res.status(400).json({ error: 'name and secret are required' });
            return;
        }

        const totpSecret = await totpManager.addSecret(req.params.id, name, secret, {
            issuer, digits, period, algorithm,
        });
        res.json({ success: true, data: totpSecret });
    }));

    app.get('/v1.0/browser_profiles/:id/totp', asyncHandler(async (req: Request, res: Response) => {
        const secrets = await totpManager.getSecrets(req.params.id);
        res.json({ success: true, data: secrets });
    }));

    app.get('/v1.0/totp/:id/code', asyncHandler(async (req: Request, res: Response) => {
        const secret = await totpManager.getSecret(req.params.id);

        if (!secret) {
            res.status(404).json({ error: 'TOTP secret not found' });
            return;
        }

        const code = totpManager.generateCode(secret);
        const timeRemaining = totpManager.getTimeRemaining(secret.period);

        res.json({
            success: true,
            data: {
                code,
                time_remaining: timeRemaining,
                period: secret.period,
            },
        });
    }));

    app.delete('/v1.0/totp/:id', asyncHandler(async (req: Request, res: Response) => {
        await totpManager.deleteSecret(req.params.id);
        res.json({ success: true });
    }));

    app.post('/v1.0/totp/parse-uri', asyncHandler(async (req: Request, res: Response) => {
        const { uri } = req.body;

        if (!uri) {
            res.status(400).json({ error: 'uri is required' });
            return;
        }

        const parsed = totpManager.parseOtpAuthUri(uri);

        if (!parsed) {
            res.status(400).json({ error: 'Invalid otpauth URI' });
            return;
        }

        res.json({ success: true, data: parsed });
    }));

    // ==================== IP CHECKER ENDPOINTS ====================

    app.post('/v1.0/proxies/check', asyncHandler(async (req: Request, res: Response) => {
        const { protocol, host, port, username, password } = req.body;
        
        if (!host || !port) {
            res.status(400).json({ error: 'host and port are required' });
            return;
        }

        const result = await ipChecker.checkProxyIP({
            protocol: protocol || 'http',
            host,
            port,
            username,
            password
        });

        res.json({ 
            success: true, 
            data: { 
                working: result.success, 
                ip: result.info?.ip,
                country: result.info?.country,
                countryCode: result.info?.countryCode,
                city: result.info?.city,
                latency: result.latency
            } 
        });
    }));

    app.get('/v1.0/ip/check', asyncHandler(async (req: Request, res: Response) => {
        const result = await ipChecker.getMyIP();
        const profileId = req.query.profileId as string;
        
        if (profileId && result.success && result.info) {
            await profileManager.updateProfileIP(profileId, {
                ip: result.info.ip,
                country: result.info.countryCode || result.info.country, // Store code for flags
                city: result.info.city
            });
        }
        
        res.json({ success: true, data: result });
    }));

    app.post('/v1.0/browser_profiles/:id/ip-update', asyncHandler(async (req: Request, res: Response) => {
        const { ip, country, city, proxy_error } = req.body;
        await profileManager.updateProfileIP(req.params.id, { ip, country, city, proxy_error });
        res.json({ success: true });
    }));

    app.get('/v1.0/proxies/:id/check', asyncHandler(async (req: Request, res: Response) => {
        const proxy = await proxyManager.getProxy(req.params.id);

        if (!proxy) {
            res.status(404).json({ error: 'Proxy not found' });
            return;
        }

        try {
            const result = await ipChecker.checkProxyIP(proxy);
            res.json({ 
                success: true, 
                data: { 
                    working: result.success, 
                    ip: result.info?.ip,
                    country: result.info?.country,
                    countryCode: result.info?.countryCode,
                    city: result.info?.city
                } 
            });
        } catch (error) {
            res.json({ success: true, data: { working: false } });
        }
    }));

    app.post('/v1.0/proxies/:id/ip-check', asyncHandler(async (req: Request, res: Response) => {
        const proxy = await proxyManager.getProxy(req.params.id);

        if (!proxy) {
            res.status(404).json({ error: 'Proxy not found' });
            return;
        }

        const result = await ipChecker.checkProxyIP(proxy);
        res.json({ success: true, data: result });
    }));

    // ==================== GROUP ENDPOINTS ====================

    app.post('/v1.0/groups/create', asyncHandler(async (req: Request, res: Response) => {
        const { name, color, description } = req.body;

        if (!name) {
            res.status(400).json({ error: 'name is required' });
            return;
        }

        const group = await groupManager.createGroup(name, { color, description });
        res.json({ success: true, data: group });
    }));

    app.get('/v1.0/groups', asyncHandler(async (req: Request, res: Response) => {
        const groups = await groupManager.listGroups();
        res.json({ success: true, data: groups });
    }));

    app.get('/v1.0/groups/:id', asyncHandler(async (req: Request, res: Response) => {
        const group = await groupManager.getGroup(req.params.id);

        if (!group) {
            res.status(404).json({ error: 'Group not found' });
            return;
        }

        res.json({ success: true, data: group });
    }));

    app.put('/v1.0/groups/:id', asyncHandler(async (req: Request, res: Response) => {
        await groupManager.updateGroup(req.params.id, req.body);
        res.json({ success: true });
    }));

    app.delete('/v1.0/groups/:id', asyncHandler(async (req: Request, res: Response) => {
        await groupManager.deleteGroup(req.params.id);
        res.json({ success: true });
    }));

    app.get('/v1.0/groups/:id/profiles', asyncHandler(async (req: Request, res: Response) => {
        const profiles = await groupManager.getGroupProfiles(req.params.id);
        res.json({ success: true, data: profiles });
    }));

    app.post('/v1.0/groups/:id/move-profiles', asyncHandler(async (req: Request, res: Response) => {
        const { profile_ids } = req.body;

        if (!Array.isArray(profile_ids)) {
            res.status(400).json({ error: 'profile_ids array is required' });
            return;
        }

        const count = await groupManager.moveProfilesToGroup(profile_ids, req.params.id);
        res.json({ success: true, data: { moved: count } });
    }));

    app.post('/v1.0/groups/:id/assign-proxy', asyncHandler(async (req: Request, res: Response) => {
        const { proxy_id } = req.body;
        const count = await groupManager.bulkAssignProxy(req.params.id, proxy_id || null);
        res.json({ success: true, data: { updated: count } });
    }));

    // ==================== SYSTEM ENDPOINTS ====================

    app.get('/v1.0/browser_profiles/running/list', asyncHandler(async (req: Request, res: Response) => {
        const runningProfiles = chromiumManager.getRunningProfiles();
        res.json({
            success: true,
            data: {
                count: runningProfiles.length,
                profiles: runningProfiles,
            },
        });
    }));

    app.post('/v1.0/system/shutdown', asyncHandler(async (req: Request, res: Response) => {
        await chromiumManager.terminateAll();
        res.json({ success: true, message: 'All browser instances terminated' });
    }));

    // ==================== FREE PROXY ENDPOINTS ====================

    // Fetch free proxies from public sources
    app.post('/v1.0/proxies/free/fetch', asyncHandler(async (req: Request, res: Response) => {
        const { sources = ['proxyscrape', 'geonode'], groupId = 'free-proxies', testBeforeImport = false, maxProxies = 50 } = req.body;
        
        console.log('Free proxy fetch request:', { sources, groupId, testBeforeImport, maxProxies });
        
        const result = await freeProxyFetcher.fetchAndImport(sources, groupId, testBeforeImport, maxProxies);
        
        console.log('Free proxy fetch result:', result);
        
        res.json({
            success: true,
            data: result
        });
    }));

    // Get available free proxy sources
    app.get('/v1.0/proxies/free/sources', (req: Request, res: Response) => {
        res.json({
            success: true,
            data: {
                sources: [
                    { id: 'proxyscrape', name: 'ProxyScrape HTTP', description: 'HTTP proxies from ProxyScrape API' },
                    { id: 'proxyscrape_socks4', name: 'ProxyScrape SOCKS4', description: 'SOCKS4 proxies from ProxyScrape API' },
                    { id: 'proxyscrape_socks5', name: 'ProxyScrape SOCKS5', description: 'SOCKS5 proxies from ProxyScrape API' },
                    { id: 'geonode', name: 'GeoNode', description: 'Proxies from GeoNode with country info' },
                    { id: 'pubproxy', name: 'PubProxy', description: 'Free proxies from PubProxy (rate limited)' }
                ]
            }
        });
    });

    // Get proxies by group
    app.get('/v1.0/proxies/group/:groupId', asyncHandler(async (req: Request, res: Response) => {
        const { groupId } = req.params;
        
        // Get proxies with usage count
        const proxies = await new Promise<any[]>((resolve, reject) => {
            db.all(`
                SELECT p.*, 
                    (SELECT COUNT(*) FROM profiles WHERE proxy_id = p.id) as usage_count
                FROM proxies p 
                WHERE p.group_id = ? 
                ORDER BY usage_count ASC, p.created_at DESC
            `, [groupId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows as any[] || []);
            });
        });
        
        res.json({
            success: true,
            data: proxies
        });
    }));

    // Set proxy group
    app.put('/v1.0/proxies/:id/group', asyncHandler(async (req: Request, res: Response) => {
        const { id } = req.params;
        const { group_id } = req.body;
        
        await new Promise<void>((resolve, reject) => {
            db.run('UPDATE proxies SET group_id = ? WHERE id = ?', [group_id, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        res.json({ success: true });
    }));

    // Bulk set proxy group
    app.post('/v1.0/proxies/bulk/group', asyncHandler(async (req: Request, res: Response) => {
        const { proxy_ids, group_id } = req.body;
        
        if (!Array.isArray(proxy_ids) || proxy_ids.length === 0) {
            return res.status(400).json({ success: false, error: 'proxy_ids array required' });
        }
        
        const placeholders = proxy_ids.map(() => '?').join(',');
        
        await new Promise<void>((resolve, reject) => {
            db.run(`UPDATE proxies SET group_id = ? WHERE id IN (${placeholders})`, [group_id, ...proxy_ids], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        res.json({ success: true, data: { updated: proxy_ids.length } });
    }));

    // Get proxy groups list
    app.get('/v1.0/proxies/groups/list', asyncHandler(async (req: Request, res: Response) => {
        const groups = await new Promise<any[]>((resolve, reject) => {
            db.all(`
                SELECT group_id, COUNT(*) as count 
                FROM proxies 
                WHERE group_id IS NOT NULL AND group_id != ''
                GROUP BY group_id 
                ORDER BY group_id
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows as any[] || []);
            });
        });
        
        res.json({
            success: true,
            data: groups
        });
    }));

    // Delete proxies by group
    app.delete('/v1.0/proxies/group/:groupId', asyncHandler(async (req: Request, res: Response) => {
        const { groupId } = req.params;
        
        const result = await new Promise<number>((resolve, reject) => {
            db.run('DELETE FROM proxies WHERE group_id = ?', [groupId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
        
        res.json({ success: true, data: { deleted: result } });
    }));

    // ==================== EXTENSIONS API ====================

    app.get('/v1.0/extensions', asyncHandler(async (req: Request, res: Response) => {
        const extensions = await extensionManager.getAllExtensions();
        res.json({ success: true, data: extensions });
    }));

    app.post('/v1.0/extensions', asyncHandler(async (req: Request, res: Response) => {
        const { name, path, is_default } = req.body;
        if (!name || !path) {
            return res.status(400).json({ success: false, error: 'Name and path are required' });
        }
        const id = await extensionManager.addDefaultExtension(name, path, is_default || false);
        res.json({ success: true, data: { id } });
    }));

    app.delete('/v1.0/extensions/:id', asyncHandler(async (req: Request, res: Response) => {
        await extensionManager.removeExtension(req.params.id);
        res.json({ success: true });
    }));

    // ==================== BOOKMARKS API ====================

    app.get('/v1.0/bookmarks', asyncHandler(async (req: Request, res: Response) => {
        const bookmarks = await new Promise<any[]>((resolve, reject) => {
            db.all('SELECT * FROM bookmarks ORDER BY created_at DESC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        res.json({ success: true, data: bookmarks });
    }));

    app.post('/v1.0/bookmarks/bulk', asyncHandler(async (req: Request, res: Response) => {
        const { bookmarks } = req.body;
        if (!bookmarks || !Array.isArray(bookmarks)) {
            return res.status(400).json({ success: false, error: 'Bookmarks array required' });
        }
        
        let added = 0;
        for (const bm of bookmarks) {
            if (bm.name && bm.url) {
                const id = `bm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                await new Promise<void>((resolve, reject) => {
                    db.run(
                        'INSERT INTO bookmarks (id, name, url, created_at) VALUES (?, ?, ?, ?)',
                        [id, bm.name, bm.url, new Date().toISOString()],
                        (err) => { if (err) reject(err); else resolve(); }
                    );
                });
                added++;
            }
        }
        res.json({ success: true, data: { added } });
    }));

    app.delete('/v1.0/bookmarks/:id', asyncHandler(async (req: Request, res: Response) => {
        await new Promise<void>((resolve, reject) => {
            db.run('DELETE FROM bookmarks WHERE id = ?', [req.params.id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        res.json({ success: true });
    }));

    /**
     * Mass manage bookmarks for profiles
     */
    app.post('/v1.0/bookmarks/mass-manage', asyncHandler(async (req: Request, res: Response) => {
        const { action, target, groupId, bookmarkIds } = req.body;

        if (!action || !target || !bookmarkIds || !Array.isArray(bookmarkIds)) {
            return res.status(400).json({ success: false, error: 'action, target, and bookmarkIds array required' });
        }

        let profileIds: string[] = [];

        if (target === 'all') {
            const allProfiles = await profileManager.listProfiles();
            profileIds = allProfiles.map(p => p.id);
        } else if (target === 'group') {
            if (!groupId) return res.status(400).json({ success: false, error: 'groupId is required for group target' });
            const groupProfiles = await profileManager.getProfilesByGroup(groupId);
            profileIds = groupProfiles.map(p => p.id);
        }

        if (profileIds.length === 0) {
            return res.json({ success: true, message: 'No profiles found to update', updated: 0 });
        }

        if (action === 'add') {
            await profileManager.assignBookmarksToProfiles(profileIds, bookmarkIds);
        } else if (action === 'remove') {
            await profileManager.removeBookmarksFromProfiles(profileIds, bookmarkIds);
        } else if (action === 'clear') {
            await profileManager.removeAllBookmarksFromProfiles(profileIds);
        }

        res.json({ success: true, updated: profileIds.length });
    }));

    // ==================== JARVIS AI ENDPOINTS ====================

    /**
     * Get Jarvis Configuration
     */
    app.get('/v1.0/jarvis/config', asyncHandler(async (req: Request, res: Response) => {
        const config: any = await new Promise((resolve) => {
            db.get('SELECT * FROM jarvis_config WHERE id = 1', (err, row) => resolve(row));
        });
        
        if (config) {
            // Mask sensitive fields
            if (config.api_key) config.api_key = '********';
            if (config.tg_token) config.tg_token = '********';
            if (config.tg_chat_id) config.tg_chat_id = '********';
            // tg_whitelist is usually fine to show as it's just IDs, but it was decrypted in UI anyway
        }
        
        res.json({ success: true, data: config || {} });
    }));

    /**
     * Update Jarvis Configuration
     */
    app.post('/v1.0/jarvis/config', asyncHandler(async (req: Request, res: Response) => {
        const { 
            provider, api_url, api_key, model_name, master_profile_id, permission_level, system_prompt, is_enabled,
            tg_token, tg_chat_id, tg_whitelist, tg_notify_success, tg_notify_error, tg_notify_summary,
            tg_mode, mcp_servers, tg_safe_tools, tg_requires_2fa
        } = req.body;
        
        // Encrypt API key and TG tokens if provided. 
        // If undefined, '********' or empty (and we have an old value), we keep old value.
        // If null, we clear it.
        const encryptIfProvided = (val: any, oldVal: string | null | undefined) => {
            if (val === undefined || val === '********' || (val === '' && oldVal)) return oldVal;
            if (val === null || val === '') return null;
            return EncryptionService.encrypt(val);
        };

        // Get current config to handle partial updates properly
        const currentConfig: any = await new Promise((resolve) => {
            db.get('SELECT * FROM jarvis_config WHERE id = 1', (err, row) => resolve(row));
        });

        const encryptedKey = encryptIfProvided(api_key, currentConfig?.api_key);
        const encryptedTgToken = encryptIfProvided(tg_token, currentConfig?.tg_token);
        const encryptedTgChatId = encryptIfProvided(tg_chat_id, currentConfig?.tg_chat_id);
        const encryptedTgWhitelist = encryptIfProvided(tg_whitelist, currentConfig?.tg_whitelist);
        
        await new Promise<void>((resolve, reject) => {
            db.run(`
                INSERT INTO jarvis_config (
                    id, provider, api_url, api_key, model_name, master_profile_id, permission_level, system_prompt, is_enabled, 
                    tg_token, tg_chat_id, tg_whitelist, tg_notify_success, tg_notify_error, tg_notify_summary,
                    tg_mode, mcp_servers, tg_safe_tools, tg_requires_2fa, updated_at
                )
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    provider = excluded.provider,
                    api_url = excluded.api_url,
                    api_key = excluded.api_key,
                    model_name = excluded.model_name,
                    master_profile_id = excluded.master_profile_id,
                    permission_level = excluded.permission_level,
                    system_prompt = excluded.system_prompt,
                    is_enabled = excluded.is_enabled,
                    tg_token = excluded.tg_token,
                    tg_chat_id = excluded.tg_chat_id,
                    tg_whitelist = excluded.tg_whitelist,
                    tg_notify_success = excluded.tg_notify_success,
                    tg_notify_error = excluded.tg_notify_error,
                    tg_notify_summary = excluded.tg_notify_summary,
                    tg_mode = excluded.tg_mode,
                    mcp_servers = excluded.mcp_servers,
                    tg_safe_tools = excluded.tg_safe_tools,
                    tg_requires_2fa = excluded.tg_requires_2fa,
                    updated_at = excluded.updated_at
            `, [
                provider || 'openai',
                api_url || (provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1'),
                encryptedKey,
                model_name || 'gpt-4o',
                master_profile_id,
                permission_level || 'standard',
                system_prompt,
                is_enabled ? 1 : 0,
                encryptedTgToken,
                encryptedTgChatId,
                encryptedTgWhitelist,
                tg_notify_success === undefined ? (currentConfig?.tg_notify_success ?? 1) : (tg_notify_success ? 1 : 0),
                tg_notify_error === undefined ? (currentConfig?.tg_notify_error ?? 1) : (tg_notify_error ? 1 : 0),
                tg_notify_summary === undefined ? (currentConfig?.tg_notify_summary ?? 1) : (tg_notify_summary ? 1 : 0),
                tg_mode || 'notify',
                mcp_servers || '[]',
                tg_safe_tools || '[]',
                tg_requires_2fa === undefined ? (currentConfig?.tg_requires_2fa ?? 1) : (tg_requires_2fa ? 1 : 0),
                Date.now()
            ], (err) => err ? reject(err) : resolve());
        });

        // Refresh service config
        const newConfig = await new Promise<any>((resolve) => {
            db.get('SELECT * FROM jarvis_config WHERE id = 1', (err, row) => resolve(row));
        });
        if (newConfig) {
            await jarvisService.setConfig(newConfig);
            telegramService.updateConfig(newConfig);
            jarvisToolManager = new JarvisToolManager(
                db, 
                newConfig, 
                profileManager, 
                proxyManager, 
                chromiumManager, 
                rpaEngine,
                jarvisTaskManager,
                extensionManager,
                jarvisController,
                jarvisService.getMCPManager()
            );
        }

        res.json({ success: true });
    }));

    /**
     * Ask Jarvis (Chat)
     */
    app.post('/v1.0/jarvis/chat', asyncHandler(async (req: Request, res: Response) => {
        let { message, history, session_id, confirmed, attached_files, page_context } = req.body;
        
        if (!message) return res.status(400).json({ error: 'message is required' });

        // Load history and files from DB if session_id provided and they are missing in request
        if (session_id && (!history || !attached_files)) {
            const session: any = await new Promise((resolve) => {
                db.get('SELECT * FROM jarvis_sessions WHERE id = ?', [session_id], (err, row) => resolve(row));
            });
            if (session) {
                if (!history) {
                    try {
                        history = JSON.parse(EncryptionService.decrypt(session.history));
                    } catch (e) { history = []; }
                }
                if (!attached_files) {
                    try {
                        const decryptedFiles = EncryptionService.decrypt(session.attached_files);
                        attached_files = JSON.parse(decryptedFiles || '[]');
                    } catch (e) { attached_files = []; }
                }
            }
        }

        // Initialize service if not yet configured
        const config: any = await new Promise((resolve) => {
            db.get('SELECT * FROM jarvis_config WHERE id = 1', (err, row) => resolve(row));
        });
        if (config) await jarvisService.setConfig(config);

        let currentHistory = [...(history || [])];
        let currentMessage = message;
        let finalResponse = '';
        let toolResult = null;
        let loopCount = 0;
        const maxLoops = 10;

        while (loopCount < maxLoops) {
            loopCount++;
            const response = await jarvisService.askJarvis(currentMessage, currentHistory, attached_files || [], page_context);
            finalResponse += (finalResponse ? '\n\n' : '') + response;
            
            // Tool calling logic
            if (response.includes('"action": "callTool"') && jarvisToolManager) {
                try {
                    // Find JSON block
                    const jsonMatch = response.match(/\{[\s\S]*"action":\s*"callTool"[\s\S]*\}/);
                    if (jsonMatch) {
                        const toolCall = JSON.parse(jsonMatch[0]);
                        
                        // Merge external confirmation into tool args (only for the first iteration or if specifically passed)
                        const toolArgs = { ...toolCall.args, confirmed: loopCount === 1 ? confirmed : undefined };
                        const result = await jarvisToolManager.executeTool(toolCall.tool, toolArgs);
                        toolResult = result;

                        if (result.success) {
                            const successMsg = `[System] Tool executed successfully: ${JSON.stringify(result.data)}`;
                            finalResponse += `\n\n${successMsg}`;
                            
                            // If it requires confirmation (e.g. from ToolManager logic), we stop and ask user
                            if (result.requiresConfirmation) break;

                            // Otherwise, feed the result back to Jarvis to continue the task
                            currentHistory.push({ role: 'user', content: currentMessage });
                            currentHistory.push({ role: 'assistant', content: response });
                            currentMessage = successMsg;
                            continue; // Continue loop to get next action
                        } else {
                            const errorMsg = `[System Error] ${result.error}`;
                            finalResponse += `\n\n${errorMsg}`;
                            
                            if (result.requiresConfirmation) break;

                            // Feed error back to Jarvis so it can try to fix it or explain
                            currentHistory.push({ role: 'user', content: currentMessage });
                            currentHistory.push({ role: 'assistant', content: response });
                            currentMessage = errorMsg;
                            continue;
                        }
                    }
                } catch (e: any) {
                    console.error('Jarvis Tool Call parsing failed:', e.message);
                    break;
                }
            }
            
            // If no tool call or loop finished, break
            break;
        }
        
        // Save to history if session_id provided
        if (session_id) {
            const updatedHistory = [...(history || []), { role: 'user', content: message }, { role: 'assistant', content: finalResponse }];
            const encryptedHistory = EncryptionService.encrypt(JSON.stringify(updatedHistory));
            
            await new Promise<void>((resolve) => {
                db.run('UPDATE jarvis_sessions SET history = ?, updated_at = ? WHERE id = ?', 
                [encryptedHistory, Date.now(), session_id], () => resolve());
            });
        }

        res.json({ success: true, data: { response: finalResponse, toolResult } });
    }));

    /**
     * Recording Control
     */
    app.post('/v1.0/jarvis/recorder/start', asyncHandler(async (req: Request, res: Response) => {
        const { profile_id } = req.body;
        if (!profile_id) return res.status(400).json({ error: 'profile_id is required' });
        
        await jarvisController.startRecording(profile_id);
        res.json({ success: true });
    }));

    app.post('/v1.0/jarvis/recorder/pause', asyncHandler(async (req: Request, res: Response) => {
        await jarvisController.pauseRecording();
        res.json({ success: true });
    }));

    app.post('/v1.0/jarvis/recorder/stop', asyncHandler(async (req: Request, res: Response) => {
        const rawLogs = await jarvisController.stopRecording();
        
        // Optional: Auto-humanize logs if they aren't empty
        let humanReadable = '';
        if (rawLogs && rawLogs.length > 0) {
            try {
                humanReadable = await jarvisService.humanizeLogs(JSON.stringify(rawLogs));
            } catch (e) {
                console.error('Failed to humanize logs:', e);
                humanReadable = JSON.stringify(rawLogs, null, 2);
            }
        }

        res.json({ success: true, data: { rawLogs, humanReadable } });
    }));

    app.get('/v1.0/jarvis/recorder/status', (req: Request, res: Response) => {
        res.json({ 
            success: true, 
            data: { 
                is_recording: jarvisController.isRecording(),
                profile_id: jarvisController.getRecordingProfileId()
            } 
        });
    });

    app.get('/v1.0/jarvis/recorder/detailed-status', asyncHandler(async (req: Request, res: Response) => {
        const status = await jarvisController.getRecordingStatus();
        res.json({ success: true, data: status });
    }));

    /**
     * Jarvis Sessions
     */
    app.get('/v1.0/jarvis/sessions', asyncHandler(async (req: Request, res: Response) => {
        const sessions = await new Promise<any[]>((resolve, reject) => {
            db.all('SELECT id, title, created_at, updated_at FROM jarvis_sessions ORDER BY updated_at DESC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        res.json({ success: true, data: sessions });
    }));

    app.get('/v1.0/jarvis/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
        const session = await new Promise<any>((resolve, reject) => {
            db.get('SELECT * FROM jarvis_sessions WHERE id = ?', [req.params.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Decrypt history
        try {
            session.history = JSON.parse(EncryptionService.decrypt(session.history));
        } catch (e) {
            session.history = [];
        }

        // Decrypt files if encrypted
        try {
            if (session.attached_files) {
                const decrypted = EncryptionService.decrypt(session.attached_files);
                session.attached_files = decrypted || session.attached_files; // Fallback if it wasn't encrypted yet
            }
        } catch (e) {}

        res.json({ success: true, data: session });
    }));

    app.post('/v1.0/jarvis/sessions', asyncHandler(async (req: Request, res: Response) => {
        const { title } = req.body;
        const id = uuidv4();
        const now = Date.now();
        const encryptedHistory = EncryptionService.encrypt(JSON.stringify([]));

        await new Promise<void>((resolve, reject) => {
            db.run(
                'INSERT INTO jarvis_sessions (id, title, history, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                [id, title || 'New Session', encryptedHistory, now, now],
                (err) => err ? reject(err) : resolve()
            );
        });

        res.json({ success: true, data: { id, title, created_at: now, updated_at: now } });
    }));

    app.delete('/v1.0/jarvis/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
        await new Promise<void>((resolve, reject) => {
            db.run('DELETE FROM jarvis_sessions WHERE id = ?', [req.params.id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        res.json({ success: true });
    }));

    /**
     * Update session attached files
     */
    app.post('/v1.0/jarvis/sessions/:id/files', asyncHandler(async (req: Request, res: Response) => {
        const { files } = req.body;
        if (!Array.isArray(files)) return res.status(400).json({ error: 'files array required' });

        const encryptedFiles = EncryptionService.encrypt(JSON.stringify(files));

        await new Promise<void>((resolve, reject) => {
            db.run('UPDATE jarvis_sessions SET attached_files = ?, updated_at = ? WHERE id = ?', 
            [encryptedFiles, Date.now(), req.params.id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        res.json({ success: true });
    }));

    /**
     * Jarvis Test Run
     */
    app.post('/v1.0/jarvis/test-run', asyncHandler(async (req: Request, res: Response) => {
        const { actions } = req.body;
        if (!actions || !Array.isArray(actions)) return res.status(400).json({ error: 'actions array is required' });

        const config = await new Promise<any>((resolve) => {
            db.get('SELECT master_profile_id FROM jarvis_config WHERE id = 1', (err, row) => resolve(row));
        });

        const profileId = config?.master_profile_id;
        if (!profileId) return res.status(400).json({ error: 'Master Profile not configured. Set it in Jarvis settings.' });

        // If profile is already running, we'll use it. If not, start it.
        let devToolsPort = chromiumManager.getDevToolsPort(profileId);
        if (!devToolsPort) {
            // Start profile first (minimal launch)
            const profileData = await profileManager.getProfileWithFingerprint(profileId);
            if (!profileData) return res.status(404).json({ error: 'Master profile not found' });
            
            const launchInfo = await chromiumManager.launchProfile(profileId, profileData.profile.user_data_dir);
            devToolsPort = launchInfo.devToolsPort;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const wsEndpoint = await chromiumManager.getDevToolsEndpoint(devToolsPort);
        const puppeteer = require('puppeteer-core');
        
        // Execute in background and notify via log? Or return success immediately?
        // Let's do a quick execution for the test run.
        try {
            const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
            const pages = await browser.pages();
            const page = pages.length > 0 ? pages[0] : await browser.newPage();
            
            const result = await rpaEngine.executeScenario(page, {
                id: 'test-run',
                name: 'Jarvis Test Run',
                actions,
                profile_id: profileId,
                created_at: Date.now()
            }, {}, profileId);

            await browser.disconnect();
            res.json({ success: true, data: result });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    }));

    /**
     * Jarvis Tasks (Batch Execution) - Sorted by priority
     */
    app.get('/v1.0/jarvis/tasks', asyncHandler(async (req: Request, res: Response) => {
        const tasks = await new Promise<any[]>((resolve, reject) => {
            // Priority: failed (red) > running (green) > pending (grey) > completed (low priority)
            const query = `
                SELECT * FROM jarvis_tasks 
                ORDER BY 
                    CASE 
                        WHEN status = 'failed' THEN 1
                        WHEN status = 'running' THEN 2
                        WHEN status = 'pending' THEN 3
                        ELSE 4 
                    END ASC,
                    created_at DESC
            `;
            db.all(query, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        res.json({ success: true, data: tasks });
    }));

    app.post('/v1.0/jarvis/tasks', asyncHandler(async (req: Request, res: Response) => {
        const { name, script_id, profile_ids, scheduled_at, repeat_interval, cron_expression } = req.body;
        if (!script_id || !profile_ids || !Array.isArray(profile_ids)) {
            return res.status(400).json({ error: 'script_id and profile_ids array required' });
        }

        const taskId = await jarvisTaskManager.createTask(name || 'Jarvis Task', script_id, profile_ids, {
            scheduledAt: scheduled_at,
            repeatInterval: repeat_interval,
            cronExpression: cron_expression
        });
        res.json({ success: true, data: { taskId } });
    }));

    app.get('/v1.0/jarvis/tasks/:id/logs', asyncHandler(async (req: Request, res: Response) => {
        const logs = await new Promise<any[]>((resolve, reject) => {
            db.all('SELECT * FROM jarvis_execution_logs WHERE session_id = ?', [req.params.id], (err, rows) => {
                if (err) reject(err);
                else {
                    const decryptedRows = (rows || []).map((row: any) => ({
                        ...row,
                        log_data: row.log_data ? EncryptionService.decrypt(row.log_data) : ''
                    }));
                    resolve(decryptedRows);
                }
            });
        });
        res.json({ success: true, data: logs });
    }));

    /**
     * Zapier / Make Webhook Integration
     */
    app.post('/v1.0/jarvis/webhook/:key', asyncHandler(async (req: Request, res: Response) => {
        const { key } = req.params;
        const { action, profile_id, scenario_id, name, message } = req.body;

        // Simple security check (could be improved with a dedicated field in jarvis_config)
        const config: any = await new Promise((resolve) => {
            db.get('SELECT api_key FROM jarvis_config WHERE id = 1', (err, row) => resolve(row));
        });
        
        if (!config || !config.api_key || EncryptionService.decrypt(config.api_key) !== key) {
            // If they provided the key as-is, check against the decrypted one
            const providedKey = req.headers['x-api-key'] || key;
            if (EncryptionService.decrypt(config.api_key) !== providedKey) {
                return res.status(401).json({ success: false, error: 'Invalid Webhook Key' });
            }
        }

        console.log(`[Webhook] Received action: ${action}`);

        if (action === 'run_scenario') {
            const taskId = await jarvisTaskManager.createTask(
                name || 'Webhook Task',
                scenario_id,
                [profile_id]
            );
            return res.json({ success: true, taskId });
        }

        if (action === 'ask_jarvis') {
            const response = await jarvisService.askJarvis(message);
            return res.json({ success: true, response });
        }

        res.status(400).json({ success: false, error: 'Unknown action' });
    }));

    // ==================== HEALTH CHECK ====================

    app.get('/health', (req: Request, res: Response) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            running_profiles: chromiumManager.getRunningProfiles().length,
            version: '0.4.1',
            features: {
                profiles: true,
                advanced_fingerprinting: true,
                proxies: true,
                cookies: true,
                rpa: true,
                templates: true,
                full_config: true,
                extensions: true,
                totp_2fa: true,
                ip_checker: true,
                groups: true,
                free_proxies: true,
            },
        });
    });

    app.get('/', (req: Request, res: Response) => {
        res.json({
            name: 'DolfPower AntiDetect Browser API',
            version: '0.4.0',
            status: 'Complete Implementation',
            features_completed: [
                'Sprint 1: Core Infrastructure',
                'Sprint 2: Advanced Fingerprinting',
                'Sprint 3: Proxy & Network',
                'Sprint 4: Browser Automation',
                'Sprint 5: Cookies & Persistence',
                'FIXED: Comprehensive Profile Configuration',
                'FIXED: Proper Chromium Flags',
                'FIXED: 40+ Fingerprint Parameters',
            ],
            endpoints: {
                profiles: '/v1.0/browser_profiles',
                templates: '/v1.0/browser_profiles/templates/list',
                fingerprint: '/v1.0/fingerprint/generate',
                proxies: '/v1.0/proxies',
                cookies: '/v1.0/browser_profiles/:id/cookies',
                rpa: '/v1.0/rpa/scenarios',
                health: '/health',
            },
        });
    });

    /**
     * Test Telegram Notification
     */
    app.post('/v1.0/jarvis/tg-test', asyncHandler(async (req: Request, res: Response) => {
        const { token, chatId } = req.body;
        
        // If values are masked, use the saved ones from telegramService
        const useToken = (token && token !== '********') ? token : undefined;
        const useChatId = (chatId && chatId !== '********') ? chatId : undefined;
        
        let success = false;
        if (useToken && useChatId) {
            // Test with provided (unsaved) credentials
            try {
                await axios.post(`https://api.telegram.org/bot${useToken}/sendMessage`, {
                    chat_id: useChatId,
                    text: '🔔 <b>Test Notification</b> from DolfPower (Unsaved Config).\n\nIf you see this, your credentials are correct!',
                    parse_mode: 'HTML'
                });
                success = true;
            } catch (e: any) {
                return res.status(500).json({ 
                    success: false, 
                    error: `Telegram Error: ${e.response?.data?.description || e.message}. Make sure you started the bot with /start command.` 
                });
            }
        } else {
            // Test with saved config
            success = await telegramService.sendMessage('🔔 <b>Test Notification</b> from DolfPower.\n\nTelegram setup was successful!');
        }
        
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ success: false, error: 'Failed to send message. Check bot token and chat ID. Also ensure you have sent /start to the bot.' });
        }
    }));

    // Global error handler
    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        console.error('Error:', err);
        res.status(500).json({
            success: false,
            error: err.message || 'Internal server error',
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        });
    });

    return app;
}

export async function startServer(app: Express, port: number = 3001): Promise<void> {
    return new Promise((resolve) => {
        app.listen(port, '127.0.0.1', () => {
            console.log(`\n✓ API Server running on http://127.0.0.1:${port}`);
            console.log(`✓ Health check: http://127.0.0.1:${port}/health`);
            console.log(`✓ Version: 0.3.0 - Complete Implementation`);
            console.log(`✓ Features: Full Profile Config, 40+ Fingerprint Parameters, Proper Flags\n`);
            resolve();
        });
    });
}
