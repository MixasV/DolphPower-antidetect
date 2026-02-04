import * as path from 'path';

export class PathSanitizer {
    private static readonly ALLOWED_ROOT = path.resolve(process.cwd());

    /**
     * Ensures the path is within the allowed project directory and removes any traversal attempts.
     */
    static sanitize(unsafePath: string): string | null {
        if (!unsafePath) return null;

        try {
            // 1. Resolve to absolute path
            const resolvedPath = path.resolve(unsafePath);
            
            // 2. Check if it's within the project root
            if (!resolvedPath.startsWith(this.ALLOWED_ROOT)) {
                console.warn(`[Security] Blocked unauthorized path access: ${resolvedPath}`);
                return null;
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
