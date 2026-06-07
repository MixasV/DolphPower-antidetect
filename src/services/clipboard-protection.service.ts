import clipboard from 'clipboardy';

/**
 * Service to protect sensitive data in clipboard
 * Automatically clears clipboard content that appears to be sensitive
 * after a configurable delay
 */
export class ClipboardProtectionService {
    private readonly CHECK_INTERVAL_MS = 500; // Check every 500ms
    private readonly CLEAR_DELAY_MS = 10000;  // Clear after 10 seconds
    private monitorInterval: NodeJS.Timeout | null = null;
    private clipboardHistory: string[] = [];
    private readonly MAX_HISTORY = 10;
    private isMonitoring = false;

    // Patterns for detecting sensitive data
    private readonly SENSITIVE_PATTERNS = [
        // Seed phrases (12 or 24 words)
        /^\s*(?:[a-z]+\s+){11}[a-z]+\s*$/i,
        /^\s*(?:[a-z]+\s+){23}[a-z]+\s*$/i,
        
        // Private keys (64 hex chars, optionally with 0x)
        /^(0x)?[0-9a-fA-F]{64}$/,
        
        // Wallet addresses
        /^0x[a-fA-F]{40}$/, // Ethereum
        /^(1|3|bc1)[a-zA-Z0-9]{25,39}$/, // Bitcoin
        
        // API keys and tokens
        /^(sk|pk|api|key)[-_][a-zA-Z0-9]{20,}$/i,
        
        // Passwords that look strong (long, mixed chars)
        /^.{16,}$/ // Simple length-based check for potential passwords
    ];

    constructor() {
        // Bind methods
        this.checkClipboard = this.checkClipboard.bind(this);
    }

    /**
     * Start monitoring clipboard for sensitive data
     */
    startMonitoring(): void {
        if (this.isMonitoring) return;
        
        this.isMonitoring = true;
        this.monitorInterval = setInterval(this.checkClipboard, this.CHECK_INTERVAL_MS);
        console.log('[ClipboardProtection] Started monitoring clipboard');
    }

    /**
     * Stop monitoring clipboard
     */
    stopMonitoring(): void {
        if (!this.isMonitoring) return;
        
        this.isMonitoring = false;
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        console.log('[ClipboardProtection] Stopped monitoring clipboard');
    }

    /**
     * Check clipboard content and clear if sensitive
     */
    private async checkClipboard(): Promise<void> {
        try {
            const current = await clipboard.read();
            
            // Skip if empty or same as last checked
            if (!current || this.clipboardHistory.includes(current)) {
                return;
            }
            
            // Add to history (maintain limited size)
            this.clipboardHistory.push(current);
            if (this.clipboardHistory.length > this.MAX_HISTORY) {
                this.clipboardHistory.shift();
            }
            
            // Check if content appears sensitive
            if (this.isSensitiveContent(current)) {
                console.log('[ClipboardProtection] Sensitive data detected in clipboard');
                
                // Schedule clearing after delay
                setTimeout(async () => {
                    try {
                        // Only clear if content hasn't changed
                        const currentNow = await clipboard.read();
                        if (currentNow === current) {
                            await clipboard.write('');
                            console.log('[ClipboardProtection] Cleared sensitive clipboard content');
                        }
                    } catch (error) {
                        console.error('[ClipboardProtection] Error clearing clipboard:', error);
                    }
                }, this.CLEAR_DELAY_MS);
                
                // Also show user notification (in real implementation, this would use a proper notification system)
                // For now, we'll log - in Electron app this would show a toast or notification
                console.log('[ClipboardProtection] Sensitive data will be cleared from clipboard in 10 seconds');
            }
        } catch (error) {
            console.error('[ClipboardProtection] Error reading clipboard:', error);
        }
    }

    /**
     * Check if content matches sensitive patterns
     * @param text Text to check
     * @returns True if appears to contain sensitive data
     */
    private isSensitiveContent(text: string): boolean {
        if (!text || typeof text !== 'string') return false;
        
        // Trim whitespace for checking
        const trimmed = text.trim();
        if (!trimmed) return false;
        
        // Check against each pattern
        return this.SENSITIVE_PATTERNS.some(pattern => pattern.test(trimmed));
    }

    /**
     * Manually clear clipboard immediately
     */
    async clearClipboardNow(): Promise<void> {
        try {
            await clipboard.write('');
            console.log('[ClipboardProtection] Manual clipboard clear executed');
        } catch (error) {
            console.error('[ClipboardProtection] Error clearing clipboard:', error);
        }
    }

    /**
     * Get current clipboard content (for testing/debugging)
     */
    async getClipboardContent(): Promise<string> {
        try {
            return await clipboard.read();
        } catch (error) {
            console.error('[ClipboardProtection] Error reading clipboard:', error);
            return '';
        }
    }
}

// Singleton instance
let clipboardProtectionService: ClipboardProtectionService | null = null;

export function getClipboardProtectionService(): ClipboardProtectionService {
    if (!clipboardProtectionService) {
        clipboardProtectionService = new ClipboardProtectionService();
    }
    return clipboardProtectionService;
}
