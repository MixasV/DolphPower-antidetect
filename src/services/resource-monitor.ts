import * as os from 'os';

export interface SystemResources {
    freeMem: number;
    totalMem: number;
    cpuCount: number;
    loadAvg: number[];
}

export class ResourceMonitor {
    /**
     * Get current system resource usage
     */
    static getResources(): SystemResources {
        return {
            freeMem: os.freemem(),
            totalMem: os.totalmem(),
            cpuCount: os.cpus().length,
            loadAvg: os.loadavg(),
        };
    }

    /**
     * Calculate how many browser profiles can be run in parallel without lag.
     * Estimated resources per profile: 
     * - RAM: ~500MB (headless) to ~800MB (headful)
     * - CPU: ~0.5 core 
     */
    static calculateOptimalConcurrency(isHeadless: boolean = true): number {
        const resources = this.getResources();
        
        // Convert to MB
        const freeRamMB = resources.freeMem / (1024 * 1024);
        const ramPerProfile = isHeadless ? 600 : 1000; // conservative estimates
        
        const maxByRam = Math.floor(freeRamMB / ramPerProfile);
        const maxByCpu = Math.floor(resources.cpuCount * 1.5); // Over-subscription allowed for browsers
        
        // Never return less than 1, and cap at a reasonable default if resources are huge
        let concurrency = Math.min(maxByRam, maxByCpu);
        
        if (concurrency < 1) concurrency = 1;
        if (concurrency > 50) concurrency = 50; // Safety cap
        
        return concurrency;
    }
}
