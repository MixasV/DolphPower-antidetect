/**
 * Example: Using AntiDetect Browser with Puppeteer
 * 
 * This example shows how to:
 * 1. Create a profile via API
 * 2. Start the browser
 * 3. Connect Puppeteer
 * 4. Perform automation
 */

const puppeteer = require('puppeteer-core');
const axios = require('axios');

const API_URL = 'http://127.0.0.1:3001';

async function main() {
    try {
        // 1. Create a new profile
        console.log('Creating profile...');
        const createResponse = await axios.post(`${API_URL}/v1.0/browser_profiles/create`, {
            name: 'Test Profile'
        });

        const profile = createResponse.data;
        console.log('Profile created:', profile.id);

        // 2. Start the browser
        console.log('Starting browser...');
        const startResponse = await axios.get(`${API_URL}/v1.0/browser_profiles/${profile.id}/start`);
        const { ws_endpoint, devtools_port } = startResponse.data;

        console.log('Browser started on port:', devtools_port);
        console.log('WebSocket endpoint:', ws_endpoint);

        // 3. Connect Puppeteer
        console.log('Connecting Puppeteer...');
        const browser = await puppeteer.connect({
            browserWSEndpoint: ws_endpoint,
            defaultViewport: null
        });

        // 4. Perform automation
        console.log('Opening page...');
        const page = await browser.newPage();

        // Navigate to test site
        await page.goto('https://bot.sannysoft.com', {
            waitUntil: 'networkidle2'
        });

        console.log('Page loaded!');

        // Take screenshot
        await page.screenshot({ path: 'test-screenshot.png' });
        console.log('Screenshot saved!');

        // Check if webdriver is detected
        const webdriverDetected = await page.evaluate(() => {
            return navigator.webdriver;
        });

        console.log('WebDriver detected:', webdriverDetected);

        // Get fingerprint info
        const fingerprintInfo = await page.evaluate(() => {
            return {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                languages: navigator.languages,
                hardwareConcurrency: navigator.hardwareConcurrency,
                deviceMemory: navigator.deviceMemory,
                vendor: navigator.vendor,
            };
        });

        console.log('Fingerprint info:', fingerprintInfo);

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Close browser
        await browser.disconnect();

        // 5. Stop the browser instance
        console.log('Stopping browser...');
        await axios.get(`${API_URL}/v1.0/browser_profiles/${profile.id}/stop`);

        console.log('Done!');

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    }
}

main();
