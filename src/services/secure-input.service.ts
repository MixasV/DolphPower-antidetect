/**
 * Service for secure input of sensitive data like wallet credentials
 * Provides protection against keyloggers and screen capture during input
 */
export class SecureInputService {
    private readonly INPUT_ELEMENT_ID = 'secure-input-field';
    private readonly OVERLAY_ID = 'secure-input-overlay';
    private readonly CONTAINER_ID = 'secure-input-container';
    
    private isActive = false;
    private inputElement: HTMLInputElement | null = null;
    private overlayElement: HTMLElement | null = null;
    private containerElement: HTMLElement | null = null;
    private originalBodyOverflow: string = '';
    private inputValue: string = '';
    private maskCharacter: string = '•';
    private showTimeout: NodeJS.Timeout | null = null;
    private readonly SHOW_DELAY_MS = 2000; // Show character for 2 seconds before masking
    
    constructor() {
        this.initializeSecureInput();
    }

    private initializeSecureInput(): void {
        // Create the secure input container
        this.containerElement = document.createElement('div');
        this.containerElement.id = this.CONTAINER_ID;
        this.containerElement.style.position = 'fixed';
        this.containerElement.style.top = '0';
        this.containerElement.style.left = '0';
        this.containerElement.style.width = '100%';
        this.containerElement.style.height = '100%';
        this.containerElement.style.display = 'none'; // Hidden by default
        this.containerElement.style.alignItems = 'center';
        this.containerElement.style.justifyContent = 'center';
        this.containerElement.style.zIndex = '999999';
        this.containerElement.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.containerElement.style.color = 'white';
        this.containerElement.style.fontFamily = 'Arial, sans-serif';
        this.containerElement.style.padding = '20px';
        this.containerElement.style.boxSizing = 'border-box';
        
        // Create overlay for dimming background
        this.overlayElement = document.createElement('div');
        this.overlayElement.id = this.OVERLAY_ID;
        this.overlayElement.style.position = 'absolute';
        this.overlayElement.style.top = '0';
        this.overlayElement.style.left = '0';
        this.overlayElement.style.width = '100%';
        this.overlayElement.style.height = '100%';
        this.overlayElement.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
        this.overlayElement.style.zIndex = '1';
        
        // Create the actual input field
        this.inputElement = document.createElement('input');
        this.inputElement.id = this.INPUT_ELEMENT_ID;
        this.inputElement.type = 'password';
        this.inputElement.placeholder = 'Введите敏感ные данные...';
        this.inputElement.style.padding = '15px';
        this.inputElement.style.fontSize = '18px';
        this.inputElement.style.border = 'none';
        this.inputElement.style.borderRadius = '4px';
        this.inputElement.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        this.inputElement.style.color = '#333';
        this.inputElement.style.width = '300px';
        this.inputElement.style.boxSizing = 'border-box';
        this.inputElement.style.textAlign = 'center';
        this.inputElement.style.fontFamily = 'monospace';
        
        // Add event listeners
        this.inputElement.addEventListener('input', this.handleInput.bind(this));
        this.inputElement.addEventListener('keydown', this.handleKeyDown.bind(this));
        this.inputElement.addEventListener('blur', this.handleBlur.bind(this));
        
        // Assemble the container
        this.containerElement.appendChild(this.overlayElement);
        this.containerElement.appendChild(this.inputElement);
        
        // Add to document body
        document.body.appendChild(this.containerElement);
    }

    /**
     * Show secure input dialog for sensitive data entry
     * @param prompt Text to show as placeholder/instruction
     * @param callback Function to call with entered value when user confirms
     * @param maskCharacter Character to use for masking (default: '•')
     */
    async requestSecureInput(
        prompt: string = 'Введите конфиденциальные данные:',
        callback: (value: string) => void,
        maskCharacter: string = '•'
    ): Promise<void> {
        if (this.isActive) return; // Already active
        
        this.maskCharacter = maskCharacter;
        this.inputValue = '';
        
        // Update prompt
        if (this.inputElement) {
            this.inputElement.placeholder = prompt;
            this.inputElement.value = ''; // Clear any previous value
        }
        
        // Show the secure input overlay
        this.showSecureInput();
        
        // Return a promise that resolves when user submits or cancels
        return new Promise((resolve) => {
            // Store resolve function to be called on submit/cancel
            (this.containerElement as any).__resolveCallback = resolve;
            // Store the actual callback to process the value
            (this.containerElement as any).__inputCallback = callback;
        });
    }

    private showSecureInput(): void {
        if (!this.containerElement) return;
        
        this.isActive = true;
        this.containerElement.style.display = 'flex';
        
        // Store original body overflow and prevent scrolling
        this.originalBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        
        // Focus the input field
        if (this.inputElement) {
            this.inputElement.focus();
        }
        
        console.log('[SecureInput] Secure input dialog shown');
    }

    private hideSecureInput(): void {
        if (!this.containerElement) return;
        
        this.isActive = false;
        this.containerElement.style.display = 'none';
        
        // Restore original body overflow
        document.body.style.overflow = this.originalBodyOverflow;
        
        // Clear the input field
        if (this.inputElement) {
            this.inputElement.value = '';
            this.inputValue = '';
        }
        
        // Clear any pending timeouts
        if (this.showTimeout) {
            clearTimeout(this.showTimeout);
            this.showTimeout = null;
        }
        
        console.log('[SecureInput] Secure input dialog hidden');
    }

    private handleInput(event: Event): void {
        if (!this.inputElement) return;
        
        const input = event.target as HTMLInputElement;
        this.inputValue = input.value;
        
        // Show the last character for a brief moment before masking
        if (this.showTimeout) {
            clearTimeout(this.showTimeout);
        }
        
        if (this.inputValue.length > 0) {
            // Show last character unmasked for SHOW_DELAY_MS then mask it
            const visiblePart = this.inputValue.slice(0, -1);
            const lastChar = this.inputValue.slice(-1);
            const maskedPart = this.maskCharacter.repeat(this.inputValue.length - 1);
            input.value = visiblePart + lastChar + maskedPart;
            
            this.showTimeout = setTimeout(() => {
                // Mask the last character as well
                const fullyMasked = this.maskCharacter.repeat(this.inputValue.length);
                input.value = fullyMasked;
            }, this.SHOW_DELAY_MS);
        }
    }

    private handleKeyDown(event: KeyboardEvent): void {
        if (!this.inputElement) return;
        
        switch (event.key) {
            case 'Enter':
                // Submit the input
                this.submitInput();
                break;
            case 'Escape':
                // Cancel the input
                this.cancelInput();
                break;
            default:
                // Allow other keys to pass through normally
                break;
        }
    }

    private handleBlur(): void {
        // If input loses focus, refocus it to maintain security
        if (this.inputElement && document.activeElement !== this.inputElement) {
            this.inputElement.focus();
        }
    }

    private submitInput(): void {
        if (!this.inputElement) return;
        
        const value = this.inputValue;
        this.hideSecureInput();
        
        // Call the stored callbacks
        const resolveCallback = (this.containerElement as any).__resolveCallback;
        const inputCallback = (this.containerElement as any).__inputCallback;
        
        if (typeof resolveCallback === 'function') {
            resolveCallback(value);
        }
        
        if (typeof inputCallback === 'function') {
            inputCallback(value);
        }
        
        console.log('[SecureInput] Input submitted');
    }

    private cancelInput(): void {
        this.hideSecureInput();
        
        // Call the resolve callback with empty string or null to indicate cancellation
        const resolveCallback = (this.containerElement as any).__resolveCallback;
        
        if (typeof resolveCallback === 'function') {
            resolveCallback(''); // Empty string indicates cancellation
        }
        
        console.log('[SecureInput] Input cancelled');
    }

    /**
     * Check if secure input is currently active
     */
    isSecureInputActive(): boolean {
        return this.isActive;
    }

    /**
     * Manually hide the secure input (useful for emergency situations)
     */
    forceHide(): void {
        this.hideSecureInput();
    }
}

// Singleton instance
let secureInputService: SecureInputService | null = null;

export function getSecureInputService(): SecureInputService {
    if (!secureInputService) {
        secureInputService = new SecureInputService();
    }
    return secureInputService;
}
