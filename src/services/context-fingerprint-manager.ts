import { FingerprintData } from '../database/schema';

/**
 * ContextFingerprintManager - Manages per-context fingerprint storage
 * Provides isolated fingerprint storage for each browser context (tab/window)
 * to prevent cross-context leakage and improve stealth.
 */
export class ContextFingerprintManager {
  // Store context-specific fingerprints: profileId -> contextId -> fingerprint
  private contextFingerprints: Map<string, Map<string, FingerprintData>> = new Map();
  
  // Store base fingerprints for each profile: profileId -> baseFingerprint
  private baseFingerprints: Map<string, FingerprintData> = new Map();

  /**
   * Generate a base fingerprint for a profile
   * @param profileId The profile identifier
   * @param baseFingerprint The base fingerprint data for the profile
   */
  setBaseFingerprint(profileId: string, baseFingerprint: FingerprintData): void {
    this.baseFingerprints.set(profileId, baseFingerprint);
    // Initialize context map for this profile
    if (!this.contextFingerprints.has(profileId)) {
      this.contextFingerprints.set(profileId, new Map());
    }
  }

  /**
   * Get the base fingerprint for a profile
   * @param profileId The profile identifier
   * @returns The base fingerprint or undefined if not set
   */
  getBaseFingerprint(profileId: string): FingerprintData | undefined {
    return this.baseFingerprints.get(profileId);
  }

  /**
   * Generate a context-specific fingerprint based on the base fingerprint
   * @param profileId The profile identifier
   * @param contextId Unique identifier for the browser context
   * @returns Context-specific fingerprint data
   */
  getContextFingerprint(profileId: string, contextId: string): FingerprintData {
    // Get base fingerprint for the profile
    const baseFingerprint = this.baseFingerprints.get(profileId);
    if (!baseFingerprint) {
      throw new Error(`No base fingerprint found for profile ${profileId}`);
    }

    // Get or create context map for this profile
    let contextMap = this.contextFingerprints.get(profileId);
    if (!contextMap) {
      contextMap = new Map<string, FingerprintData>();
      this.contextFingerprints.set(profileId, contextMap);
    }

    // Check if we already have a fingerprint for this context
    const existingFingerprint = contextMap.get(contextId);
    if (existingFingerprint) {
      return existingFingerprint;
    }

    // Generate a context-specific fingerprint by varying certain values
    const contextFingerprint = this.generateContextVariant(baseFingerprint, contextId);
    
    // Store the generated fingerprint for this context
    contextMap.set(contextId, contextFingerprint);
    
    return contextFingerprint;
  }

  /**
   * Remove a context's fingerprint when the context is closed
   * @param profileId The profile identifier
   * @param contextId Unique identifier for the browser context
   */
  removeContextFingerprint(profileId: string, contextId: string): void {
    const contextMap = this.contextFingerprints.get(profileId);
    if (contextMap) {
      contextMap.delete(contextId);
      // Clean up empty maps
      if (contextMap.size === 0) {
        this.contextFingerprints.delete(profileId);
        this.baseFingerprints.delete(profileId);
      }
    }
  }

  /**
   * Generate a variant of the base fingerprint for a specific context
   * @param baseFingerprint The base fingerprint data
   * @param contextId Unique identifier for the browser context
   * @returns Variant fingerprint data
   */
  private generateContextVariant(baseFingerprint: FingerprintData, contextId: string): FingerprintData {
    // Create a deep copy of the base fingerprint
    const fingerprint = JSON.parse(JSON.stringify(baseFingerprint)) as FingerprintData;
    
    // Create a deterministic seed based on contextId for reproducible variations
    let contextSeed = this.hashString(contextId);
     
    // Use a simple seeded random function for deterministic variations
    const seededRandom = () => {
      // Xorshift algorithm for simple seeded random
      let x = contextSeed;
      x ^= x << 13;
      x ^= x >> 17;
      x ^= x << 5;
      contextSeed = x;
      return (x & 0x7fffffff) / 0x7fffffff;
    };
    
    // Vary canvas noise slightly (±2)
    if (fingerprint.canvas && fingerprint.canvas.mode === 'noise') {
      const noiseVariation = Math.floor(seededRandom() * 5) - 2;
      fingerprint.canvas.noise = Math.max(1, Math.min(99, fingerprint.canvas.noise + noiseVariation));
    }
    
    // Vary audio noise slightly (±3)
    if (fingerprint.audio && fingerprint.audio.mode === 'noise') {
      const noiseVariation = Math.floor(seededRandom() * 7) - 3;
      fingerprint.audio.noise = Math.max(1, Math.min(99, fingerprint.audio.noise + noiseVariation));
    }
    
    // NOTE: Do NOT vary timezone or geolocation per-context
    // They should be consistent across all contexts for the same profile
    // to maintain proxy geo-consistency
    
    // NOTE: WebRTC IP should also be consistent across contexts
    // to avoid leaking real IP through context differences
    
    return fingerprint;
  }

  /**
   * Simple string hash function for generating deterministic seeds
   * @param str Input string
   * @returns 32-bit integer hash
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Clear all stored fingerprints (for testing or cleanup)
   */
  clearAll(): void {
    this.contextFingerprints.clear();
    this.baseFingerprints.clear();
  }

  /**
   * Get number of contexts for a profile (for debugging)
   * @param profileId The profile identifier
   * @returns Number of contexts or 0 if profile not found
   */
  getContextCount(profileId: string): number {
    const contextMap = this.contextFingerprints.get(profileId);
    return contextMap ? contextMap.size : 0;
  }
}