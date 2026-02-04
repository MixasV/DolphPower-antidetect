
import { initializeDatabase } from './src/database/schema';
import { ProfileManager } from './src/services/profile-manager';
import { ChromiumManager } from './src/services/chromium-manager';
import * as path from 'path';
import * as fs from 'fs/promises';

const PIXELSCAN_URL = 'https://pixelscan.net/fingerprint-check';
const SCREENS_DIR = path.join(process.cwd(), '.screens');

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSingleVerification(profileManager: any, chromiumManager: any, name: string, template: string) {
    console.log(`\n>>> Verifying Profile: ${name} [Template: ${template}]`);
    
    // Create profile
    const profile = await profileManager.createProfile(name, {
        template: template
    });

    console.log(`- Created ID: ${profile.id}`);
    
    const fingerprint = await profileManager.getFingerprintConfig(profile.id);
    
    // Using Proxy 1 credentials provided in previous script for realistic check
    const launchOptions = {
        proxy: '109.176.204.163:51527',
        proxyAuth: { username: 'YXMCYB9C', password: 'YHFO8MP1' }
    };

    try {
        const processInfo = await chromiumManager.launchProfile(profile.id, profile.user_data_dir, launchOptions);
        console.log(`- Browser launched (Port: ${processInfo.devToolsPort})`);
        
        // Wait for proxy tunnel and initial page load
        await wait(10000);
        
        await chromiumManager.applyFingerprintViaCDP(profile.id, processInfo.devToolsPort, fingerprint, [PIXELSCAN_URL]);
        
        const CDP = require('chrome-remote-interface');
        let client = await CDP({ port: processInfo.devToolsPort });
        const { Runtime, Page, Log, Console } = client;

        await Runtime.enable();
        await Page.enable();
        await Log.enable();

        Runtime.consoleAPICalled((params: any) => {
            console.log(`[Browser Console ${params.type}]`, params.args.map((a: any) => a.value || a.description).join(' '));
        });

        Runtime.exceptionThrown((params: any) => {
            console.error(`[Browser Exception]`, params.exceptionDetails.exception.description);
        });

        // Wait loop for Pixelscan
        let result = null;
        const startTime = Date.now();
        const maxWait = 90000; // 90 seconds max per profile

        while (Date.now() - startTime < maxWait) {
            const evaluation = await Runtime.evaluate({
                expression: `
                    (function() {
                        const items = document.querySelectorAll('.check-item');
                        const results = {};
                        items.forEach(item => {
                            const name = item.querySelector('.check-name')?.innerText?.trim();
                            const statusText = item.querySelector('.check-status')?.innerText?.trim();
                            const isRed = item.querySelector('.text-red, .icon-error, .status-error') || 
                                         (statusText && (statusText.includes('Not') || statusText.includes('Fail')));
                            if (name) results[name] = isRed ? 'RED' : 'GREEN';
                        });
                        
                        const bodyText = document.body.innerText;
                        const isCollecting = bodyText.includes('Collecting Data') || 
                                           bodyText.includes('Checking your browser') ||
                                           items.length < 4;

                        return { waiting: isCollecting, results, itemsFound: items.length };
                    })()
                `,
                returnByValue: true
            });

            const val = evaluation.result.value;
            if (val && !val.waiting && Object.keys(val.results).length >= 4) {
                result = val.results;
                break;
            }
            if (val) {
                // Log progress
                process.stdout.write(`\r- Waiting for results... (Items: ${val.itemsFound}, Waiting: ${val.waiting}) `);
            }
            await wait(5000);
        }
        console.log(''); // newline after progress

        // Capture screenshot
        await fs.mkdir(SCREENS_DIR, { recursive: true });
        const screenshotPath = path.join(SCREENS_DIR, `verify_${template}_${Date.now()}.png`);
        const { data } = await Page.captureScreenshot();
        await fs.writeFile(screenshotPath, Buffer.from(data, 'base64'));
        console.log(`- Screenshot saved: ${screenshotPath}`);

        console.log(`- Verification Results:`, result || "TIMEOUT");
        
        await chromiumManager.terminateProfile(profile.id);
        return result;
    } catch (error: any) {
        console.error(`- Test failed: ${error.message}`);
        await chromiumManager.terminateProfile(profile.id).catch(() => {});
        return null;
    }
}

async function main() {
    const db = await initializeDatabase();
    const profileManager = new ProfileManager(db);
    const chromiumManager = new ChromiumManager(db);

    const configs = [
        { name: 'Verify_Windows', temp: 'windows_chrome' },
        { name: 'Verify_Mac', temp: 'mac_chrome' },
        { name: 'Verify_Linux', temp: 'linux_chrome' },
        { name: 'Verify_Win_2', temp: 'windows_chrome' },
        { name: 'Verify_Mac_2', temp: 'mac_chrome' }
    ];

    const finalResults = [];
    for (const config of configs) {
        const res = await runSingleVerification(profileManager, chromiumManager, config.name, config.temp);
        finalResults.push({ name: config.name, results: res });
    }

    console.log('\n=======================================');
    console.log('FINAL VERIFICATION SUMMARY');
    console.log('=======================================');
    finalResults.forEach(r => {
        console.log(`${r.name}: ${r.results ? JSON.stringify(r.results) : 'FAILED'}`);
    });
}

main().catch(console.error);
