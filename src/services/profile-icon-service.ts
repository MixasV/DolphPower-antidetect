import * as fs from 'fs';
import * as path from 'path';

export class ProfileIconService {
    /**
     * Generates a custom PNG icon for a profile.
     * Uses a headless browser to render a canvas with a specific color and text.
     */
    static async generateIcon(
        profileName: string, 
        colorHue: number, 
        outputPath: string,
        chromiumPath: string
    ): Promise<boolean> {
        const puppeteer = require('puppeteer-core');
        let browser;
        try {
            browser = await puppeteer.launch({
                executablePath: chromiumPath,
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const page = await browser.newPage();
            
            // Short name for icon (2-3 chars)
            const shortName = profileName.substring(0, 2).toUpperCase();
            
            // HTML with Canvas to draw the icon
            const htmlContent = `
                <html>
                <body style="margin: 0; padding: 0; background: transparent;">
                    <canvas id="icon" width="128" height="128"></canvas>
                    <script>
                        const canvas = document.getElementById('icon');
                        const ctx = canvas.getContext('2d');
                        
                        // Background circle with tinted color
                        ctx.beginPath();
                        ctx.arc(64, 64, 60, 0, Math.PI * 2);
                        ctx.fillStyle = 'hsl(${colorHue}, 70%, 50%)';
                        ctx.fill();
                        ctx.strokeStyle = 'white';
                        ctx.lineWidth = 4;
                        ctx.stroke();
                        
                        // Text (Short Name)
                        ctx.fillStyle = 'white';
                        ctx.font = 'bold 60px Arial';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('${shortName}', 64, 64);
                    </script>
                </body>
                </html>
            `;

            await page.setContent(htmlContent);
            const canvasElement = await page.$('#icon');
            if (canvasElement) {
                await canvasElement.screenshot({ path: outputPath, omitBackground: true });
            }

            await browser.close();
            return true;
        } catch (error) {
            console.error('[ProfileIconService] Failed to generate icon:', error);
            if (browser) await browser.close();
            return false;
        }
    }

    /**
     * Gets a stable hue (0-360) based on the profile ID string
     */
    static getHueFromId(id: string): number {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        return Math.abs(hash % 360);
    }
}
