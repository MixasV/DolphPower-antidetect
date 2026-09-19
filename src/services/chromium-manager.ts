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
import { ContextFingerprintManager } from './context-fingerprint-manager';

interface ProcessInfo {
    pid: number;
    devToolsPort: number;
    tunnelPort?: number;
    userDataDir: string;
    proxyOptions?: {
        proxy?: string;
        proxyAuth?: { username?: string; password?: string };
    };
    cdpClient?: any;
    startUrls?: string[];
    contextId?: string;
    resolvedTimezone?: string; // Cached timezone from proxy check in launchProfile
}

export class ChromiumManager {
    private runningProcesses: Map<string, ProcessInfo & { cdpClient?: any }> = new Map();
    private extensionManager: ExtensionManager;
    private proxyTunnelManager: ProxyTunnelManager;
    private ipChecker: IPChecker;
    private db: Database;
    private contextFingerprintManager: ContextFingerprintManager;
    private proxyIpCache: Map<string, any>;
    private cachedVersion: string | null = null;

    constructor(db: Database) {
        this.db = db;
        this.extensionManager = new ExtensionManager(db);
        this.proxyTunnelManager = new ProxyTunnelManager();
        this.ipChecker = new IPChecker();
        this.contextFingerprintManager = new ContextFingerprintManager();
        this.proxyIpCache = new Map();
    }

    /**
     * Map a flat fingerprint object (as stored in the database) to the nested format used by the stealth script.
     * @param flat Fingerprint object in flat format
     * @returns Fingerprint object in nested format
     */
    private mapFingerprintToNested(flat: any): any {
        return {
            navigator: flat.navigator || {
                userAgent: flat.user_agent,
                platform: flat.platform,
                platformVersion: flat.platform_version,
                hardwareConcurrency: flat.hardware_concurrency,
                deviceMemory: flat.device_memory,
                maxTouchPoints: flat.max_touch_points,
                doNotTrack: flat.do_not_track
            },
            screen: flat.screen || {
                width: flat.screen_width,
                height: flat.screen_height,
                pixelRatio: flat.pixel_ratio
            },
            languages: flat.languages_data || {
                language: flat.language,
                acceptLanguage: flat.accept_language
            },
timezone: flat.timezone_data || {
                  id: flat.timezone_id || 'UTC',
                  offset: flat.timezone_offset ?? 0
              },
            geolocation: flat.geolocation_latitude ? {
                latitude: flat.geolocation_latitude,
                longitude: flat.geolocation_longitude,
                accuracy: flat.geolocation_accuracy
            } : undefined,
            webgl: flat.webgl || {
                vendor: flat.webgl_vendor,
                renderer: flat.webgl_renderer
            }
        };
    }

    public getOffsetMinutesForTimezone(timezone: string): number {
        try {
            const now = new Date();
            const options: Intl.DateTimeFormatOptions = { timeZone: timezone, timeZoneName: 'shortOffset', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' };
            const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);
            const offsetPart = parts.find(p => p.type === 'timeZoneName');
            if (offsetPart && typeof offsetPart.value === 'string') {
                const value = offsetPart.value;
                const match = value.match(/([+-])(\d+)(?::(\d+))?/);
                if (match) {
                    const sign = match[1] === '-' ? 1 : -1;
                    const hours = parseInt(match[2], 10);
                    const minutes = match[3] ? parseInt(match[3], 10) : 0;
                    const result = sign * (hours * 60 + minutes);
                    return result;
                }
            }
        } catch (e) {
            // fallback to 0
            console.error(`[getOffsetMinutesForTimezone] exception:`, e);
        }
        return 0;
    }

    /**
     * Set the base fingerprint for a profile
     * @param profileId The profile identifier
     * @param baseFingerprint The base fingerprint data
     */
    setBaseFingerprint(profileId: string, baseFingerprint: FingerprintData): void {
        this.contextFingerprintManager.setBaseFingerprint(profileId, baseFingerprint);
    }

    /**
     * Get a context-specific fingerprint for a profile and context
     * @param profileId The profile identifier
     * @param contextId The context identifier
     * @returns The context-specific fingerprint or undefined if not set
     */
    getContextFingerprint(profileId: string, contextId: string): FingerprintData | undefined {
        return this.contextFingerprintManager.getContextFingerprint(profileId, contextId);
    }

    private async findAvailablePort(): Promise<number> {
        const net = require('net');
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.listen(0, '127.0.0.1', () => {
                const port = (server.address() as any).port;
                server.close(() => resolve(port));
            });
            server.on('error', reject);
        });
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

        const devToolsPort = await this.findAvailablePort();
        const chromiumPath = this.getChromiumPath();
        let tunnelPort: number | undefined;
        let contextId: string | undefined;
        let resolvedTimezoneForProcessInfo: string | undefined;

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
'--disable-features=AutomationControlled',
                  '--disable-notifications',
                 '--disable-features=IdleDetection',
                 '--allow-running-insecure-content',
    
// Masking WebRTC leaks via flags
                 '--force-webrtc-ip-handling-policy=default_public_interface_only',
                 '--disable-features=WebRtcHideLocalIpsWithMdns',
    
                // DNS Leak Protection
                '--disable-async-dns',
                '--disable-dns-over-https',

                `--app-user-model-id=DolfPower.Profile.${profileId}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-backgrounding-occluded-windows',
                '--disable-breakpad',
                '--disable-dev-shm-usage',
                '--disable-ipc-flooding-protection',
                '--disable-renderer-backgrounding',
                '--metrics-recording-only',
                '--mute-audio',
                '--password-store=basic',
                '--use-mock-keychain',
                '--disable-background-timer-throttling',
                '--disable-hang-monitor',
                '--disable-prompt-on-repost',
                '--disable-sync',
                '--disable-session-crashed-bubble',
                '--disable-infobars',
                options.restoreTabs ? '--restore-last-session' : '--restore-last-session=0',
                '--disable-features=TranslateUI,PrivacySandboxSettings4,AsyncDns,DnsOverHttps,OptimizationGuideModelDownloading,OptimizationHints,OptimizationTargetPrediction,OptimizationHintsFetching',
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

            // Show bookmarks bar
            if (!prefs.bookmark_bar) prefs.bookmark_bar = {};
            prefs.bookmark_bar.show_on_all_tabs = true;
            
            // Handle session restoration via Preferences if flag is not enough
            if (options.restoreTabs) {
                if (!prefs.session) prefs.session = {};
                prefs.session.restore_on_startup = 1; // 1 = Restore last session
            } else {
                if (!prefs.session) prefs.session = {};
                prefs.session.restore_on_startup = 5; // 5 = Open a specific set of pages (but we don't set any)
            }
            
fs.writeFileSync(prefsPath, JSON.stringify(prefs));

// Fetch and set base fingerprint for context-isolated storage
              const fingerprintRow = await new Promise<any>((resolve) => {
                  this.db.get('SELECT * FROM fingerprints WHERE profile_id = ?', [profileId], (err, row) => resolve(row));
              });
              let baseFingerprint: any = {};
              if (fingerprintRow) {
                  baseFingerprint = this.mapFingerprintToNested(fingerprintRow);
              } else {
                  // If no fingerprint in database, generate a default one
                  const { FingerprintGenerator } = require('./fingerprint-generator');
                  const generator = new FingerprintGenerator('');
                  baseFingerprint = generator.generateFingerprint('windows_chrome');
              }
// If a proxy is provided, adjust timezone to match proxy geo
               if (options.proxy) {
                   try {
                       const proxyUrl = new URL(options.proxy.includes('://') ? options.proxy : `http://${options.proxy}`);
                       const proxyCheck = await this.ipChecker.checkProxyIP({
                           protocol: proxyUrl.protocol.replace(':', '') as any,
                           host: proxyUrl.hostname,
                           port: parseInt(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80),
                           username: options.proxyAuth?.username,
                           password: options.proxyAuth?.password
});
                        if (proxyCheck.success && proxyCheck.info && proxyCheck.info.timezone) {
                            const tz = proxyCheck.info.timezone;
                            const offsetMinutes = this.getOffsetMinutesForTimezone(tz);
                            // Clone baseFingerprint to avoid mutating original
                            baseFingerprint = JSON.parse(JSON.stringify(baseFingerprint));
                            baseFingerprint.timezone = { id: tz, offset: offsetMinutes };
                            resolvedTimezoneForProcessInfo = tz;
                        } else {
                        }
                    } catch (e) {
                        console.warn('Failed to adjust timezone for proxy:', e);
                    }
                }
                this.setBaseFingerprint(profileId, baseFingerprint);
             
// Generate a context ID for this launch
              const { randomUUID } = require('crypto');
              contextId = randomUUID();
             
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
                let bookmarkIdCounter = 1000;
                const bookmarkData = {
                    roots: {
                        bookmark_bar: {
                            children: bookmarks.map(bm => ({
                                date_added: "13316000000000000",
                                guid: uuidv4(),
                                id: (bookmarkIdCounter++).toString(),
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
                }, false); // Start UNBLOCKED — extensions need network during init, proxy is already pre-tested via curl

                // Point Chromium to our LOCAL tunnel instead of real proxy
                args.push(`--proxy-server=http://127.0.0.1:${tunnelPort}`);
                args.push('--proxy-bypass-list=127.0.0.1;localhost;<-loopback;duckduckgo.com');
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
        const validExtensions = extensions.filter(ext => {
            if (!ext.path) { console.warn(`[ChromiumManager] Extension ${ext.id} (${ext.name}) has no path`); return false; }
            if (!fs.existsSync(ext.path)) { console.warn(`[ChromiumManager] Extension ${ext.id} (${ext.name}) path does not exist: ${ext.path}`); return false; }
            const manifestPath = path.join(ext.path, 'manifest.json');
            if (!fs.existsSync(manifestPath)) { console.warn(`[ChromiumManager] Extension ${ext.id} (${ext.name}) has no manifest.json at: ${manifestPath}`); return false; }
            return true;
        });
        if (validExtensions.length > 0) {
            const extensionArgs = this.extensionManager.getExtensionArgs(validExtensions);
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

        // Compute extension IDs and write Secure Preferences BEFORE launch to auto-pin extensions
        // This must happen before Chrome spawns so it reads the pinned state on startup
        // NOTE: For CWS extensions (with update_url), we can't predict IDs without manifest.key.
        // We use known CWS IDs for popular extensions, path-based IDs for local unpacked extensions.
        if (validExtensions.length > 0) {
            try {
                const profileDir = path.join(userDataDir, 'Default');
                const securePrefsPath = path.join(profileDir, 'Secure Preferences');
                let securePrefs: any = {};
                if (fs.existsSync(securePrefsPath)) {
                    try { securePrefs = JSON.parse(fs.readFileSync(securePrefsPath, 'utf8')); } catch (e) {}
                }
                if (!securePrefs.extensions) securePrefs.extensions = {};
                if (!securePrefs.extensions.ui) securePrefs.extensions.ui = {};
                
                // Known CWS extension IDs (from Chrome Web Store)
                const knownCwsIds: Record<string, string> = {
                    // MetaMask
                    'd92c4e9b-0e74-4846-8dd6-0178eccefe3d': 'fignfifoniblkonapihmkfakmlgkbkcf',
                    // DuckDuckGo Privacy Essentials
                    '9189fd29-5b03-4840-abbb-e3f02bf6f662': 'ghbmnnjooekpmoecnnnilnnbdlolhkhi',
                };
                
                // Compute Chrome extension IDs for unpacked extensions (path-based algorithm)
                // Chrome algorithm for non-CWS: SHA256(absolute_path), first 16 bytes = 32 hex chars, each hex digit 0-f -> a-p
                const crypto = require('crypto');
                const pinnedIds: string[] = [];
                
                for (const ext of validExtensions) {
                    const manifestPath = path.join(ext.path, 'manifest.json');
                    let extId: string | null = null;

                    // 1. Check known CWS IDs by our internal UUID
                    if (knownCwsIds[ext.id]) {
                        extId = knownCwsIds[ext.id];
                    }
                    // 2. If manifest has key, compute CWS ID from public key (32 chars, a-p)
                    else if (fs.existsSync(manifestPath)) {
                        try {
                            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                            if (manifest.key) {
                                const hash = crypto.createHash('sha256').update(manifest.key).digest('hex').substring(0, 32);
                                const hexToAp: Record<string, string> = {
                                    '0': 'a', '1': 'b', '2': 'c', '3': 'd', '4': 'e', '5': 'f',
                                    '6': 'g', '7': 'h', '8': 'i', '9': 'j', 'a': 'k', 'b': 'l',
                                    'c': 'm', 'd': 'n', 'e': 'o', 'f': 'p'
                                };
                                let id = '';
                                for (const c of hash) {
                                    id += hexToAp[c] || c;
                                }
                                extId = id;
                            }
                        } catch (e) {}
                    }
                    
                    // 3. Fallback: path-based ID (32 chars, a-p) for unpacked extensions without key
                    // Chrome uses: SHA256(absolute_path), first 16 bytes = 32 hex chars, mapped to a-p
                    if (!extId) {
                        const absolutePath = path.resolve(ext.path);
                        const hash = crypto.createHash('sha256').update(absolutePath).digest('hex').substring(0, 32);
                        const hexToAp: Record<string, string> = {
                            '0': 'a', '1': 'b', '2': 'c', '3': 'd', '4': 'e', '5': 'f',
                            '6': 'g', '7': 'h', '8': 'i', '9': 'j', 'a': 'k', 'b': 'l',
                            'c': 'm', 'd': 'n', 'e': 'o', 'f': 'p'
                        };
                        let id = '';
                        for (const c of hash) {
                            id += hexToAp[c] || c;
                        }
                        extId = id;
                    }
                    
                    if (extId) {
                        pinnedIds.push(extId);
                    }
                }
                
                if (pinnedIds.length > 0) {
                    // Chrome expects toolbar positions as integers (extension_id -> position), not objects
                    securePrefs.extensions.ui.toolbar = pinnedIds.reduce((acc: any, id: string, index: number) => {
                        acc[id] = index;
                        return acc;
                    }, {});
                    fs.writeFileSync(securePrefsPath, JSON.stringify(securePrefs));
                }
            } catch (e: any) {
                console.warn('[ChromiumManager] Failed to pre-pin extensions:', e.message);
            }
        }

        // Add IP check page as startup URL
        // If we have a proxy or fingerprint to apply, we start with about:blank
        // and navigate later via CDP to prevent race conditions (leaks)
        
        // Screen resolution limit - cap to current screen resolution
        let maxScreenWidth = 3840, maxScreenHeight = 2160;
        try {
            if (os.platform() === 'win32') {
                const { execSync } = require('child_process');
                 const output = execSync('powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | Where-Object {$_.Primary -eq $true} | Select-Object -ExpandProperty Bounds | ForEach-Object { $_.Width; $_.Height }"', { encoding: 'utf8' });
                 const lines = output.trim().split('\n').map(Number);
                 if (lines.length >= 2 && !isNaN(lines[0]) && !isNaN(lines[1])) {
                     maxScreenWidth = lines[0];
                     maxScreenHeight = lines[1];
                 }
            }
        } catch (e) { }
        const screenWidth = Math.min(options.windowWidth || 1920, maxScreenWidth);
        const screenHeight = Math.min(options.windowHeight || 1080, maxScreenHeight);
        
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
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: false,
            env: { ...process.env }
        });

        // Capture Chrome stderr for diagnostics
        let chromeStderr = '';
        browserProcess.stderr?.on('data', (data) => {
            const msg = data.toString();
            chromeStderr += msg;
            if (msg.includes('extension') || msg.includes('Extension') || msg.includes('ERROR') || msg.includes('error')) {
            }
        });

        // Ensure the process is unref'd if we want it to stay alive
        if (browserProcess.unref) browserProcess.unref();

        const processInfo: ProcessInfo = {
            pid: browserProcess.pid!,
            devToolsPort,
            tunnelPort,
            userDataDir,
            proxyOptions: options,
            startUrls: [],
            contextId: contextId,
            resolvedTimezone: resolvedTimezoneForProcessInfo
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

    }

    /**
     * Unlock proxy tunnel for profile and open start URLs
     */
    async unlockProfile(profileId: string): Promise<void> {
        this.proxyTunnelManager.unlockTunnel(profileId);
        
        // Open deferred start URLs after delay to ensure page is stable
        const info = this.runningProcesses.get(profileId);
        if (info && info.startUrls && info.startUrls.length > 0) {
            const urls = [...info.startUrls];
            setTimeout(async () => {
                try {
                    await this.openStartUrls(profileId, urls);
                } catch (e) {
                    console.error('Failed to open start URLs on unlock:', e);
                }
            }, 500);
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

            // Get any page target (first available tab)
            const targets = await Target.getTargets();
            const pageTarget = targets.targetInfos.find((t: any) => t.type === 'page');

            if (pageTarget && urls.length > 0 && urls[0].trim()) {
                // Navigate the main tab to the first start URL
                const mainClient = await CDP({ port: info.devToolsPort, targetId: pageTarget.targetId });
                const { Page: MainPage } = mainClient;
                await MainPage.enable();
                await MainPage.navigate({ url: urls[0].trim() });
                await mainClient.close();
            }

            // For additional URLs, create new tabs
            for (let i = 1; i < urls.length; i++) {
                const url = urls[i];
                if (url && url.trim()) {
                    await Target.createTarget({ url: url.trim() });
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
    public async applyFingerprintViaCDP(profileId: string, port: number, fingerprint: any, startUrls?: string[], options: { restoreTabs?: boolean; contextId?: string } = {}): Promise<void> {
        try {
            const CDP = require('chrome-remote-interface');

            // If a contextId is provided, use context-isolated fingerprint
            let fp: any;
            if (options.contextId) {
                // Ensure we have a base fingerprint set for this profile
                if (!this.contextFingerprintManager.getBaseFingerprint(profileId)) {
                    this.setBaseFingerprint(profileId, fingerprint);
                }
                const contextFp = this.getContextFingerprint(profileId, options.contextId);
                if (contextFp) {
                    fp = contextFp; // already in nested format
                } else {
                    // Fallback to base fingerprint
                    const baseFp = this.contextFingerprintManager.getBaseFingerprint(profileId);
                    if (baseFp) {
                        fp = baseFp;
                    } else {
                        // Last resort: use the provided fingerprint and map it
                        fp = this.mapFingerprintToNested(fingerprint);
                    }
                }
            } else {
                // No contextId provided, map the provided fingerprint to nested format
                fp = this.mapFingerprintToNested(fingerprint);
                // Also set it as the base fingerprint for future use
                if (!this.contextFingerprintManager.getBaseFingerprint(profileId)) {
                    this.setBaseFingerprint(profileId, fp);
                }
            }
            
            
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

            // CRITICAL: Also connect to the browser-level target for global script injection
            // addScriptToEvaluateOnNewDocument on a page target only affects that page.
            // We need to set it on each page target AND listen for new targets.
            let browserClient: any = null;
            try {
                // Get the browser-level websocket URL
                const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`);
                const versionData = await versionResponse.json() as any;
                if (versionData.webSocketDebuggerUrl) {
                    browserClient = await CDP({ target: versionData.webSocketDebuggerUrl });
                }
            } catch (e) {
                // Browser-level connection optional
            }
const { Page, Network, Emulation, Browser, Target, Runtime } = client;

            await Page.enable();
            
            // CRITICAL: Resolve timezone from cache BEFORE creating injection script
            // This ensures JS injection uses the correct timezone, not 'auto'
            {
                const cachedInfoEarly = this.runningProcesses.get(profileId);
                if ((!fp.timezone?.id || fp.timezone.id === 'auto') && cachedInfoEarly?.resolvedTimezone) {
                    const tz = cachedInfoEarly.resolvedTimezone;
                    const offset = this.getOffsetMinutesForTimezone(tz);
                    fp.timezone = { id: tz, offset };
                }
            }

            // CRITICAL: Capture REAL system timezone offset BEFORE CDP changes it
            // This is needed for Date.now() adjustment in JS injection
            const realSystemOffset = new Date().getTimezoneOffset();
            
            // Inject stealth scripts
            const { FingerprintGenerator } = require('./fingerprint-generator');
            const generator = new FingerprintGenerator('');
            
            // Add system offset to fingerprint for JS injection
            const fpWithSystemOffset = {
                ...fp,
                _systemTimezoneOffset: realSystemOffset
            };
            
            const stealthScript = generator.generateInjectionScript(fpWithSystemOffset as any);
            // Inject the script into all new documents for THIS session/target
            await Page.addScriptToEvaluateOnNewDocument({ source: stealthScript });
            await Network.enable();
            await Runtime.enable();
            // Note: Emulation domain does not require an explicit enable command

            await Target.setDiscoverTargets({ discover: true });

            // CRITICAL: Apply injection script to ALL new page targets
            // addScriptToEvaluateOnNewDocument only works for the target it's called on.
            // We must listen for targetCreated and apply it to each new page.
            Target.on('targetCreated', async (event: any) => {
                const t = event.targetInfo;
                if (t.type !== 'page') return;
                try {
                    await new Promise(r => setTimeout(r, 300));
                    const newTargetClient = await CDP({ port, targetId: t.targetId });
                    const { Page: NPage } = newTargetClient;
                    await NPage.enable();
                    await NPage.addScriptToEvaluateOnNewDocument({ source: stealthScript });
                    await newTargetClient.close();
                } catch (e) { /* ignore */ }
            });

            // Set timezone override EARLY (before any page loads)
            // This prevents race condition where page loads before timezone is set
            if (fp.timezone && fp.timezone.id && fp.timezone.id !== 'auto') {
                try {
                    await Emulation.setTimezoneOverride({ timezoneId: fp.timezone.id });
                } catch (e: any) {
                    console.warn('[CDP] Early timezone override failed:', e.message);
                }
            }

            // CRITICAL: Apply timezone AND injection script to ALL existing page targets
            // setTimezoneOverride only applies to the current target by default
            const timezoneIdForTargets = fp.timezone?.id;
            if (timezoneIdForTargets && timezoneIdForTargets !== 'auto') {
                try {
                    const allTargets = await Target.getTargets();
                    for (const t of allTargets.targetInfos) {
                        if (t.type === 'page' || t.type === 'iframe') {
                            try {
                                const targetClient = await CDP({ port, targetId: t.targetId });
                                const { Emulation: TargetEmulation, Page: TargetPage, Runtime: TargetRuntime } = targetClient;
                                await TargetPage.enable().catch(() => {});
                                await TargetRuntime.enable().catch(() => {});
                                await TargetEmulation.setTimezoneOverride({ timezoneId: timezoneIdForTargets });
                                // Also inject stealth script into already-loaded pages
                                await TargetRuntime.evaluate({ expression: stealthScript }).catch(() => {});
                                await TargetPage.addScriptToEvaluateOnNewDocument({ source: stealthScript }).catch(() => {});
                                await targetClient.close();
                            } catch (e) { /* ignore per-target errors */ }
                        }
                    }
                } catch (e: any) {
                    console.warn('[CDP] Failed to apply timezone to all targets:', e.message);
                }
            }

            // CRITICAL: Listen for new targets and apply timezone + injection to each one
            // This ensures timezone is correct in every new tab the user opens
            if (timezoneIdForTargets && timezoneIdForTargets !== 'auto') {
                Target.on('targetCreated', async (event: any) => {
                    const t = event.targetInfo;
                    if (t.type === 'page') {
                        // Small delay to let target initialize
                        await new Promise(r => setTimeout(r, 200));
                        try {
                            const targetClient = await CDP({ port, targetId: t.targetId });
                            const { Emulation: TargetEmulation, Page: TargetPage } = targetClient;
                            await TargetEmulation.setTimezoneOverride({ timezoneId: timezoneIdForTargets });
                            await TargetPage.addScriptToEvaluateOnNewDocument({ source: stealthScript });
                            await targetClient.close();
                        } catch (e) { /* ignore */ }
                    }
                });
            }

            // Diagnostic: Check what targets Chrome actually has (extensions, background pages, etc.)
            let loadedExtensionIds: string[] = [];
            try {
                const targets = await Target.getTargets();
                const extensionTargets = targets.targetInfos.filter((t: any) => t.type === 'service_worker' || t.type === 'background_page' || t.type === 'other');
                for (const t of targets.targetInfos) {
                    // Extract extension ID from chrome-extension:// URLs
                    if (t.url && t.url.startsWith('chrome-extension://')) {
                        const match = t.url.match(/chrome-extension:\/\/([^/]+)/);
                        if (match && match[1]) {
                            loadedExtensionIds.push(match[1]);
                        }
                    }
                }
                if (extensionTargets.length === 0) {
                } else {
                }
            } catch (diagErr: any) {
                console.warn('[CDP Diagnostic] Failed to enumerate targets:', diagErr.message);
            }

            // Get userDataDir from running process info
            const processInfo = this.runningProcesses.get(profileId);
            const userDataDir = processInfo?.userDataDir;
            if (!userDataDir) {
            } else {
                // AUTO-PIN EXTENSIONS: Write Secure Preferences to pin loaded extensions to toolbar
                // This mimics AdsPower/Dolphin approach - pin extensions immediately after Chrome loads
                try {
                    const profileDir = path.join(userDataDir, 'Default');
                    const securePrefsPath = path.join(profileDir, 'Secure Preferences');
                    let securePrefs: any = {};
                    if (fs.existsSync(securePrefsPath)) {
                        try { securePrefs = JSON.parse(fs.readFileSync(securePrefsPath, 'utf8')); } catch (e) {}
                    }
                    if (!securePrefs.extensions) securePrefs.extensions = {};
                    if (!securePrefs.extensions.ui) securePrefs.extensions.ui = {};
                    
                    // Use actually loaded IDs from CDP (more reliable)
                    const pinnedIds = [...new Set(loadedExtensionIds)];
                    if (pinnedIds.length > 0) {
                        securePrefs.extensions.ui.toolbar = pinnedIds.reduce((acc: any, id: string, index: number) => {
                            acc[id] = index;
                            return acc;
                        }, {});
                        fs.writeFileSync(securePrefsPath, JSON.stringify(securePrefs));
                    }
                } catch (e: any) {
                    console.warn('[CDP] Failed to auto-pin extensions:', e.message);
                }

                // FORCE BOOKMARKS BAR: Rewrite Preferences after Chrome initializes (overwrites Chrome's defaults)
                // Chrome reads Preferences on startup but may reset bookmark_bar. We force it after connection.
                try {
                    const profileDir = path.join(userDataDir, 'Default');
                    const prefsPath = path.join(profileDir, 'Preferences');
                    if (fs.existsSync(prefsPath)) {
                        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
                        if (!prefs.bookmark_bar) prefs.bookmark_bar = {};
                        prefs.bookmark_bar.show_on_all_tabs = true;
                        prefs.bookmark_bar.visible_on_all_tabs = true;
                        if (!prefs.browser) prefs.browser = {};
                        prefs.browser.always_show_bookmarks_bar = true;
                        fs.writeFileSync(prefsPath, JSON.stringify(prefs));
                    }
                } catch (e: any) {
                    console.warn('[CDP] Failed to force bookmarks bar:', e.message);
                }
            }

const info = this.runningProcesses.get(profileId);
            
            // Store start URLs for later (after proxy verification), normalize URLs
            let infoStartUrls: string[] = [];
            if (info && startUrls && startUrls.length > 0) {
                infoStartUrls = startUrls.map(u => {
                    const trimmed = (u || '').trim();
                    if (!trimmed) return '';
                    // Add protocol if missing
                    return trimmed.match(/^https?:\/\//i) ? trimmed : `https://${trimmed}`;
                }).filter(u => u);
            }
            const ipCheckUrl = 'file:///' + path.join(__dirname, '..', 'ui', 'ip-check.html').replace(/\\/g, '/');
            const ipCheckUrlWithId = `${ipCheckUrl}?profileId=${profileId}`;
            
            let mainUrl: string;
            const additionalUrls: string[] = [];
            
            if (infoStartUrls.length > 0) {
                mainUrl = infoStartUrls[0];
                // Additional tabs: IP check page + remaining startUrls (from index 1)
                additionalUrls.push(ipCheckUrlWithId);
                for (let i = 1; i < infoStartUrls.length; i++) {
                    additionalUrls.push(infoStartUrls[i]);
                }
            } else {
                mainUrl = ipCheckUrlWithId;
                // No additional URLs
            }
            
            const navResult = await Page.navigate({ url: mainUrl });
            
            // Store for later tab opening
            if (info) {
                info.startUrls = additionalUrls;
            }

            // Set up proxy authentication to avoid browser popups
            if (info && info.proxyOptions && info.proxyOptions.proxyAuth) {
                const { username, password } = info.proxyOptions.proxyAuth;
                if (username) {
                    const { Fetch } = client;
                    await Fetch.enable({ handleAuthRequests: true });
                    
                    Fetch.authRequired(async (params: any) => {
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

            // Use cached timezone from launchProfile if available and timezone is 'auto'
            const cachedInfo = this.runningProcesses.get(profileId);
            if (timezoneId === 'auto' && cachedInfo?.resolvedTimezone) {
                timezoneId = cachedInfo.resolvedTimezone;
                const cachedOffset = this.getOffsetMinutesForTimezone(timezoneId);
                fp.timezone = { id: timezoneId, offset: cachedOffset };
            }

            if (timezoneId === 'auto' || language === 'auto_ip' || fingerprint.webrtc_mode === 'altered') {
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
                                // Cache the resolved timezone in processInfo for future calls
                                const procInfo = this.runningProcesses.get(profileId);
                                if (procInfo) procInfo.resolvedTimezone = timezoneId;
                            }

                            if (!geolocation) {
                                geolocation = {
                                    latitude: ipInfo.lat,
                                    longitude: ipInfo.lon,
                                    accuracy: 10 + Math.floor(Math.random() * 50)
                                };
                            }

                            if (language === 'auto_ip') {
                                language = ipChecker.getLanguageForCountry(ipInfo.countryCode);
                                acceptLanguage = `${language},en;q=0.9`;
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
            
            // CRITICAL: Always calculate offset if not already set
            // This ensures timezone spoofing works even without proxy
            if (typeof fp.timezone.offset !== 'number') {
                fp.timezone.offset = this.getOffsetMinutesForTimezone(timezoneId);
            }
            
            fp.geolocation = geolocation;
            if (!fp.languages) fp.languages = {};
            fp.languages.language = language;
            fp.languages.acceptLanguage = acceptLanguage;
            
            if (!fp.webrtc) fp.webrtc = {};
            fp.webrtc.mode = fingerprint.webrtc_mode;
            fp.webrtc.publicIp = fingerprint.webrtc_public_ip || resolvedIp;

            // ====== CRITICAL: Apply CDP Emulation with resolved values ======
            
            // 1. Set/Update Timezone Override (after proxy IP resolution)
            // Note: May have been set early, but we update with correct value from proxy
            try {
                await Emulation.setTimezoneOverride({ timezoneId });
            } catch (e: any) {
                console.warn('[CDP] Failed to set timezone override:', e.message);
            }

            // CRITICAL: Re-inject stealth script with resolved timezone
            // The initial script was injected with 'auto' timezone - now we have the real one
            // This ensures all new pages get the correct timezone in JS
            try {
                const { FingerprintGenerator: FG2 } = require('./fingerprint-generator');
                const gen2 = new FG2('');
                const updatedFp = { ...fp, _systemTimezoneOffset: new Date().getTimezoneOffset() };
                const updatedScript = gen2.generateInjectionScript(updatedFp as any);
                await Page.addScriptToEvaluateOnNewDocument({ source: updatedScript });
                
                // Also execute in current page context to update existing page
                await Runtime.evaluate({ expression: updatedScript });
            } catch (e: any) {
                console.warn('[CDP] Failed to re-inject stealth script:', e.message);
            }

            // 2. Set Locale Override
            if (language && language !== 'en-US' && language !== 'auto_ip') {
                try {
                    await Emulation.setLocaleOverride({ locale: language });
                } catch (e: any) {
                    if (!e.message?.includes('Already in effect')) {
                        console.warn('[CDP] Locale override error:', e.message);
                    }
                }
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

            

            // Apply Cookies from Database (Primary for migrated profiles)
            try {
                const cookieManager = new CookieManager(this.db);
                const cookies = await cookieManager.getCookies(profileId);
                if (cookies.length > 0) {
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

            // Open start URLs for additional tabs (not the main one which we already navigated)
            if (info && info.startUrls && info.startUrls.length > 1) {
                for (let i = 1; i < info.startUrls.length; i++) {
                    const url = info.startUrls[i];
                    if (url && url.trim()) {
                        try {
                            await Target.createTarget({ url: url.trim() });
                        } catch (e) {
                            console.error('Failed to open additional tab:', e);
                        }
                    }
                }
                info.startUrls = [];
            }

            // Save CDP client to processInfo so it stays alive for target listeners
            const procInfoForClient = this.runningProcesses.get(profileId);
            if (procInfoForClient) {
                procInfoForClient.cdpClient = client;
            }

            // DO NOT close client here, it will be closed in terminateProfile or on exit
        } catch (error) {
            console.error('Failed to apply fingerprint via CDP:', error);
        }
    }
}
