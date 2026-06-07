import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import os from 'os';
import * as fs from 'fs';
import { Database } from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { FingerprintData } from '../database/schema';
import { ExtensionManager } from './extension-manager';
import { ProxyTunnelManager } from './proxy-tunnel-manager';
import { IPChecker } from './ip-checker';
import { ProfileIconService } from './profile-icon-service';
import { CookieManager } from './cookie-manager';

interface ProcessInfo {
    pid: number;
    devToolsPort: number;
    tunnelPort?: number;
    proxyOptions?: {
        proxy?: string;
        proxyAuth?: { username?: string; password?: string };
    };
    cdpClient?: any;
    startUrls?: string[];
}

export class ChromiumManager {
    private runningProcesses: Map<string, ProcessInfo & { cdpClient?: any }> = new Map();
    private portCounter = 9222;
    private extensionManager: ExtensionManager;
    private proxyTunnelManager: ProxyTunnelManager;
    private cachedVersion: string | null = null;

    constructor(private db: Database) {
        this.extensionManager = new ExtensionManager(db);
        this.proxyTunnelManager = new ProxyTunnelManager();
    }

    /**
     * Get Chromium version silently
     */
    async getChromiumVersion(): Promise<string> {
        if (this.cachedVersion) return this.cachedVersion;

        const chromiumPath = this.getChromiumPath();
        const platform = os.platform();

        if (platform === 'win32') {
            const version = await new Promise<string>((resolve) => {
                // Use PowerShell to get file version without executing the binary
                const psCommand = `[System.Diagnostics.FileVersionInfo]::GetVersionInfo("${chromiumPath}").ProductVersion`;
                const ps = spawn('powershell', ['-Command', psCommand], {
                    windowsHide: true,
                    stdio: ['ignore', 'pipe', 'ignore']
                });

                let output = '';
                ps.stdout.on('data', (data) => output += data.toString());
                ps.on('close', () => resolve(output.trim()));
                ps.on('error', () => resolve(''));

                // Safety timeout
                setTimeout(() => {
                    try { ps.kill(); } catch (e) { }
                    resolve('');
                }, 5000);
            });

            if (version && version.includes('.')) {
                this.cachedVersion = version;
                return version;
            }
        }

        // Fallback or non-Windows
        return new Promise((resolve) => {
            const process = spawn(chromiumPath, ['--version'], { windowsHide: true });
            let output = '';

            process.stdout.on('data', (data) => {
                output += data.toString();
            });

            process.on('close', () => {
                const cleanOutput = output.trim();
                const match = cleanOutput.match(/Chrome\/([\d.]+)/) ||
                    cleanOutput.match(/Chromium\/([\d.]+)/) ||
                    cleanOutput.match(/([\d.]{5,})/);

                const result = match ? match[1] : '132.0.6834.110';
                this.cachedVersion = result;
                resolve(result);
            });

            process.on('error', () => {
                resolve('132.0.6834.110');
            });
        });
    }

    /**
     * Launch a browser profile with proper stealth flags
     */
    async launchProfile(
        profileId: string,
        userDataDir: string,
        options: {
            headless?: boolean;
            proxy?: string;
            proxyAuth?: { username?: string; password?: string };
            windowWidth?: number;
            windowHeight?: number;
            restoreTabs?: boolean;
        } = {}
    ): Promise<ProcessInfo> {
        if (this.runningProcesses.has(profileId)) {
            throw new Error('Profile is already running');
        }

        const devToolsPort = this.portCounter++;
        const chromiumPath = this.getChromiumPath();
        let tunnelPort: number | undefined;

            // Proper stealth flags (NO warnings!)
            const args = [
                // User data
                `--user-data-dir=${userDataDir}`,
    
                // DevTools Protocol
                `--remote-debugging-port=${devToolsPort}`,
    
                // Window management
                `--window-size=${options.windowWidth || 1920},${options.windowHeight || 1080}`,
                '--start-maximized',
    
                // Stealth: Hide "Chrome is being controlled by automated test software"
                '--exclude-switches=enable-automation',
                '--disable-blink-features=AutomationControlled',
                '--use-fake-ui-for-media-stream',
                '--disable-notifications',
                '--no-default-browser-check',
                '--no-first-run',
                '--disable-blink-features=IdleDetection',
                '--disable-web-security',
                '--allow-running-insecure-content',
                '--no-sandbox',
                '--disable-setuid-sandbox',
    
                // Masking WebRTC leaks via flags
                '--force-webrtc-ip-handling-policy=default_public_interface_only',
                '--disable-blink-features=WebRtcHideLocalIpsWithMdns',
    
                // DNS Leak Protection
                '--disable-async-dns',
                '--disable-dns-over-https',
                '--disable-features=DnsOverHttps',
                '--disable-features=AsyncDns',

                '--test-type',
                `--app-user-model-id=DolfPower.Profile.${profileId}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-component-extensions-with-background-pages',
            '--disable-dev-shm-usage',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-renderer-backgrounding',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-service-autorun',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-background-timer-throttling',
            '--disable-hang-monitor',
            '--disable-prompt-on-repost',
            '--disable-sync',
            '--disable-session-crashed-bubble',
            '--disable-infobars',
            options.restoreTabs ? '--restore-last-session' : '--restore-last-session=0',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-features=PrivacySandboxSettings4',
            '--disable-features=OptimizationGuideModelDownloading,OptimizationHints,OptimizationTargetPrediction,OptimizationHintsFetching',
        ];

        // Ensure user data dir exists and Preferences is set to normal exit
        try {
            const profileDir = path.join(userDataDir, 'Default');
            const prefsPath = path.join(profileDir, 'Preferences');
            
            if (!fs.existsSync(profileDir)) {
                fs.mkdirSync(profileDir, { recursive: true });
            }

            // Generate unique icon for the profile
            const profileData = await new Promise<any>((resolve) => {
                this.db.get('SELECT name FROM profiles WHERE id = ?', [profileId], (err, row) => resolve(row));
            });

            if (profileData) {
                const iconPath = path.join(profileDir, 'Google Profile Picture.png'); 
                const hue = ProfileIconService.getHueFromId(profileId);
                await ProfileIconService.generateIcon(profileData.name, hue, iconPath, chromiumPath);
            }
            
            let prefs: any = {};
            if (fs.existsSync(prefsPath)) {
                try {
                    prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
                } catch (e) {}
            }
            
            if (!prefs.profile) prefs.profile = {};
            prefs.profile.exit_type = 'Normal';
            prefs.profile.exited_cleanly = true;
            prefs.profile.exit_state = 'none';
            prefs.profile.name = profileData?.name || 'DolfProfile';
            
            if (!prefs.browser) prefs.browser = {};
            prefs.browser.show_update_promotion_info_bar = false;
            prefs.browser.check_default_browser = false;
            prefs.browser.has_seen_welcome_page = true;
            
            // Handle session restoration via Preferences if flag is not enough
            if (options.restoreTabs) {
                if (!prefs.session) prefs.session = {};
                prefs.session.restore_on_startup = 1; // 1 = Restore last session
            } else {
                if (!prefs.session) prefs.session = {};
                prefs.session.restore_on_startup = 5; // 5 = Open a specific set of pages (but we don't set any)
            }
            
            fs.writeFileSync(prefsPath, JSON.stringify(prefs));

            // Sync Bookmarks
            const bookmarks: any[] = await new Promise((resolve) => {
                this.db.all(
                    `SELECT b.* FROM bookmarks b 
                     JOIN profile_bookmarks pb ON b.id = pb.bookmark_id 
                     WHERE pb.profile_id = ?`,
                    [profileId],
                    (err, rows) => resolve(rows || [])
                );
            });

            if (bookmarks.length > 0) {
                const bookmarksPath = path.join(profileDir, 'Bookmarks');
                const bookmarkData = {
                    checksum: "",
                    roots: {
                        bookmark_bar: {
                            children: bookmarks.map(bm => ({
                                date_added: "13316000000000000",
                                guid: uuidv4(),
                                id: Math.floor(Math.random() * 1000000).toString(),
                                name: bm.name,
                                type: "url",
                                url: bm.url
                            })),
                            date_added: "13316000000000000",
                            date_modified: "13316000000000000",
                            guid: uuidv4(),
                            id: "1",
                            name: "Bookmarks bar",
                            type: "folder"
                        },
                        other: {
                            children: [],
                            date_added: "13316000000000000",
                            date_modified: "13316000000000000",
                            guid: uuidv4(),
                            id: "2",
                            name: "Other bookmarks",
                            type: "folder"
                        },
                        synced: {
                            children: [],
                            date_added: "13316000000000000",
                            date_modified: "13316000000000000",
                            guid: uuidv4(),
                            id: "3",
                            name: "Mobile bookmarks",
                            type: "folder"
                        }
                    },
                    version: 1
                };
                fs.writeFileSync(bookmarksPath, JSON.stringify(bookmarkData));
            }
        } catch (e) {
            console.error('Failed to patch Preferences or Bookmarks:', e);
        }

        // Headless mode
        if (options.headless) {
            args.push('--headless=new');
        }

        // Handle Proxy via External Tunnel
        if (options.proxy) {
            try {
                const proxyUrl = new URL(options.proxy.includes('://') ? options.proxy : `http://${options.proxy}`);

                // Create local tunnel that handles auth automatically
                tunnelPort = await this.proxyTunnelManager.createHttpTunnel(profileId, {
                    protocol: proxyUrl.protocol.replace(':', ''),
                    host: proxyUrl.hostname,
                    port: parseInt(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80),
                    username: options.proxyAuth?.username,
                    password: options.proxyAuth?.password
                }, true); // Start BLOCKED until IP is verified

                // Point Chromium to our LOCAL tunnel instead of real proxy
                args.push(`--proxy-server=http://127.0.0.1:${tunnelPort}`);
                args.push('--proxy-bypass-list=127.0.0.1;localhost;<-loopback>');
                console.log(`✓ Routing profile ${profileId} through local tunnel on port ${tunnelPort}`);
            } catch (e) {
                console.error('Failed to setup proxy tunnel:', e);
                // Fallback to direct connection if tunnel fails
            }
        }

        // Load extensions for this profile + default extensions
        const profileExtensions = await this.extensionManager.getProfileExtensions(profileId);
        const defaultExtensions = await this.extensionManager.getDefaultExtensions();

        // Merge and unique by path
        const allExtensionsMap = new Map();
        [...defaultExtensions, ...profileExtensions].forEach(ext => {
            allExtensionsMap.set(ext.path, ext);
        });

        const extensions = Array.from(allExtensionsMap.values());
        if (extensions.length > 0) {
            const extensionArgs = this.extensionManager.getExtensionArgs(extensions);
            args.push(...extensionArgs);
        }

        // Platform-specific flags
        if (os.platform() === 'linux') {
            args.push('--disable-gpu');
            args.push('--no-sandbox');
        }

        if (os.platform() === 'win32') {
            args.push('--disable-gpu');
        }

        if (os.platform() === 'darwin') {
            args.push('--use-mock-keychain');
        }

        // Add IP check page as startup URL
        // If we have a proxy or fingerprint to apply, we start with about:blank
        // and navigate later via CDP to prevent race conditions (leaks)
        
        // Screen resolution limit - cap to reasonable maximum (fullscreen)
        // Max supported resolution to prevent oversized windows
        const MAX_WIDTH = 3840; // 4K
        const MAX_HEIGHT = 2160;
        const screenWidth = Math.min(options.windowWidth || 1920, MAX_WIDTH);
        const screenHeight = Math.min(options.windowHeight || 1080, MAX_HEIGHT);
        
        // Reconstruct window-size args with capped values
        const windowSizeIdx = args.findIndex(a => a.startsWith('--window-size='));
        if (windowSizeIdx !== -1) {
            args[windowSizeIdx] = `--window-size=${screenWidth},${screenHeight}`;
        }

        if (!options.restoreTabs) {
            args.push('about:blank');
        }

        // Additional Windows-specific options for taskbar icon customization
        const profileDir = path.join(userDataDir, 'Default');
        const iconPath = path.join(profileDir, 'Google Profile Picture.png');
        
        if (os.platform() === 'win32') {
            // Ensure icon exists for colored taskbar icon
            let profileDataLocal: { name: string } | null = null;
            try {
                profileDataLocal = await new Promise<any>((resolve) => {
                    this.db.get('SELECT name FROM profiles WHERE id = ?', [profileId], (err, row) => resolve(row));
                });
            } catch (e) {}
            
            if (!fs.existsSync(iconPath) && profileDataLocal) {
                const hue = ProfileIconService.getHueFromId(profileId);
                try {
                    await ProfileIconService.generateIcon(profileDataLocal.name, hue, iconPath, chromiumPath);
                    // Create a shortcut with the custom icon for taskbar distinction
                    const { exec } = require('child_process');
                    const shortcutPath = path.join(profileDir, `${profileId}.lnk`);
                    const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/\\/g, '\\\\')}')
$Shortcut.TargetPath = '${chromiumPath.replace(/\\/g, '\\\\')}'
$Shortcut.Arguments = '--profile-directory="Default" --user-data-dir="${userDataDir.replace(/\\/g, '\\\\')}"'
$Shortcut.IconLocation = '${iconPath.replace(/\\/g, '\\\\')},0'
$Shortcut.Save()
`;
                    exec(`powershell -Command "${psScript}"`, { windowsHide: true });
                } catch (e) {
                    console.warn('Failed to generate profile icon:', e);
                }
            }
        }

        // Launch Chromium
        const browserProcess = spawn(chromiumPath, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: false, // Changed to false to ensure window is visible
            env: {
                ...process.env,
                // Windows app user model for custom taskbar icon
                ...(os.platform() === 'win32' ? {
                    APPIMAGE: iconPath  // Some systems use this for icon
                } : {})
            }
        });

        // Ensure the process is unref'd if we want it to stay alive
        if (browserProcess.unref) browserProcess.unref();

        const processInfo: ProcessInfo = {
            pid: browserProcess.pid!,
            devToolsPort,
            tunnelPort,
            proxyOptions: options,
            startUrls: [] // Will be set in applyFingerprintViaCDP or launch
        };

        this.runningProcesses.set(profileId, processInfo);

        // Handle process exit
        browserProcess.on('exit', () => {
            const info = this.runningProcesses.get(profileId);
            if (info?.cdpClient) {
                try { info.cdpClient.close(); } catch (e) { }
            }
            // Close local tunnel
            this.proxyTunnelManager.closeTunnel(profileId);
            this.runningProcesses.delete(profileId);
        });

        console.log(`✓ Launched profile ${profileId} on port ${devToolsPort}`);

        return processInfo;
    }

    /**
     * Terminate a running profile
     */
    async terminateProfile(profileId: string): Promise<void> {
        const processInfo = this.runningProcesses.get(profileId);
        if (!processInfo) {
            // Even if not in map, try to close tunnel
            await this.proxyTunnelManager.closeTunnel(profileId);
            return;
        }

        try {
            if (processInfo.cdpClient) {
                try {
                    // Attempt graceful close via CDP
                    const { Browser } = processInfo.cdpClient;
                    await Browser.close().catch(() => {});
                    processInfo.cdpClient.close();
                } catch (cdpErr) {}
            }
            
            // Force kill after short delay to ensure EPERM doesn't happen due to lingering process
            try {
                process.kill(processInfo.pid, 'SIGKILL');
            } catch (e) {}

            await this.proxyTunnelManager.closeTunnel(profileId);
            this.runningProcesses.delete(profileId);
            
            // Wait a moment for OS to release file handles
            await new Promise(r => setTimeout(r, 1000));
            
            console.log(`✓ Terminated profile ${profileId}`);
        } catch (error) {
            console.error(`Failed to terminate profile ${profileId}:`, error);
        }
    }

    /**
     * Get DevTools port for a running profile
     */
    getDevToolsPort(profileId: string): number | null {
        const processInfo = this.runningProcesses.get(profileId);
        return processInfo ? processInfo.devToolsPort : null;
    }

    /**
     * Get DevTools WebSocket endpoint
     */
    async getDevToolsEndpoint(port: number): Promise<string> {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`);
            const data = await response.json() as { webSocketDebuggerUrl: string };
            return data.webSocketDebuggerUrl;
        } catch (error) {
            console.error('Failed to get WebSocket endpoint:', error);
            // Fallback to old method
            return `ws://127.0.0.1:${port}/devtools/browser`;
        }
    }

    /**
     * Check if profile is running
     */
    isProfileRunning(profileId: string): boolean {
        return this.runningProcesses.has(profileId);
    }

    /**
     * Get all running profiles
     */
    getRunningProfiles(): Array<{ profileId: string; port: number; pid: number }> {
        const profiles: Array<{ profileId: string; port: number; pid: number }> = [];

        this.runningProcesses.forEach((info, profileId) => {
            profiles.push({
                profileId,
                port: info.devToolsPort,
                pid: info.pid,
            });
        });

        return profiles;
    }

    /**
     * Terminate all running profiles
     */
    async terminateAll(): Promise<void> {
        const profileIds = Array.from(this.runningProcesses.keys());

        for (const profileId of profileIds) {
            try {
                await this.terminateProfile(profileId);
            } catch (error) {
                console.error(`Failed to terminate profile ${profileId}:`, error);
            }
        }

        console.log('✓ All profiles terminated');
    }

    /**
     * Unlock proxy tunnel for profile and open start URLs
     */
    async unlockProfile(profileId: string): Promise<void> {
        this.proxyTunnelManager.unlockTunnel(profileId);
        
        // Open deferred start URLs
        const info = this.runningProcesses.get(profileId);
        if (info && info.startUrls && info.startUrls.length > 0) {
            console.log(`🌐 Proxy verified for ${profileId}, opening ${info.startUrls.length} start URLs`);
            await this.openStartUrls(profileId, info.startUrls);
            info.startUrls = []; // Clear so they don't open again
        }
    }

    /**
     * Open start URLs via CDP - navigates the main tab instead of creating new ones
     */
    private async openStartUrls(profileId: string, urls: string[]): Promise<void> {
        const info = this.runningProcesses.get(profileId);
        if (!info) return;

        try {
            const CDP = require('chrome-remote-interface');
            const client = await CDP({ port: info.devToolsPort });
            const { Page, Target } = client;

            // Get the main target (the IP check tab we're already on)
            const targets = await Target.getTargets();
            const mainTarget = targets.targetInfos.find((t: any) => 
                t.url.includes('ip-check.html') || t.type === 'page'
            );

            if (mainTarget && urls.length > 0 && urls[0].trim()) {
                // Navigate the main tab to the first start URL
                const mainClient = await CDP({ port: info.devToolsPort, targetId: mainTarget.targetId });
                const { Page: MainPage } = mainClient;
                await MainPage.enable();
                await MainPage.navigate({ url: urls[0].trim() });
                console.log(`🌐 Navigating main tab to start URL: ${urls[0].trim()}`);
                await mainClient.close();
            }

            // For additional URLs, create new tabs
            for (let i = 1; i < urls.length; i++) {
                const url = urls[i];
                if (url && url.trim()) {
                    await Target.createTarget({ url: url.trim() });
                    console.log(`🌐 Opening additional start URL: ${url.trim()}`);
                }
            }

            await client.close();
        } catch (error) {
            console.error(`Failed to open start URLs for profile ${profileId}:`, error);
        }
    }

    /**
     * Get Chromium binary path (cross-platform)
     */
    private getChromiumPath(): string {
        const platform = os.platform();

        // Check environment variable first
        if (process.env.CHROMIUM_PATH) {
            return process.env.CHROMIUM_PATH;
        }

        // Platform-specific default paths
        if (platform === 'win32') {
            // Windows
            const possiblePaths = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
            ];

            for (const chromePath of possiblePaths) {
                try {
                    if (fs.existsSync(chromePath)) {
                        return chromePath;
                    }
                } catch (e) {
                    // Continue to next path
                }
            }
        } else if (platform === 'darwin') {
            // macOS
            return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        } else {
            // Linux
            const possiblePaths = [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
            ];

            for (const chromePath of possiblePaths) {
                try {
                    if (fs.existsSync(chromePath)) {
                        return chromePath;
                    }
                } catch (e) {
                    // Continue to next path
                }
            }
        }

        throw new Error(
            'Chromium not found. Please install Google Chrome or set CHROMIUM_PATH environment variable.'
        );
    }

    /**
     * Apply fingerprint via Chrome DevTools Protocol
     */
    public async applyFingerprintViaCDP(profileId: string, port: number, fingerprint: any, startUrls?: string[], options: { restoreTabs?: boolean } = {}): Promise<void> {
        try {
            const CDP = require('chrome-remote-interface');

            // Map DB flat structure to expected nested structure if necessary
            const fp: any = {
                navigator: fingerprint.navigator || {
                    userAgent: fingerprint.user_agent,
                    platform: fingerprint.platform,
                    platformVersion: fingerprint.platform_version,
                    hardwareConcurrency: fingerprint.hardware_concurrency,
                    deviceMemory: fingerprint.device_memory,
                    maxTouchPoints: fingerprint.max_touch_points,
                    doNotTrack: fingerprint.do_not_track
                },
                screen: fingerprint.screen || {
                    width: fingerprint.screen_width,
                    height: fingerprint.screen_height,
                    pixelRatio: fingerprint.pixel_ratio
                },
                languages: fingerprint.languages_data || {
                    language: fingerprint.language,
                    acceptLanguage: fingerprint.accept_language
                },
                timezone: fingerprint.timezone_data || {
                    id: fingerprint.timezone_id
                },
                geolocation: fingerprint.geolocation_latitude ? {
                    latitude: fingerprint.geolocation_latitude,
                    longitude: fingerprint.geolocation_longitude,
                    accuracy: fingerprint.geolocation_accuracy
                } : undefined,
                webgl: fingerprint.webgl || {
                    vendor: fingerprint.webgl_vendor,
                    renderer: fingerprint.webgl_renderer
                }
            };

            // Wait for CDP to be available (retry loop)
            let client;
            for (let i = 0; i < 20; i++) {
                try {
                    client = await CDP({ port });
                    break;
                } catch (e) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }

            if (!client) {
                throw new Error(`Failed to connect to CDP on port ${port} after 10s`);
            }

            const { Page, Network, Emulation, Browser, Target, Runtime } = client;

            await Page.enable();
            await Network.enable();
            await Runtime.enable();
            await Target.setDiscoverTargets({ discover: true });

            const info = this.runningProcesses.get(profileId);

            // IMMEDIATELY navigate to the IP check page to avoid blank screen
            const ipCheckUrl = 'file:///' + path.join(__dirname, '..', 'ui', 'ip-check.html').replace(/\\/g, '/');
            const ipCheckUrlWithId = `${ipCheckUrl}?profileId=${profileId}`;
            
            // Store start URLs for later (after proxy verification), normalize URLs
            if (info && startUrls && startUrls.length > 0) {
                info.startUrls = startUrls.map(u => {
                    const trimmed = (u || '').trim();
                    if (!trimmed) return '';
                    // Add protocol if missing
                    return trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`;
                }).filter(u => u);
            }

            console.log(`🌐 Navigating primary tab to IP check: ${ipCheckUrlWithId}`);
            await Page.navigate({ url: ipCheckUrlWithId });

            // Set up proxy authentication to avoid browser popups
            if (info && info.proxyOptions && info.proxyOptions.proxyAuth) {
                const { username, password } = info.proxyOptions.proxyAuth;
                if (username) {
                    console.log(`[CDP] Setting up proxy authentication (Fetch) for profile ${profileId}`);
                    const { Fetch } = client;
                    await Fetch.enable({ handleAuthRequests: true });
                    
                    Fetch.authRequired(async (params: any) => {
                        console.log(`[CDP] Responding to auth challenge for ${params.authChallenge?.source} auth`);
                        await Fetch.continueWithAuth({
                            requestId: params.requestId,
                            authChallengeResponse: {
                                response: 'ProvideCredentials',
                                username: username,
                                password: password || ''
                            }
                        });
                    });
                }
            }

            // ... (rest of the setup continues while page is loading)
            
            // Also set basic auth for the browser process level if possible
            if (info && info.proxyOptions && info.proxyOptions.proxyAuth) {
                const { username, password } = info.proxyOptions.proxyAuth;
                if (username) {
                    try {
                        // This is for some older versions or specific implementations
                        await Network.authenticate({
                            requestId: 'proxy',
                            authChallengeResponse: {
                                response: 'ProvideCredentials',
                                username,
                                password: password || ''
                            }
                        }).catch(() => {});
                    } catch(e) {}
                }
            }

            // Grant Geolocation permissions automatically to avoid prompts and leaks
            try {
                await Browser.setPermission({
                    permission: { name: 'geolocation' },
                    setting: 'granted',
                    origin: 'https://pixelscan.net' // Grant for common check sites
                });
                await Browser.setPermission({
                    permission: { name: 'geolocation' },
                    setting: 'granted',
                    origin: 'https://whoer.net'
                });
                // Also grant for file:// if we are testing locally
                await Browser.setPermission({
                    permission: { name: 'geolocation' },
                    setting: 'granted',
                    origin: 'file://'
                });
            } catch (permErr) {
                console.warn('Failed to set Browser permissions:', permErr);
            }

            // Set User Agent & Client Hints
            const nav = fp.navigator || {};
            const platformName = (nav.platform || '').includes('Win') ? 'Windows' :
                (nav.platform || '').includes('Mac') ? 'macOS' : 'Linux';

            const actualVersion = await this.getChromiumVersion();
            const chromeFullVersion = actualVersion;
            const chromeMajorVersion = chromeFullVersion.split('.')[0];
            const brandVersion = '99';

            const defaultUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFullVersion} Safari/537.36`;
            const baseUA = nav.userAgent || defaultUA;

            // Apply Network.setUserAgentOverride first
            await Network.setUserAgentOverride({
                userAgent: baseUA.replace(/Chrome\/[\d.]+/, `Chrome/${chromeFullVersion}`),
                acceptLanguage: fp.languages?.acceptLanguage || 'en-US,en;q=0.9',
                platform: nav.platform || 'Win32',
                userAgentMetadata: {
                    brands: [
                        { brand: 'Not A(Brand', version: brandVersion },
                        { brand: 'Chromium', version: chromeMajorVersion },
                        { brand: 'Google Chrome', version: chromeMajorVersion }
                    ],
                    fullVersionList: [
                        { brand: 'Not A(Brand', version: `${brandVersion}.0.0.0` },
                        { brand: 'Chromium', version: chromeFullVersion },
                        { brand: 'Google Chrome', version: chromeFullVersion }
                    ],
                    platform: platformName,
                    platformVersion: nav.platformVersion || (platformName === 'Windows' ? '10.0.0' : '14.0.0'),
                    architecture: platformName === 'macOS' ? (nav.userAgent || '').includes('Arm') ? 'arm' : 'x86' : 'x86',
                    model: '',
                    mobile: false,
                    bitness: '64',
                    wow64: platformName === 'Windows' ? false : undefined
                },
            });

            // Set Extra HTTP Headers
            await Network.setExtraHTTPHeaders({
                headers: { 
                    'Accept-Language': fp.languages?.acceptLanguage || 'en-US,en;q=0.9',
                    'sec-ch-ua-platform': `"${platformName}"`,
                    'sec-ch-ua': `"Google Chrome";v="${chromeMajorVersion}", "Chromium";v="${chromeMajorVersion}", "Not=A?Brand";v="${brandVersion}"`
                }
            });

            // Set Timezone, Geolocation and Language from Proxy
            let timezoneId = fp.timezone?.id || 'auto';
            let geolocation = fp.geolocation;
            let language = fp.languages?.language || 'en-US';
            let acceptLanguage = fp.languages?.acceptLanguage || 'en-US,en;q=0.9';

            let resolvedIp: string | undefined;

            if (timezoneId === 'auto' || !geolocation || language === 'auto_ip' || fingerprint.webrtc_mode === 'altered') {
                const info = this.runningProcesses.get(profileId);
                if (info && info.proxyOptions && info.proxyOptions.proxy) {
                    try {
                        const ipChecker = new IPChecker();
                        const proxyUrlString = info.proxyOptions.proxy.includes('://') ? info.proxyOptions.proxy : `http://${info.proxyOptions.proxy}`;
                        const proxyUrl = new URL(proxyUrlString);
                        const checkResult = await ipChecker.checkProxyIP({
                            protocol: proxyUrl.protocol.replace(':', '') as any,
                            host: proxyUrl.hostname,
                            port: parseInt(proxyUrl.port) || 80,
                            username: info.proxyOptions.proxyAuth?.username,
                            password: info.proxyOptions.proxyAuth?.password
                        });

                        if (checkResult.success && checkResult.info) {
                            const ipInfo = checkResult.info;
                            resolvedIp = ipInfo.ip;
                            
                            if (timezoneId === 'auto') {
                                timezoneId = ipInfo.timezone || 'UTC';
                                // Calculate offset in minutes correctly for Date.getTimezoneOffset()
                                // getTimezoneOffset() returns (UTC - Local) in minutes.
                                try {
                                    const now = new Date();
                                    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
                                    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezoneId }));
                                    const offsetMinutes = Math.round((utcDate.getTime() - tzDate.getTime()) / 60000);
                                    fp.timezone.offset = offsetMinutes;
                                } catch (e) {
                                    fp.timezone.offset = 0;
                                }
                                console.log(`✓ Resolved timezone for profile ${profileId} via proxy: ${timezoneId} (Offset: ${fp.timezone.offset})`);
                            }

                            if (!geolocation) {
                                geolocation = {
                                    latitude: ipInfo.lat,
                                    longitude: ipInfo.lon,
                                    accuracy: 10 + Math.floor(Math.random() * 50)
                                };
                                console.log(`✓ Resolved geolocation for profile ${profileId} via proxy: ${ipInfo.lat}, ${ipInfo.lon}`);
                            }

                            if (language === 'auto_ip') {
                                language = ipChecker.getLanguageForCountry(ipInfo.countryCode);
                                acceptLanguage = `${language},en;q=0.9`;
                                console.log(`✓ Resolved language for profile ${profileId} via proxy: ${language}`);
                            }
                        }
                    } catch (e) {
                        console.error('Failed to resolve IP info via proxy:', e);
                    }
                }
            }

            // Fallbacks
            if (timezoneId === 'auto') timezoneId = 'UTC';
            if (language === 'auto_ip') language = 'en-US';

            // Update fingerprint object with resolved data for stealth script
            if (!fp.timezone) fp.timezone = {};
            fp.timezone.id = timezoneId;
            fp.geolocation = geolocation;
            if (!fp.languages) fp.languages = {};
            fp.languages.language = language;
            fp.languages.acceptLanguage = acceptLanguage;
            
            if (!fp.webrtc) fp.webrtc = {};
            fp.webrtc.mode = fingerprint.webrtc_mode;
            fp.webrtc.publicIp = fingerprint.webrtc_public_ip || resolvedIp;

            // Only call setLocaleOverride if we actually have a language and it's not default
            // And handle the case where it might already be set
            if (language && language !== 'en-US' && language !== 'auto_ip') {
                try {
                    await Emulation.setLocaleOverride({ locale: language }).catch((err: any) => {
                        if (!err.message?.includes('Already in effect')) {
                            console.warn('Locale override error:', err.message);
                        }
                    });
                } catch (e: any) {
                    console.warn('Failed to set locale override:', e.message);
                }
            }

            try {
                await Emulation.setTimezoneOverride({ timezoneId });
            } catch (e: any) {
                console.warn('Failed to set timezone override:', e.message);
            }

            if (geolocation) {
                // Ensure accuracy is realistic (not just 100)
                const realisticAccuracy = geolocation.accuracy || (10 + Math.random() * 50);
                try {
                    await Emulation.setGeolocationOverride({
                        latitude: geolocation.latitude,
                        longitude: geolocation.longitude,
                        accuracy: realisticAccuracy,
                    });
                    // Update fp object so injection script matches
                    fp.geolocation = {
                        latitude: geolocation.latitude,
                        longitude: geolocation.longitude,
                        accuracy: realisticAccuracy
                    };
                } catch (e: any) {
                    console.warn('Failed to set geolocation override:', e.message);
                }
            }

            // WebRTC IP Spoofing
            if (fingerprint.webrtc_mode === 'altered') {
                const publicIp = fingerprint.webrtc_public_ip || (this.runningProcesses.get(profileId) as any)?.lastResolvedIp;
                if (publicIp) {
                    try {
                        // Use CDP to set WebRTC IP handling policy if supported
                        // @ts-ignore
                        await Browser.setWebRTCIPHandlingPolicy({ policy: 'default_public_interface_only' }).catch(() => {});
                    } catch (e) {}
                }
            }
            
            await Network.setExtraHTTPHeaders({
                headers: { 'Accept-Language': acceptLanguage }
            });

            // Inject stealth scripts
            const { FingerprintGenerator } = require('./fingerprint-generator');
            const generator = new FingerprintGenerator('');
            const stealthScript = generator.generateInjectionScript(fp as any);

            // Apply Cookies from Database (Primary for migrated profiles)
            try {
                const cookieManager = new CookieManager(this.db);
                const cookies = await cookieManager.getCookies(profileId);
                if (cookies.length > 0) {
                    console.log(`[CDP] Applying ${cookies.length} cookies for profile ${profileId}`);
                    await cookieManager.setCookiesViaCDP(client, cookies);
                }
            } catch (cookieErr) {
                console.warn('Failed to apply cookies via CDP:', cookieErr);
            }

            // Set Hardware Concurrency if available
            if (nav.hardwareConcurrency) {
                try {
                    // @ts-ignore - Experimental CDP command
                    await Emulation.setHardwareConcurrencyOverride({
                        hardwareConcurrency: nav.hardwareConcurrency
                    });
                } catch (e) {
                    // Ignore
                }
            }

            // Set Device Metrics (Screen resolution & Pixel Ratio)
            await Emulation.setDeviceMetricsOverride({
                width: fp.screen.width,
                height: fp.screen.height,
                deviceScaleFactor: fp.screen.pixelRatio || 1,
                mobile: false,
                screenOrientation: { type: 'landscapePrimary', angle: 0 }
            });

            // Ensure the IP check tab is focused
            const targets = await Target.getTargets();
            const ipCheckTarget = targets.targetInfos.find((t: any) => t.url.includes('ip-check.html'));
            if (ipCheckTarget) {
                await Target.activateTarget({ targetId: ipCheckTarget.targetId });
            }

            // DO NOT close client here, it will be closed in terminateProfile or on exit
        } catch (error) {
            console.error('Failed to apply fingerprint via CDP:', error);
        }
    }
}
