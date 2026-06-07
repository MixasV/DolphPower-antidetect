import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EncryptionService } from './encryption-service';

/**
 * Service for securely managing cryptocurrency wallet data (seed phrases, private keys, etc.)
 * Uses the existing EncryptionService to encrypt data stored in a file in the user's data directory.
 */
export class WalletSecurityService {
    private readonly vaultPath: string;

    constructor() {
        this.vaultPath = path.join(os.homedir(), '.antidetect', 'wallet_vault.enc');
    }

    /**
     * Store wallet data securely encrypted to file.
     * Requires that the encryption master key has been set (via user login).
     * @param walletData Object containing wallet information to secure
     * @throws Error if master key is not set
     */
    async storeWalletData(walletData: {
        seedPhrase?: string;
        privateKeys?: { [address: string]: string };
        walletNames?: { [address: string]: string };
        notes?: string;
    }): Promise<void> {
        if (!EncryptionService.isMasterKeySet()) {
            throw new Error('Master key not set. User must log in first to secure wallet data.');
        }

        try {
            const json = JSON.stringify(walletData);
            const encrypted = EncryptionService.encrypt(json);
            await fs.writeFile(this.vaultPath, encrypted, { encoding: 'utf8' });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to store wallet data: ${message}`);
        }
    }

    /**
     * Retrieve and decrypt wallet data from secure storage.
     * @returns Decrypted wallet data or null if no vault exists
     * @throws Error if master key is not set or decryption fails
     */
    async getWalletData(): Promise<{
        seedPhrase?: string;
        privateKeys?: { [address: string]: string };
        walletNames?: { [address: string]: string };
        notes?: string;
    } | null> {
        if (!EncryptionService.isMasterKeySet()) {
            throw new Error('Master key not set. User must log in first to access wallet data.');
        }

        try {
            const encrypted = await fs.readFile(this.vaultPath, { encoding: 'utf8' });
            const decrypted = EncryptionService.decrypt(encrypted);
            return JSON.parse(decrypted) as {
                seedPhrase?: string;
                privateKeys?: { [address: string]: string };
                walletNames?: { [address: string]: string };
                notes?: string;
            };
        } catch (error) {
            if (error.code === 'ENOENT') {
                // No vault file exists yet
                return null;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to retrieve wallet data: ${message}`);
        }
    }

    /**
     * Securely delete the wallet vault file.
     * Overwrites the file with random data before deletion to prevent recovery.
     */
    async wipeWalletData(): Promise<void> {
        try {
            // Check if file exists
            await fs.access(this.vaultPath);
            
            // Get file size for overwriting
            const stats = await fs.stat(this.vaultPath);
            const size = stats.size;
            
            // Overwrite with random data 3 times
            for (let i = 0; i < 3; i++) {
                const randomData = crypto.randomBytes(size);
                await fs.writeFile(this.vaultPath, randomData, { encoding: 'binary' });
            }
            
            // Finally delete the file
            await fs.unlink(this.vaultPath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to wipe wallet data: ${message}`);
            }
            // If file doesn't exist, consider it already wiped
        }
    }

    /**
     * Validate if a string looks like a valid seed phrase (12 or 24 words from BIP39 wordlist)
     * @param text Text to validate
     * @returns True if looks like a valid seed phrase format
     */
    isLikelySeedPhrase(text: string): boolean {
        if (!text || typeof text !== 'string') return false;
        
        const words = text.trim().split(/\s+/);
        // Must be exactly 12 or 24 words
        if (words.length !== 12 && words.length !== 24) return false;
        
        // All words should be lowercase alphabetic (BIP39 wordlist)
        return words.every(word => /^[a-z]+$/.test(word));
    }

    /**
     * Validate if a string looks like a valid Ethereum/Hex private key
     * @param text Text to validate
     * @returns True if looks like a valid private key
     */
    isLikelyPrivateKey(text: string): boolean {
        if (!text || typeof text !== 'string') return false;
        
        // Remove 0x prefix if present
        const clean = text.replace(/^0x/, '');
        // Should be 64 hex characters
        return /^[0-9a-fA-F]{64}$/.test(clean);
    }

    /**
     * Validate if a string looks like a valid wallet address
     * @param text Text to validate
     * @param type Type of address (ethereum, bitcoin, etc.)
     * @returns True if looks like a valid wallet address
     */
    isLikelyWalletAddress(text: string, type: 'ethereum' | 'bitcoin' = 'ethereum'): boolean {
        if (!text || typeof text !== 'string') return false;
        
        switch (type) {
            case 'ethereum':
                // Ethereum address: 0x followed by 40 hex characters
                return /^0x[0-9a-fA-F]{40}$/.test(text);
            case 'bitcoin':
                // Basic Bitcoin address validation (simplified)
                // Legacy: starts with 1 or 3
                // Bech32: starts with bc1
                return /^(1|3|bc1)[a-zA-Z0-9]{25,39}$/.test(text);
            default:
                return false;
        }
    }
}

// Singleton instance
let walletSecurityService: WalletSecurityService | null = null;

export function getWalletSecurityService(): WalletSecurityService {
    if (!walletSecurityService) {
        walletSecurityService = new WalletSecurityService();
    }
    return walletSecurityService;
}
