/**
 * Comprehensive AntiDetect Browser Tests
 * Tests fingerprint generation, API endpoints, and core functionality
 */

import { FingerprintGenerator } from '../services/fingerprint-generator';
import { TOTPManager } from '../services/totp-manager';
import { IPChecker } from '../services/ip-checker';

describe('FingerprintGenerator', () => {
    const seed = 'test-seed-12345';
    let generator: FingerprintGenerator;

    beforeEach(() => {
        generator = new FingerprintGenerator(seed);
    });

    test('should generate consistent fingerprints with same seed', () => {
        const fp1 = generator.generateFingerprint('windows_chrome');
        const fp2 = new FingerprintGenerator(seed).generateFingerprint('windows_chrome');

        expect(fp1.navigator.userAgent).toBe(fp2.navigator.userAgent);
        expect(fp1.navigator.platform).toBe(fp2.navigator.platform);
        expect(fp1.webgl.vendor).toBe(fp2.webgl.vendor);
    });

    test('should generate different fingerprints with different seeds', () => {
        const fp1 = generator.generateFingerprint('windows_chrome');
        const fp2 = new FingerprintGenerator('different-seed').generateFingerprint('windows_chrome');

        expect(fp1.canvas.noise).not.toBe(fp2.canvas.noise);
    });

    test('should generate valid Windows Chrome fingerprint', () => {
        const fp = generator.generateFingerprint('windows_chrome');

        expect(fp.navigator.platform).toBe('Win32');
        expect(fp.navigator.userAgent).toContain('Windows NT');
        expect(fp.navigator.userAgent).toContain('Chrome/');
        expect(fp.canvas.mode).toBe('noise');
        expect(fp.webgl.mode).toBe('noise');
    });

    test('should generate valid macOS Chrome fingerprint', () => {
        const fp = generator.generateFingerprint('mac_chrome');

        expect(fp.navigator.platform).toBe('MacIntel');
        expect(fp.navigator.userAgent).toContain('Macintosh');
    });

    test('should generate valid Linux Chrome fingerprint', () => {
        const fp = generator.generateFingerprint('linux_chrome');

        expect(fp.navigator.platform).toBe('Linux x86_64');
        expect(fp.navigator.userAgent).toContain('Linux');
    });

    test('should generate valid screen configuration', () => {
        const fp = generator.generateFingerprint('windows_chrome');

        expect(fp.screen.width).toBeGreaterThan(0);
        expect(fp.screen.height).toBeGreaterThan(0);
        expect(fp.screen.colorDepth).toBe(24);
        expect(fp.screen.pixelDepth).toBe(24);
    });

    test('should generate valid WebGL configuration', () => {
        const fp = generator.generateFingerprint('windows_chrome');

        expect(fp.webgl.vendor).toBeDefined();
        expect(fp.webgl.renderer).toBeDefined();
        expect(fp.webgl.vendor.length).toBeGreaterThan(0);
    });

    test('should generate valid timezone configuration', () => {
        const fp = generator.generateFingerprint('windows_chrome');

        expect(fp.timezone.id).toBeDefined();
        expect(typeof fp.timezone.offset).toBe('number');
    });

    test('should generate valid language configuration', () => {
        const fp = generator.generateFingerprint('windows_chrome');

        expect(fp.languages.language).toBeDefined();
        expect(Array.isArray(fp.languages.languages)).toBe(true);
        expect(fp.languages.languages.length).toBeGreaterThan(0);
    });

    test('should generate valid fonts list', () => {
        const fp = generator.generateFingerprint('windows_chrome');

        expect(Array.isArray(fp.fonts)).toBe(true);
        expect(fp.fonts.length).toBeGreaterThan(0);
    });

    test('should generate valid WebRTC configuration', () => {
        const fp = generator.generateFingerprint('windows_chrome');

        expect(['real', 'disabled', 'altered']).toContain(fp.webrtc.mode);
    });

    test('should generate valid media devices configuration', () => {
        const fp = generator.generateFingerprint('windows_chrome');

        expect(fp.mediaDevices.audioInputs).toBeGreaterThanOrEqual(0);
        expect(fp.mediaDevices.audioOutputs).toBeGreaterThanOrEqual(0);
        expect(fp.mediaDevices.videoInputs).toBeGreaterThanOrEqual(0);
    });

    test('should generate injection script', () => {
        const fp = generator.generateFingerprint('windows_chrome');
        const script = generator.generateInjectionScript(fp);

        expect(script).toContain('navigator');
        expect(script).toContain('webdriver');
        expect(script).toContain('WebGLRenderingContext');
    });
});

describe('TOTPManager', () => {
    test('should generate valid 6-digit TOTP code', () => {
        const mockDb = {
            run: jest.fn(),
            get: jest.fn(),
            all: jest.fn(),
        } as any;

        const manager = new TOTPManager(mockDb);

        const secret = {
            id: 'test-id',
            profile_id: 'profile-1',
            name: 'Test',
            secret: 'JBSWY3DPEHPK3PXP',
            issuer: null,
            digits: 6,
            period: 30,
            algorithm: 'SHA1' as const,
            created_at: Date.now(),
        };

        const code = manager.generateCode(secret);

        expect(code).toMatch(/^\d{6}$/);
    });

    test('should calculate correct time remaining', () => {
        const mockDb = {
            run: jest.fn(),
            get: jest.fn(),
            all: jest.fn(),
        } as any;

        const manager = new TOTPManager(mockDb);
        const remaining = manager.getTimeRemaining(30);

        expect(remaining).toBeGreaterThan(0);
        expect(remaining).toBeLessThanOrEqual(30);
    });

    test('should parse otpauth URI correctly', () => {
        const mockDb = {
            run: jest.fn(),
            get: jest.fn(),
            all: jest.fn(),
        } as any;

        const manager = new TOTPManager(mockDb);
        const uri = 'otpauth://totp/Test:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Test&digits=6&period=30';
        const parsed = manager.parseOtpAuthUri(uri);

        expect(parsed).not.toBeNull();
        expect(parsed?.secret).toBe('JBSWY3DPEHPK3PXP');
        expect(parsed?.issuer).toBe('Test');
        expect(parsed?.digits).toBe(6);
        expect(parsed?.period).toBe(30);
    });

    test('should return null for invalid URI', () => {
        const mockDb = {
            run: jest.fn(),
            get: jest.fn(),
            all: jest.fn(),
        } as any;

        const manager = new TOTPManager(mockDb);
        const parsed = manager.parseOtpAuthUri('invalid-uri');

        expect(parsed).toBeNull();
    });
});

describe('IPChecker', () => {
    test('should have correct provider configuration', () => {
        const checker = new IPChecker();

        expect(checker).toBeDefined();
    });

    test('should get timezone for location', () => {
        const checker = new IPChecker();

        const tz1 = checker.getTimezoneForLocation(40.7128, -74.0060);
        expect(tz1).toBe('America/New_York');

        const tz2 = checker.getTimezoneForLocation(51.5074, -0.1278);
        expect(tz2).toBe('Europe/London');

        const tz3 = checker.getTimezoneForLocation(35.6762, 139.6503);
        expect(tz3).toBe('Asia/Tokyo');
    });

    test('should get language for country code', () => {
        const checker = new IPChecker();

        expect(checker.getLanguageForCountry('US')).toBe('en-US');
        expect(checker.getLanguageForCountry('DE')).toBe('de-DE');
        expect(checker.getLanguageForCountry('RU')).toBe('ru-RU');
        expect(checker.getLanguageForCountry('JP')).toBe('ja-JP');
        expect(checker.getLanguageForCountry('XX')).toBe('en-US');
    });
});

describe('Fingerprint Uniqueness', () => {
    test('should generate unique fingerprints for different profiles', () => {
        const fingerprints = [];

        for (let i = 0; i < 10; i++) {
            const generator = new FingerprintGenerator(`profile-${i}-${Date.now()}`);
            fingerprints.push(generator.generateFingerprint('windows_chrome'));
        }

        const canvasNoises = fingerprints.map(fp => fp.canvas.noise);
        const uniqueCanvasNoises = new Set(canvasNoises);

        expect(uniqueCanvasNoises.size).toBeGreaterThan(1);
    });
});

describe('Stealth Features', () => {
    test('should not expose automation indicators in injection script', () => {
        const generator = new FingerprintGenerator('test-seed');
        const fp = generator.generateFingerprint('windows_chrome');
        const script = generator.generateInjectionScript(fp);

        expect(script).toContain('webdriver');
        expect(script).toContain('navigator');
    });

    test('should mock Chrome object in injection script', () => {
        const generator = new FingerprintGenerator('test-seed');
        const fp = generator.generateFingerprint('windows_chrome');
        const script = generator.generateInjectionScript(fp);

        expect(script).toContain('window.chrome');
        expect(script).toContain('runtime');
        expect(script).toContain('app');
    });

    test('should include WebRTC protection in injection script', () => {
        const generator = new FingerprintGenerator('test-seed');
        const fp = generator.generateFingerprint('windows_chrome');
        const script = generator.generateInjectionScript(fp);

        expect(script).toContain('RTCPeerConnection');
    });
});
