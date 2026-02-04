# 🧪 Automation Test - mixas.pro

Simple automation test for DolfPower that demonstrates browser control.

## What it does

1. ✅ Starts a browser profile
2. ✅ Opens https://mixas.pro
3. ✅ Clicks the Medium link button
4. ✅ Scrolls randomly for 10 seconds
5. ✅ Closes the profile

## Prerequisites

```bash
npm install puppeteer-core axios
```

## Usage

### Option 1: Use specific profile ID

```bash
node examples/test-mixas.js <profile-id>
```

### Option 2: Use first available profile

```bash
node examples/test-mixas.js
```

The script will automatically fetch the first profile from your database.

## Example Output

```
🚀 Starting automation test...
📋 Profile ID: abc123...

1️⃣ Starting profile...
✅ Profile started
   WebSocket: ws://127.0.0.1:9222/devtools/browser/...
   DevTools Port: 9222

2️⃣ Connecting to browser...
✅ Connected to browser

3️⃣ Navigating to mixas.pro...
✅ Page loaded

4️⃣ Looking for Medium link...
✅ Medium link clicked

5️⃣ Scrolling for 10 seconds...
✅ Scrolling completed

6️⃣ Disconnecting...
✅ Disconnected from browser

7️⃣ Stopping profile...
✅ Profile stopped

🎉 Test completed successfully!
```

## How it works

### 1. API Communication

```javascript
// Start profile
const response = await axios.get(
  `http://127.0.0.1:3001/v1.0/browser_profiles/${profileId}/start`
);

const { ws_endpoint } = response.data.data;
```

### 2. Browser Connection

```javascript
// Connect via WebSocket
const browser = await puppeteer.connect({
  browserWSEndpoint: ws_endpoint
});
```

### 3. Page Automation

```javascript
// Navigate
await page.goto('https://mixas.pro');

// Find and click link
await page.evaluate(() => {
  const links = Array.from(document.querySelectorAll('a'));
  const mediumLink = links.find(link => 
    link.href.includes('medium')
  );
  mediumLink.click();
});

// Random scrolling
await randomScroll(page, 10000);
```

### 4. Cleanup

```javascript
// Disconnect
await browser.disconnect();

// Stop profile
await axios.get(
  `http://127.0.0.1:3001/v1.0/browser_profiles/${profileId}/stop`
);
```

## Customization

### Change target URL

```javascript
await page.goto('https://your-site.com');
```

### Change scroll duration

```javascript
await randomScroll(page, 20000); // 20 seconds
```

### Add more actions

```javascript
// Type in input
await page.type('#search', 'hello');

// Click button
await page.click('.submit-button');

// Take screenshot
await page.screenshot({ path: 'screenshot.png' });

// Wait for element
await page.waitForSelector('.content');
```

## Troubleshooting

### Error: "Profile not found"

Make sure you have created at least one profile in DolfPower.

### Error: "Connection refused"

Make sure the DolfPower server is running:

```bash
npm run dev:server
```

### Error: "Cannot find module 'puppeteer-core'"

Install dependencies:

```bash
npm install puppeteer-core axios
```

## Advanced Usage

### Run multiple profiles in parallel

```javascript
const profileIds = ['id1', 'id2', 'id3'];

await Promise.all(
  profileIds.map(id => runTest(id))
);
```

### Use with different fingerprints

Each profile has its own unique fingerprint, so running the same script with different profiles will appear as different users!

## Next Steps

- Modify the script for your use case
- Add more complex automation logic
- Integrate with your scraping/testing workflow
- Use bulk profile creation for scale
