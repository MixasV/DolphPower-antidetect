import { WalletSecurityService } from './wallet-security.service';
import { ClipboardProtectionService } from './clipboard-protection.service';
import { ScreenProtectionService } from './screen-protection.service';
import { EncryptionService } from './encryption-service';

/**
 * Emergency lockout service for instant protection of wallet data
 * Provides quick methods to secure sensitive information in case of threat
 */
export class EmergencyLockoutService {
    private walletService: WalletSecurityService | null = null;
    private clipboardService: ClipboardProtectionService | null = null;
    private screenService: ScreenProtectionService | null = null;
    private encryptionService: EncryptionService | null = null;
    private isLockedOut = false;
    private lockoutTime: number | null = null;
    private readonly LOCKOUT_DURATION_MS = 300000; // 5 minutes default lockout

    constructor() {
        this.initialize();
    }

    private initialize(): void {
        // Initialize services
        this.walletService = new WalletSecurityService();
        this.clipboardService = ClipboardProtectionService.getClipboardProtectionService();
        this.screenService = ScreenProtectionService.getScreenProtectionService();
        this.encryptionService = EncryptionService;
    }

    /**
     * Activate emergency lockout - immediately secures all sensitive data
     * @param durationMs Optional lockout duration in milliseconds (default: 5 minutes)
     */
    async activateEmergencyLockout(durationMs: number = this.LOCKOUT_DURATION_MS): Promise<void> {
        if (this.isLockedOut) return; // Already locked out

        console.log('[EmergencyLockout] Activating emergency lockout');
        
        this.isLockedOut = true;
        this.lockoutTime = Date.now() + durationMs;

        try {
            // 1. Wipe wallet data from secure storage
            await this.walletService?.wipeWalletData();
            console.log('[EmergencyLockout] Wallet data wiped from secure storage');
            
            // 2. Clear clipboard immediately
            await this.clipboardService?.clearClipboardNow();
            console.log('[EmergencyLockout] Clipboard cleared');
            
            // 3. Stop clipboard monitoring (will restart after lockout period)
            this.clipboardService?.stopMonitoring();
            console.log('[EmergencyLockout] Clipboard monitoring stopped');
            
            // 4. Activate screen protection
            this.screenService?.startProtection();
            console.log('[EmergencyLockout] Screen protection activated');
            
            // 5. Clear master key from encryption service (if applicable)
            EncryptionService.clearMasterKey();
            console.log('[EmergencyLockout] Encryption master key cleared');
            
            // 6. Schedule automatic reset after lockout period
            setTimeout(() => {
                this.resetLockout();
            }, durationMs);
            
            console.log(`[EmergencyLockout] Emergency lockout activated for ${durationMs / 1000} seconds`);
            
        } catch (error) {
            console.error('[EmergencyLockout] Error during emergency lockout activation:', error);
            // Even if some steps fail, we still consider it locked out for safety
            this.isLockedOut = true;
        }
    }

    /**
     * Reset lockout state and restore normal operation
     */
    private resetLockout(): void {
        console.log('[EmergencyLockout] Resetting lockout state');
        
        this.isLockedOut = false;
        this.lockoutTime = null;
        
        // Restart clipboard monitoring
        this.clipboardService?.startMonitoring();
        console.log('[EmergencyLockout] Clipboard monitoring restarted');
        
        // Stop screen protection (user can restart if needed)
        this.screenService?.stopProtection();
        console.log('[EmergencyLockout] Screen protection stopped');
        
        // Note: Master key will need to be re-set by user login process
        console.log('[EmergencyLockout] Lockout reset - user must re-authenticate to restore encryption access');
    }

    /**
     * Check if emergency lockout is currently active
     * @returns True if in lockout state
     */
    isInLockout(): boolean {
        // Check if lockout time has expired
        if (this.isLockedOut && this.lockoutTime !== null && Date.now() > this.lockoutTime) {
            this.resetLockout();
            return false;
        }
        return this.isLockedOut;
    }

    /**
     * Get remaining lockout time in seconds
     * @returns Remaining time in seconds, or 0 if not locked out
     */
    getRemainingLockoutTime(): number {
        if (!this.isLockedOut || !this.lockoutTime) return 0;
        const remaining = this.lockoutTime - Date.now();
        return Math.max(0, Math.ceil(remaining / 1000));
    }

    /**
     * Manually trigger emergency lockout (for testing or direct invocation)
     * In a real app, this would be tied to a panic key combination or button
     */
    static triggerEmergencyLockout(): void {
        const instance = EmergencyLockoutService.getInstance();
        instance.activateEmergencyLockout();
    }

    // Singleton pattern
    private static instance: EmergencyLockoutService | null = null;

    static getInstance(): EmergencyLockoutService {
        if (!EmergencyLockoutService.instance) {
            EmergencyLockoutService.instance = new EmergencyLockoutService();
        }
        return EmergencyLockoutService.instance;
    }
}

// Export for direct use
export default EmergencyLockoutService;
