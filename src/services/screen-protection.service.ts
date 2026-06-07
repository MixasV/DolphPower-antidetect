/**
 * Service to protect against screen capture of sensitive information
 * Attempts to detect and prevent screenshots/screen recording of sensitive areas
 * Note: True prevention is OS/browser dependent, but we can implement warnings and mitigation strategies
 */
export class ScreenProtectionService {
    private readonly CHECK_INTERVAL_MS = 1000; // Check every second
    private protectionInterval: NodeJS.Timeout | null = null;
    private isProtected = false;
    private protectedElements: Map<string, HTMLElement> = new Map();
    private readonly WARNING_MESSAGE = 'Скриншоты и запись экрана могут быть заблокированы для защиты конфиденциальных данных';

    constructor() {
        // Bind methods
        this.checkForScreenCapture = this.checkForScreenCapture.bind(this);
        this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    }

    /**
     * Start screen protection monitoring
     */
    startProtection = (): void => {
        if (this.isProtected) return;
        
        this.isProtected = true;
        this.protectionInterval = setInterval(this.checkForScreenCapture, this.CHECK_INTERVAL_MS);
        
        // Also listen for visibility changes (when tab/window is hidden)
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        
        console.log('[ScreenProtection] Screen protection started');
    }

    /**
     * Stop screen protection monitoring
     */
    stopProtection = (): void => {
        if (!this.isProtected) return;
        
        this.isProtected = false;
        if (this.protectionInterval) {
            clearInterval(this.protectionInterval);
            this.protectionInterval = null;
        }
        
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        
        // Remove all overlays
        this.clearAllOverlays();
        
        console.log('[ScreenProtection] Screen protection stopped');
    }

    /**
     * Check for signs of screen capture or recording
     * This is a best-effort approach as true prevention is limited in browsers
     */
    private checkForScreenCapture = async (): Promise<void> => {
        try {
            // Check if document is hidden (could indicate screenshot/recording attempt)
            if (document.hidden) {
                this.handlePotentialCapture();
                return;
            }

            // Check for known screen recording indicators (browser-specific)
            // Note: These are speculative as browsers don't typically expose this info
            // @ts-ignore
            if (navigator.mediaDevices && navigator.mediaDevices.getSupportedConstraints) {
                // We could attempt to enumerate media devices, but this requires permissions
                // and may not reliably indicate screen capture
            }

            // Additional heuristic checks could go here
            // For example, checking for unusual timing anomalies or memory usage patterns

        } catch (error) {
            console.error('[ScreenProtection] Error checking for screen capture:', error);
        }
    }

    /**
     * Handle potential screen capture attempt
     */
    private handlePotentialCapture(): void {
        console.log('[ScreenProtection] Potential screen capture detected');
        
        // In a real implementation, we might:
        // 1. Show a warning overlay
        // 2. Temporarily blur or obscure sensitive content
        // 3. Log the event for security audit
        // 4. In Electron apps, we could use more sophisticated OS-level detection
        
        this.showProtectionWarning();
    }

    /**
     * Handle visibility change events (when tab/window becomes hidden/invisible)
     */
    private handleVisibilityChange(): void {
        if (document.hidden) {
            // Window/tab is hidden - could be user switched tabs, minimized, or screen recording
            this.handlePotentialCapture();
        } else {
            // Window/tab is now visible again
            this.hideProtectionWarning();
        }
    }

    /**
     * Show a warning overlay indicating screen protection is active
     */
    private showProtectionWarning(): void {
        // Create overlay element
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        overlay.style.color = 'white';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '999999';
        overlay.style.fontFamily = 'Arial, sans-serif';
        overlay.style.fontSize = '16px';
        overlay.style.textAlign = 'center';
        overlay.style.padding = '20px';
        overlay.style.boxSizing = 'border-box';
        overlay.style.pointerEvents = 'none'; // Allow clicks to pass through
        overlay.id = 'screen-protection-overlay';
        
        overlay.innerHTML = `
            <div>
                <strong>${this.WARNING_MESSAGE}</strong><br>
                Для продолжения работы убедитесь, что не выполняется запись экрана или скриншот
            </div>
        `;
        
        document.body.appendChild(overlay);
    }

    /**
     * Hide the protection warning overlay
     */
    private hideProtectionWarning(): void {
        const overlay = document.getElementById('screen-protection-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    /**
     * Protect a specific element from screen capture (by attempting to obscure it)
     * @param elementId ID of the element to protect
     * @param element The DOM element to protect
     */
    protectElement(elementId: string, element: HTMLElement): void {
        if (!element || !(element instanceof HTMLElement)) return;
        
        // Store reference to element
        this.protectedElements.set(elementId, element);
        
        // Create a placeholder/overlay that will appear if screenshot is attempted
        const protector = document.createElement('div');
        protector.style.position = 'absolute';
        protector.style.top = '0';
        protector.style.left = '0';
        protector.style.width = '100%';
        protector.style.height = '100%';
        protector.style.backgroundColor = 'rgba(0, 0, 0, 0.1)'; // Slightly visible during normal use
        protector.style.transition = 'background-color 0.3s ease';
        protector.style.zIndex = '9999';
        protector.style.pointerEvents = 'none';
        protector.style.border = '2px dashed rgba(255, 255, 255, 0.3)';
        protector.style.boxSizing = 'border-box';
        
        // Make it more obvious when protection is active
        protector.innerHTML = '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 14px; text-align: center;">Защищено от скриншотов</div>';
        
        // Position the protector over the element
        const positionElement = (el: HTMLElement) => {
            const rect = el.getBoundingClientRect();
            protector.style.position = 'fixed';
            protector.style.top = `${rect.top + window.scrollY}px`;
            protector.style.left = `${rect.left + window.scrollX}px`;
            protector.style.width = `${rect.width}px`;
            protector.style.height = `${rect.height}px`;
        };
        
        // Initial positioning
        positionElement(element);
        
        // Update position on scroll/resize
        const updatePosition = () => positionElement(element);
        window.addEventListener('scroll', updatePosition);
        window.addEventListener('resize', updatePosition);
        
        // Store cleanup function
        const cleanup = () => {
            window.removeEventListener('scroll', updatePosition);
            window.removeEventListener('resize', updatePosition);
            protector.remove();
            this.protectedElements.delete(elementId);
        };
        
        // Attach cleanup to element data for later removal
        (element as any).__screenProtectorCleanup = cleanup;
        
        // Add protector to document
        document.body.appendChild(protector);
        
        // Start with subtle protection
        setTimeout(() => {
            protector.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
        }, 100);
    }

    /**
     * Remove protection from a specific element
     * @param elementId ID of the element to unprotect
     */
    unprotectElement(elementId: string): void {
        const element = this.protectedElements.get(elementId);
        if (element) {
            const cleanup = (element as any).__screenProtectorCleanup;
            if (typeof cleanup === 'function') {
                cleanup();
            }
        }
    }

    /**
     * Clear all protection overlays and listeners
     */
    private clearAllOverlays(): void {
        // Remove warning overlay
        const warningOverlay = document.getElementById('screen-protection-overlay');
        if (warningOverlay) {
            warningOverlay.remove();
        }
        
        // Remove all element protectors
        this.protectedElements.forEach((element, elementId) => {
            this.unprotectElement(elementId);
        });
        this.protectedElements.clear();
    }

    /**
     * Get current protection status
     */
    isProtectionActive(): boolean {
        return this.isProtected;
    }
}

// Singleton instance
let screenProtectionService: ScreenProtectionService | null = null;

export function getScreenProtectionService(): ScreenProtectionService {
    if (!screenProtectionService) {
        screenProtectionService = new ScreenProtectionService();
    }
    return screenProtectionService;
}
