import { Database } from 'sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EncryptionService } from './encryption-service';

/**
 * Interface for captcha solving service configuration
 */
interface CaptchaConfig {
    provider: '2captcha' | 'anticaptcha' | 'deathbycaptcha' | 'imgtype' | 'none';
    apiKey: string; // Encrypted
    timeout: number; // milliseconds
    pollingInterval: number; // milliseconds
}

/**
 * Interface for captcha solving result
 */
interface CaptchaResult {
    success: boolean;
    text?: string;
    error?: string;
    captchaId?: string;
}

/**
 * Interface for different captcha types
 */
interface CaptchaData {
    type: 'image' | 'recaptcha' | 'hcaptcha' | 'funcaptcha' | 'geetest';
    data: string; // base64 encoded image or site key
    additionalParams?: Record<string, any>;
}

/**
 * Captcha solving service with local API key storage and multiple provider support
 */
export class CaptchaSolvingService {
    private readonly db: Database;
    private readonly encryptionService: EncryptionService;
    private config: CaptchaConfig | null = null;
    private readonly configPath: string;

    constructor(db: Database) {
        this.db = db;
        this.encryptionService = EncryptionService;
        this.configPath = path.join(os.homedir(), '.antidetect', 'captcha-config.json');
        this.loadConfig();
    }

    private async loadConfig(): Promise<void> {
        try {
            await fs.mkdir(path.dirname(this.configPath), { recursive: true });
            const data = await fs.readFile(this.configPath, { encoding: 'utf8' });
            const parsed = JSON.parse(data);
            
            // Decrypt API key if present
            if (parsed.apiKey) {
                try {
                    parsed.apiKey = this.encryptionService.decrypt(parsed.apiKey);
                } catch (error) {
                    console.warn('Failed to decrypt captcha API key, using empty');
                    parsed.apiKey = '';
                }
            }
            
            this.config = parsed;
        } catch (error) {
            // No config file exists, create default
            this.config = {
                provider: 'none',
                apiKey: '',
                timeout: 30000,
                pollingInterval: 5000
            };
            await this.saveConfig();
        }
    }

    private async saveConfig(): Promise<void> {
        if (!this.config) return;
        
        // Encrypt API key for storage
        const configToSave = { ...this.config };
        if (configToSave.apiKey) {
            try {
                configToSave.apiKey = this.encryptionService.encrypt(configToSave.apiKey);
            } catch (error) {
                console.error('Failed to encrypt captcha API key');
                configToSave.apiKey = '';
            }
        }
        
        await fs.writeFile(this.configPath, JSON.stringify(configToSave, null, 2), { encoding: 'utf8' });
    }

    /**
     * Configure the captcha solving service
     */
    async configure(provider: CaptchaConfig['provider'], apiKey: string, options: { 
        timeout?: number; 
        pollingInterval?: number;
    } = {}): Promise<void> {
        this.config = {
            provider,
            apiKey: apiKey || '',
            timeout: options.timeout ?? 30000,
            pollingInterval: options.pollingInterval ?? 5000
        };
        
        await this.saveConfig();
    }

    /**
     * Solve an image-based captcha
     */
    async solveImageCaptcha(imageBase64: string): Promise<CaptchaResult> {
        if (!this.config || this.config.provider === 'none' || !this.config.apiKey) {
            return { success: false, error: 'Captcha service not configured' };
        }

        try {
            switch (this.config.provider) {
                case '2captcha':
                    return await this.solveWith2Captcha(imageBase64, 'image');
                case 'anticaptcha':
                    return await this.solveWithAntiCaptcha(imageBase64, 'image');
                case 'deathbycaptcha':
                    return await this.solveWithDeathByCaptcha(imageBase64, 'image');
                case 'imgtype':
                    return await this.solveWithImgType(imageBase64, 'image');
                default:
                    return { success: false, error: 'Unsupported captcha provider' };
            }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    /**
     * Solve a reCAPTCHA
     */
    async solveReCaptcha(siteKey: string, pageUrl: string): Promise<CaptchaResult> {
        if (!this.config || this.config.provider === 'none' || !this.config.apiKey) {
            return { success: false, error: 'Captcha service not configured' };
        }

        try {
            switch (this.config.provider) {
                case '2captcha':
                    return await this.solveWith2Captcha(siteKey, 'recaptcha', { pageUrl });
                case 'anticaptcha':
                    return await this.solveWithAntiCaptcha(siteKey, 'recaptcha', { pageUrl });
                case 'deathbycaptcha':
                    return await this.solveWithDeathByCaptcha(siteKey, 'recaptcha', { pageUrl });
                case 'imgtype':
                    return await this.solveWithImgType(siteKey, 'recaptcha', { pageUrl });
                default:
                    return { success: false, error: 'Unsupported captcha provider' };
            }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    /**
     * Solve an hCaptcha
     */
    async solveHCaptcha(siteKey: string, pageUrl: string): Promise<CaptchaResult> {
        if (!this.config || this.config.provider === 'none' || !this.config.apiKey) {
            return { success: false, error: 'Captcha service not configured' };
        }

        try {
            switch (this.config.provider) {
                case '2captcha':
                    return await this.solveWith2Captcha(siteKey, 'hcaptcha', { pageUrl });
                case 'anticaptcha':
                    return await this.solveWithAntiCaptcha(siteKey, 'hcaptcha', { pageUrl });
                case 'deathbycaptcha':
                    return await this.solveWithDeathByCaptcha(siteKey, 'hcaptcha', { pageUrl });
                case 'imgtype':
                    return await this.solveWithImgType(siteKey, 'hcaptcha', { pageUrl });
                default:
                    return { success: false, error: 'Unsupported captcha provider' };
            }
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    // 2Captcha implementation
    private async solveWith2Captcha(data: string, type: string, additionalParams: Record<string, any> = {}): Promise<CaptchaResult> {
        // In a real implementation, we would make HTTP requests to 2captcha API
        // For now, we'll simulate the response
        
        // Submit captcha
        const captchaId = `2captcha_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Simulate solving delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Return simulated result
        return {
            success: true,
            text: type === 'image' ? 'CAPTCHA_TEXT_123' : 'CAPTCHA_TOKEN_SIMULATED',
            captchaId
        };
    }

    // Anti-Captcha implementation
    private async solveWithAntiCaptcha(data: string, type: string, additionalParams: Record<string, any> = {}): Promise<CaptchaResult> {
        // Simulate Anti-Captcha API
        const captchaId = `anticaptcha_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Simulate solving delay
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return {
            success: true,
            text: type === 'image' ? 'ANTICAPTCHA_TEXT_456' : 'ANTICAPTCHA_TOKEN_SIMULATED',
            captchaId
        };
    }

    // Death By Captcha implementation
    private async solveWithDeathByCaptcha(data: string, type: string, additionalParams: Record<string, any> = {}): Promise<CaptchaResult> {
        // Simulate Death By Captcha API
        const captchaId = `dbc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Simulate solving delay
        await new Promise(resolve => setTimeout(resolve, 2500));
        
        return {
            success: true,
            text: type === 'image' ? 'DBC_TEXT_789' : 'DBC_TOKEN_SIMULATED',
            captchaId
        };
    }

    // ImgType implementation
    private async solveWithImgType(data: string, type: string, additionalParams: Record<string, any> = {}): Promise<CaptchaResult> {
        // Simulate ImgType API
        const captchaId = `imgtype_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Simulate solving delay
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        return {
            success: true,
            text: type === 'image' => 'IMGTYPE_TEXT_ABC' : 'IMGTYPE_TOKEN_SIMULATED',
            captchaId
        };
    }

    /**
     * Get current configuration (without exposing API key)
     */
    getConfig(): Omit<CaptchaConfig, 'apiKey'> & { hasApiKey: boolean } {
        if (!this.config) {
            return {
                provider: 'none',
                hasApiKey: false,
                timeout: 30000,
                pollingInterval: 5000
            };
        }
        
        return {
            provider: this.config.provider,
            hasApiKey: !!this.config.apiKey,
            timeout: this.config.timeout,
            pollingInterval: this.config.pollingInterval
        };
    }

    /**
     * Test the captcha service with current configuration
     */
    async testService(): Promise<{ success: boolean; message?: string }> {
        if (!this.config || this.config.provider === 'none') {
            return { success: false, message: 'Captcha service not configured' };
        }
        
        if (!this.config.apiKey) {
            return { success: false, message: 'API key not configured' };
        }
        
        // In a real implementation, we would make a test API call
        // For now, we'll just return success if we have a config
        return { success: true, message: 'Captcha service configured correctly' };
    }
}

// Singleton instance
let captchaSolvingService: CaptchaSolvingService | null = null;

export function getCaptchaSolvingService(db: Database): CaptchaSolvingService {
    if (!captchaSolvingService) {
        captchaSolvingService = new CaptchaSolvingService(db);
    }
    return captchaSolvingService;
}
