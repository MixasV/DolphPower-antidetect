/**
 * Simple automation test for DolfPower
 * 
 * This script:
 * 1. Starts a profile
 * 2. Opens mixas.pro
 * 3. Clicks the Medium link button
 * 4. Scrolls for 10 seconds
 * 5. Closes the profile
 */

const axios = require('axios');
const puppeteer = require('puppeteer-core');

const API_URL = 'http://127.0.0.1:3001';

// Utility: Sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Utility: Random scroll with smooth animation
async function randomScroll(page, duration) {
    const endTime = Date.now() + duration;

    console.log('   Starting scroll animation...');
    let scrollCount = 0;

    while (Date.now() < endTime) {
        // Random scroll down (bigger distance for visibility)
        const scrollDown = Math.floor(Math.random() * 500) + 200;
        await page.evaluate((distance) => {
            window.scrollBy({
                top: distance,
                behavior: 'smooth'
            });
        }, scrollDown);

        scrollCount++;
        if (scrollCount % 3 === 0) {
            console.log(`   Scrolled ${scrollCount} times...`);
        }

        await sleep(800 + Math.random() * 400);

        // Random scroll up
        const scrollUp = Math.floor(Math.random() * 300) + 100;
        await page.evaluate((distance) => {
            window.scrollBy({
                top: -distance,
                behavior: 'smooth'
            });
        }, scrollUp);

        await sleep(800 + Math.random() * 400);
    }

    console.log(`   Total scrolls: ${scrollCount}`);
}

async function runTest(profileId) {
    console.log('🚀 Starting automation test...');
    console.log(`📋 Profile ID: ${profileId}`);

    let browser = null;

    try {
        // Step 1: Start profile
        console.log('\n1️⃣ Starting profile...');
        const startResponse = await axios.get(
            `${API_URL}/v1.0/browser_profiles/${profileId}/start`
        );

        const { devtools_port } = startResponse.data.data;
        console.log(`✅ Profile started`);
        console.log(`   DevTools Port: ${devtools_port}`);

        // Wait for browser to fully start
        await sleep(3000);

        // Step 2: Get correct WebSocket endpoint from Chrome DevTools
        console.log('\n2️⃣ Getting WebSocket endpoint...');
        let wsEndpoint;

        try {
            const versionResponse = await axios.get(`http://127.0.0.1:${devtools_port}/json/version`);
            wsEndpoint = versionResponse.data.webSocketDebuggerUrl;
            console.log(`✅ WebSocket: ${wsEndpoint}`);
        } catch (error) {
            console.error('❌ Failed to get WebSocket endpoint:', error.message);
            throw new Error('Could not connect to Chrome DevTools');
        }

        // Step 3: Connect to browser
        console.log('\n3️⃣ Connecting to browser...');
        browser = await puppeteer.connect({
            browserWSEndpoint: wsEndpoint,
            defaultViewport: null
        });
        console.log('✅ Connected to browser');

        // Step 4: Open new page
        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();

        // Step 5: Navigate to mixas.pro
        console.log('\n4️⃣ Navigating to mixas.pro...');
        await page.goto('https://mixas.pro', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        console.log('✅ Page loaded');

        // Wait a bit
        await sleep(2000);

        // Step 6: Find and click Medium link
        console.log('\n5️⃣ Looking for Medium link...');

        // Try to find the Medium link button
        const mediumLinkFound = await page.evaluate(() => {
            // Look for links containing "medium"
            const links = Array.from(document.querySelectorAll('a'));
            const mediumLink = links.find(link =>
                link.href.toLowerCase().includes('medium') ||
                link.textContent.toLowerCase().includes('medium')
            );

            if (mediumLink) {
                mediumLink.click();
                return true;
            }
            return false;
        });

        if (mediumLinkFound) {
            console.log('✅ Medium link clicked');
        } else {
            console.log('⚠️ Medium link not found, continuing anyway...');
        }

        // Wait for navigation if link was clicked
        await sleep(5000); // Wait longer for page to load

        // Step 7: Scroll for 10 seconds
        console.log('\n6️⃣ Scrolling for 10 seconds...');
        console.log('   (Watch the browser window to see scrolling)');
        await randomScroll(page, 10000);
        console.log('✅ Scrolling completed');

        // Step 8: Disconnect browser
        console.log('\n7️⃣ Disconnecting...');
        await browser.disconnect();
        console.log('✅ Disconnected from browser');

        // Step 9: Stop profile
        console.log('\n8️⃣ Stopping profile...');
        await axios.get(`${API_URL}/v1.0/browser_profiles/${profileId}/stop`);
        console.log('✅ Profile stopped');

        console.log('\n🎉 Test completed successfully!');

    } catch (error) {
        console.error('\n❌ Error during test:', error.message);

        // Try to cleanup
        if (browser) {
            try {
                await browser.disconnect();
            } catch (e) {
                // Ignore
            }
        }

        try {
            await axios.get(`${API_URL}/v1.0/browser_profiles/${profileId}/stop`);
        } catch (e) {
            // Ignore
        }

        throw error;
    }
}

// Main execution
async function main() {
    // Get profile ID from command line or use first available profile
    let profileId = process.argv[2];

    if (!profileId) {
        console.log('📋 No profile ID provided, fetching first available profile...');

        try {
            const response = await axios.get(`${API_URL}/v1.0/browser_profiles`);
            const profiles = response.data.data;

            if (profiles.length === 0) {
                console.error('❌ No profiles found. Please create a profile first.');
                process.exit(1);
            }

            profileId = profiles[0].id;
            console.log(`✅ Using profile: ${profiles[0].name} (${profileId})`);
        } catch (error) {
            console.error('❌ Failed to fetch profiles:', error.message);
            process.exit(1);
        }
    }

    await runTest(profileId);
}

// Run the test
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { runTest };
