import * as path from 'path';
import * as os from 'os';

export class PathSanitizer {
    private static readonly ALLOWED_ROOT = path.resolve(process.cwd());
    private static readonly USER_HOME = os.homedir();
    
    /**
     * Ensures the path is safe (not a system folder) and returns absolute path.
     */
    static sanitize(unsafePath: string): string | null {
        if (!unsafePath) return null;

        try {
            // Normalize path for Windows/Linux
            const resolvedPath = path.resolve(unsafePath);
            const lowerPath = resolvedPath.toLowerCase();
            
            // Protected system directories (Windows-centric but includes generic ones)
            const protectedPrefixes = [
                'c:\\windows',
                'c:\\program files',
                'c:\\program files (x86)',
                'c:\\users\\all users',
                'c:\\users\\default',
                '\\etc',
                '\\bin',
                '\\sbin',
                '\\proc',
                '\\sys',
                '\\dev',
                '\\boot'
            ];

            // Allow everything EXCEPT protected system folders
            for (const prefix of protectedPrefixes) {
                if (lowerPath.startsWith(prefix)) {
                    // Special case: allow access to project root even if it's somehow inside a restricted dir (unlikely)
                    if (lowerPath.startsWith(this.ALLOWED_ROOT.toLowerCase())) return resolvedPath;
                    
                    console.warn(`[Security] Blocked access to system directory: ${resolvedPath}`);
                    return null;
                }
            }

            // Also check for sensitive patterns
            const sensitivePatterns = [
                '\\system32',
                '\\config\\reg',
                '.ssh\\',
                'id_rsa',
                '.bash_history',
                '.env',
                '\\appdata\\',
                '\\local settings\\',
                '\\cookies',
                '\\history',
                '\\login data'
            ];

            for (const pattern of sensitivePatterns) {
                if (lowerPath.includes(pattern)) {
                    console.warn(`[Security] Blocked access to sensitive file pattern: ${resolvedPath}`);
                    return null;
                }
            }

            return resolvedPath;
        } catch (e) {
            return null;
        }
    }

    /**
     * Sanitizes a filename for saving (e.g. screenshots)
     */
    static sanitizeFilename(filename: string): string {
        return filename.replace(/[^a-z0-9._-]/gi, '_').substring(0, 255);
    }

    static getProjectRoot(): string {
        return this.ALLOWED_ROOT;
    }
}
