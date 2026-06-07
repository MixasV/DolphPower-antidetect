import { Database } from 'sqlite3';
import * as child_process from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SecurityManager } from './security-manager';
import { EmergencyLockoutService } from './emergency-lockout.service';
import { WalletSecurityService } from './wallet-security.service';

/**
 * Interface for threat detection result
 */
interface ThreatDetection {
    type: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
    timestamp: number;
    details?: Record<string, any>;
}

/**
 * Configuration for threat monitoring
 */
interface ThreatMonitoringConfig {
    enabled: boolean;
    scanIntervalMs: number;
    processCheckEnabled: boolean;
    fileSystemCheckEnabled: boolean;
    networkCheckEnabled: boolean;
    autoLockoutOnHighThreat: boolean;
    knownThreatProcesses: string[]; // Process names to blacklist
    sensitiveDirectories: string[]; // Directories to monitor for suspicious access
}

/**
 * Threat monitoring service for detecting and responding to local security threats
 */
export class ThreatMonitoringService {
    private readonly db: Database;
    private readonly securityManager: SecurityManager;
    private readonly emergencyLockoutService: EmergencyLockoutService;
    private readonly walletSecurityService: WalletSecurityService;
    private config: ThreatMonitoringConfig;
    private readonly configPath: string;
    private scanTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private lastScanTime: number = 0;

    constructor(db: Database) {
        this.db = db;
        this.securityManager = new SecurityManager(); // Will be initialized when needed
        this.emergencyLockoutService = EmergencyLockoutService.getInstance();
        this.walletSecurityService = new WalletSecurityService();
        this.config = this.getDefaultConfig();
        this.configPath = path.join(os.homedir(), '.antidetect', 'threat-monitoring-config.json');
        this.loadConfig();
    }

    private getDefaultConfig(): ThreatMonitoringConfig {
        return {
            enabled: true,
            scanIntervalMs: 5000, // 5 seconds
            processCheckEnabled: true,
            fileSystemCheckEnabled: true,
            networkCheckEnabled: false, // Network monitoring requires more privileges and is complex
            autoLockoutOnHighThreat: true,
            knownThreatProcesses: [
                // Known keyloggers
                'keylogger.exe',
                'keysniffer.exe',
                'akb.exe',
                'wbhook.exe',
                // Known screen capture tools that might be malicious
                'screenrecorder.exe',
                'screencapture.exe',
                // Known stealers
                'stealer.exe',
                'passwordstealer.exe',
                // Known RATs (Remote Access Trojans)
                'rat.exe',
                'trojan.exe',
                // Common malicious process names (be cautious with false positives)
                'svchost.exe', // Note: This is a common legitimate process, we'll be more specific in actual implementation
                // We'll focus on specific known malicious processes rather than generic ones
            ].filter(p => p !== 'svchost.exe'), // Remove overly generic ones
            sensitiveDirectories: [
                path.join(os.homedir(), '.antidetect'),
                // Add wallet key storage directory if we can determine it
                // For now, we'll monitor the .antidetect directory which contains the database and configs
            ]
        };
    }

    private async loadConfig(): Promise<void> {
        try {
            await fs.mkdir(path.dirname(this.configPath), { recursive: true });
            const data = await fs.readFile(this.configPath, { encoding: 'utf8' });
            const parsed = JSON.parse(data);
            // Merge with defaults to ensure all fields are present
            this.config = { ...this.getDefaultConfig(), ...parsed };
        } catch (error) {
            // No config file exists, use defaults
            this.config = this.getDefaultConfig();
            await this.saveConfig();
        }
    }

    private async saveConfig(): Promise<void> {
        await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), { encoding: 'utf8' });
    }

    /**
     * Start the threat monitoring service
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            return;
        }

        if (!this.config.enabled) {
            console.log('Threat monitoring is disabled in configuration');
            return;
        }

        this.isRunning = true;
        console.log('Starting threat monitoring service...');

        // Perform an initial scan
        await this.performScan();

        // Set up periodic scanning
        this.scanTimer = setInterval(async () => {
            try {
                await this.performScan();
            } catch (error) {
                console.error('Error during threat monitoring scan:', error);
            }
        }, this.config.scanIntervalMs);
    }

    /**
     * Stop the threat monitoring service
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }
        console.log('Threat monitoring service stopped');
    }

    /**
     * Perform a single scan for threats
     */
    async performScan(): Promise<ThreatDetection[]> {
        this.lastScanTime = Date.now();
        const threats: ThreatDetection[] = [];

        try {
            if (this.config.processCheckEnabled) {
                const processThreats = await this.checkForThreatProcesses();
                threats.push(...processThreats);
            }

            if (this.config.fileSystemCheckEnabled) {
                const fileSystemThreats = await this.checkFileSystemIntegrity();
                threats.push(...fileSystemThreats);
            }

            // Network check would require more privileges and is complex to implement reliably
            // Skipping for now as per config default

            // Process any detected threats
            for (const threat of threats) {
                await this.handleThreatDetection(threat);
            }

            return threats;
        } catch (error) {
            console.error('Error during threat scan:', error);
            return [];
        }
    }

    /**
     * Check for known threatening processes
     */
    private async checkForThreatProcesses(): Promise<ThreatDetection[]> {
        const threats: ThreatDetection[] = [];

        try {
            // Use tasklist to get running processes on Windows
            const output = child_process.execSync('tasklist /fo csv /nh').toString();
            const lines = output.trim().split('\n');

            for (const line of lines) {
                // Parse CSV line: "Image Name","PID","Session Name","Session#","Mem Usage"
                const match = line.match(/^"([^"]+)","(\d+)","[^"]+","(\d+)","[^"]+"$/);
                if (match) {
                    const processName = match[1].toLowerCase();
                    const pid = parseInt(match[2]);

                    // Check against our blacklist
                    for (const threatProcess of this.config.knownThreatProcesses) {
                        if (processName === threatProcess.toLowerCase()) {
                            threats.push({
                                type: 'malicious_process',
                                severity: 'high',
                                description: `Known threat process detected: ${processName} (PID: ${pid})`,
                                timestamp: Date.now(),
                                details: { processName, pid }
                            });
                            break; // No need to check other threat processes for this one
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to check processes:', error);
            // If we can't check processes, we might want to report this as a potential issue
            // but for now we'll just skip
        }

        return threats;
    }

    /**
     * Check file system integrity in sensitive directories
     */
    private async checkFileSystemIntegrity(): Promise<ThreatDetection[]> {
        const threats: ThreatDetection[] = [];

        try {
            for (const dir of this.config.sensitiveDirectories) {
                try {
                    const stats = await fs.stat(dir);
                    // We could check for unexpected changes, but for now we'll just verify the directory exists and is accessible
                    // In a more advanced implementation, we could monitor for new files or changes to existing ones
                    // For this implementation, we'll do a basic check: look for files with suspicious names or extensions
                    const files = await fs.readdir(dir);
                    for (const file of files) {
                        const lowerCaseFile = file.toLowerCase();
                        // Check for known malicious file patterns
                        if (
                            lowerCaseFile.includes('keylog') ||
                            lowerCaseFile.includes('sniffer') ||
                            lowerCaseFile.includes('rat') ||
                            lowerCaseFile.includes('trojan') ||
                            lowerCaseFile.endsWith('.exe') && lowerCaseFile.includes('password') ||
                            lowerCaseFile.includes('stealer')
                        ) {
                            threats.push({
                                type: 'suspicious_file',
                                severity: 'medium',
                                description: `Suspicious file detected in monitored directory: ${file}`,
                                timestamp: Date.now(),
                                details: { directory: dir, fileName: file }
                            });
                        }
                    }
                } catch (error) {
                    // Directory might not exist or be accessible
                    console.warn(`Could not access directory ${dir}:`, error);
                }
            }
        } catch (error) {
            console.error('Error during file system integrity check:', error);
        }

        return threats;
    }

    /**
     * Handle a detected threat
     */
    private async handleThreatDetection(threat: ThreatDetection): Promise<void> {
        console.warn(`Threat detected: ${threat.description}`);

        // Log the threat to a secure log (in a real implementation, we might want to store this)
        // For now, we'll just log to console

        // If configured to auto-lockout on high threats and this is a high severity threat
        if (this.config.autoLockoutOnHighThreat && threat.severity === 'high') {
            console.log('High severity threat detected, initiating emergency lockout...');
            try {
                await this.emergencyLockoutService.triggerEmergencyLockout('Threat detected: ' + threat.description);
            } catch (error) {
                console.error('Failed to trigger emergency lockout:', error);
            }
        }

        // In a more advanced implementation, we might also:
        // - Notify the user via a secure channel
        // - Take a screenshot of the desktop (if allowed and not compromising)
        // - Collect more forensic data
        // - Block the threatening process
    }

    /**
     * Get current configuration
     */
    getConfig(): ThreatMonitoringConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    async updateConfig(newConfig: Partial<ThreatMonitoringConfig>): Promise<void> {
        this.config = { ...this.config, ...newConfig };
        await this.saveConfig();

        // If monitoring is running and enabled/disabled changed, restart if needed
        if (this.isRunning) {
            if (!this.config.enabled) {
                await this.stop();
            } else {
                // If it was disabled and now enabled, restart
                // But we're already running, so just continue with new config
            }
        } else if (this.config.enabled) {
            // If not running but now enabled, start
            await this.start();
        }
    }

    /**
     * Get the last scan time
     */
    getLastScanTime(): number {
        return this.lastScanTime;
    }

    /**
     * Check if monitoring is currently running
     */
    isMonitoringActive(): boolean {
        return this.isRunning;
    }
}

// Singleton instance
let threatMonitoringService: ThreatMonitoringService | null = null;

export function getThreatMonitoringService(db: Database): ThreatMonitoringService {
    if (!threatMonitoringService) {
        threatMonitoringService = new ThreatMonitoringService(db);
    }
    return threatMonitoringService;
}
