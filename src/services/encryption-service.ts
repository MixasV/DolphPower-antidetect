import * as crypto from 'crypto';
import os from 'os';

export class EncryptionService {
  private static readonly algorithm = 'aes-256-cbc';
  private static readonly keyLength = 32;
  private static readonly ivLength = 16;
  private static masterKey: Buffer | null = null;
  
  /**
   * Sets the master key derived from the user's password.
   * Allows decrypting data on different PCs.
   */
  static setMasterKey(password: string, salt: string) {
    this.masterKey = crypto.scryptSync(password, salt, this.keyLength);
  }

  static clearMasterKey() {
    this.masterKey = null;
  }

  static isMasterKeySet(): boolean {
    return this.masterKey !== null;
  }

  // Use a combination of OS data as a base for the local key (Hardware ID)
  static getHardwareId(): string {
    const interfaces = os.networkInterfaces();
    let mac = 'default-mac';
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
          mac = iface.mac;
          break;
        }
      }
      if (mac !== 'default-mac') break;
    }

    return crypto.createHash('sha256').update(os.hostname() + os.platform() + os.arch() + mac).digest('hex');
  }

  private static deriveHardwareKey(): Buffer {
    return crypto.scryptSync(this.getHardwareId(), 'dolf-salt-pepper', this.keyLength);
  }

  /**
   * Encrypts text using the master key (if set) or the hardware key.
   */
  static encrypt(text: string, useHardwareKey: boolean = false): string {
    if (!text) return '';
    const iv = crypto.randomBytes(this.ivLength);
    const key = (useHardwareKey || !this.masterKey) ? this.deriveHardwareKey() : this.masterKey;
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  static decrypt(text: string, useHardwareKey: boolean = false): string {
    try {
      if (!text || typeof text !== 'string') return '';
      const parts = text.split(':');
      if (parts.length < 2) return text; // Not encrypted or old format

      const iv = Buffer.from(parts.shift() || '', 'hex');
      const encryptedText = parts.join(':');
      
      // If master key is NOT set and we are not forced to use hardware key,
      // we can't decrypt data that was encrypted with master key.
      if (!this.masterKey && !useHardwareKey) {
        // Silently return empty or try hardware key if it might be encrypted with it
        return this.decrypt(text, true);
      }

      const key = (useHardwareKey || !this.masterKey) ? this.deriveHardwareKey() : this.masterKey;
      
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      // If decryption with master key fails, try hardware key as fallback
      if (!useHardwareKey && this.masterKey) {
        try {
          return this.decrypt(text, true);
        } catch (e2) {
          // Both failed
        }
      }
      
      // Log only if it's a real unexpected error, not just a wrong key during startup
      if (this.masterKey || useHardwareKey) {
        console.error('Decryption failed (Master Key set):', (e as Error).message);
      }
      return '';
    }
  }
}
