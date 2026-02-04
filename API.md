# DolfPower API Documentation

Complete API reference for DolfPower Antidetect Browser.

**Base URL:** `http://127.0.0.1:3001`

---

## Authentication

No authentication required for local API access.

---

## Profiles

### List All Profiles

```http
GET /v1.0/browser_profiles
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "profile_123",
      "name": "My Profile",
      "created_at": 1705000000000,
      "proxy_id": "proxy_456",
      "browser_type": "chrome",
      "os_type": "windows"
    }
  ]
}
```

### Create Profile

```http
POST /v1.0/browser_profiles/create
Content-Type: application/json

{
  "name": "My Profile",
  "template": "windows_chrome",
  "os_type": "windows",
  "os_version": "10",
  "proxy_id": "proxy_456",
  "fingerprint_config": {
    "canvas": {
      "mode": "noise",
      "noise": 0.05
    },
    "webgl": {
      "mode": "noise",
      "vendor": "Google Inc.",
      "renderer": "ANGLE (Intel HD Graphics)"
    },
    "screen": {
      "width": 1920,
      "height": 1080,
      "colorDepth": 24
    },
    "navigator": {
      "userAgent": "Mozilla/5.0...",
      "language": "en-US",
      "platform": "Win32",
      "hardwareConcurrency": 8,
      "deviceMemory": 8
    },
    "timezone": {
      "id": "America/New_York",
      "offset": -300
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "profile_789",
    "name": "My Profile"
  }
}
```

### Get Profile

```http
GET /v1.0/browser_profiles/:id
```

### Update Profile

```http
PUT /v1.0/browser_profiles/:id/update
Content-Type: application/json

{
  "name": "Updated Name",
  "proxy_id": "new_proxy_id"
}
```

### Delete Profile

```http
DELETE /v1.0/browser_profiles/:id/delete
```

### Start Profile

```http
GET /v1.0/browser_profiles/:id/start
```

**Query Parameters:**
- `automation=1` - Enable automation mode (returns WebSocket endpoint)
- `headless=1` - Start in headless mode

**Response:**
```json
{
  "success": true,
  "data": {
    "debug_port": 9222,
    "ws": {
      "puppeteer": "ws://127.0.0.1:9222/devtools/browser/..."
    }
  }
}
```

### Stop Profile

```http
GET /v1.0/browser_profiles/:id/stop
```

---

## Proxies

### List All Proxies

```http
GET /v1.0/proxies
```

### Create Proxy

```http
POST /v1.0/proxies
Content-Type: application/json

{
  "name": "US Proxy 1",
  "protocol": "http",
  "host": "192.168.1.1",
  "port": 8080,
  "username": "user",
  "password": "pass"
}
```

### Delete Proxy

```http
DELETE /v1.0/proxies/:id
```

### Test Proxy

```http
POST /v1.0/proxies/:id/test
```

**Response:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "latency": 250
  }
}
```

### Check Proxy IP

```http
POST /v1.0/proxies/:id/ip-check
```

**Response:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "info": {
      "ip": "203.0.113.50",
      "country": "United States",
      "countryCode": "US",
      "city": "New York",
      "region": "NY",
      "timezone": "America/New_York",
      "isp": "Example ISP"
    }
  }
}
```

### Get Proxies by Group

```http
GET /v1.0/proxies/group/:groupId
```

### Delete Proxy Group

```http
DELETE /v1.0/proxies/group/:groupId
```

### Fetch Free Proxies

```http
POST /v1.0/proxies/free/fetch
Content-Type: application/json

{
  "sources": ["geonode", "proxyscrape"],
  "groupId": "free-proxies",
  "testBeforeImport": true,
  "maxProxies": 20
}
```

**Available Sources:**
- `geonode` - GeoNode free proxy list (recommended)
- `proxyscrape` - ProxyScrape API
- `proxyscrape_http` - HTTP only
- `proxyscrape_socks4` - SOCKS4 only
- `proxyscrape_socks5` - SOCKS5 only

**Response:**
```json
{
  "success": true,
  "data": {
    "fetched": 100,
    "tested": 30,
    "working": 15,
    "imported": 15
  }
}
```

---

## Extensions

### List All Extensions

```http
GET /v1.0/extensions
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "ext_123",
      "name": "uBlock Origin",
      "path": "C:\\Extensions\\ublock",
      "is_default": 1,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

### Add Extension

```http
POST /v1.0/extensions
Content-Type: application/json

{
  "name": "uBlock Origin",
  "path": "C:\\Extensions\\ublock",
  "is_default": true
}
```

**Note:** Path can be:
- Local folder path: `C:\Extensions\ublock`
- Chrome Web Store extension ID: `cjpalhdlnbpafiamejdnhcphjbkeiagm`

### Delete Extension

```http
DELETE /v1.0/extensions/:id
```

---

## Bookmarks

### List All Bookmarks

```http
GET /v1.0/bookmarks
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "bm_123",
      "name": "Google",
      "url": "https://google.com",
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

### Add Bookmarks (Bulk)

```http
POST /v1.0/bookmarks/bulk
Content-Type: application/json

{
  "bookmarks": [
    { "name": "Google", "url": "https://google.com" },
    { "name": "Facebook", "url": "https://facebook.com" },
    { "name": "Twitter", "url": "https://twitter.com" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "added": 3
  }
}
```

### Delete Bookmark

```http
DELETE /v1.0/bookmarks/:id
```

---

## Fingerprint

### Generate Random Fingerprint

```http
GET /v1.0/fingerprint/generate
```

**Query Parameters:**
- `os` - Operating system (windows, macos, linux)
- `browser` - Browser type (chrome, firefox)

**Response:**
```json
{
  "success": true,
  "data": {
    "canvas": { "mode": "noise", "noise": 0.05 },
    "webgl": { "mode": "noise", "vendor": "...", "renderer": "..." },
    "audio": { "mode": "noise", "noise": 0.0001 },
    "screen": { "width": 1920, "height": 1080, "colorDepth": 24 },
    "navigator": {
      "userAgent": "Mozilla/5.0...",
      "language": "en-US",
      "languages": ["en-US", "en"],
      "platform": "Win32",
      "hardwareConcurrency": 8,
      "deviceMemory": 8
    },
    "timezone": { "id": "America/New_York", "offset": -300 },
    "fonts": ["Arial", "Helvetica", "Times New Roman"],
    "webrtc": { "mode": "altered" },
    "mediaDevices": { "audioInputs": 1, "videoInputs": 1, "audioOutputs": 1 }
  }
}
```

---

## Cookies

### Get Profile Cookies

```http
GET /v1.0/browser_profiles/:id/cookies
```

### Import Cookies

```http
POST /v1.0/browser_profiles/:id/cookies/import
Content-Type: application/json

{
  "cookies": [
    {
      "name": "session",
      "value": "abc123",
      "domain": ".example.com",
      "path": "/",
      "expires": 1735689600,
      "secure": true,
      "httpOnly": true
    }
  ]
}
```

### Export Cookies

```http
GET /v1.0/browser_profiles/:id/cookies/export
```

**Query Parameters:**
- `format` - Export format (json, netscape)

---

## Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:00:00Z",
  "running_profiles": 2,
  "version": "0.4.1",
  "features": {
    "profiles": true,
    "advanced_fingerprinting": true,
    "proxies": true,
    "cookies": true,
    "rpa": true,
    "templates": true,
    "extensions": true,
    "totp_2fa": true,
    "ip_checker": true,
    "groups": true,
    "free_proxies": true
  }
}
```

---

## Automation Examples

### Using with Puppeteer

```javascript
const puppeteer = require('puppeteer-core');

async function automateProfile(profileId) {
  // Start profile with automation
  const startRes = await fetch(
    `http://127.0.0.1:3001/v1.0/browser_profiles/${profileId}/start?automation=1`
  );
  const { data } = await startRes.json();

  // Connect Puppeteer
  const browser = await puppeteer.connect({
    browserWSEndpoint: data.ws.puppeteer
  });

  const page = await browser.newPage();
  await page.goto('https://example.com');
  
  // Do your automation...
  
  await browser.disconnect();
  
  // Stop profile
  await fetch(`http://127.0.0.1:3001/v1.0/browser_profiles/${profileId}/stop`);
}
```

### Using with Selenium

```python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import requests

def automate_profile(profile_id):
    # Start profile
    res = requests.get(
        f'http://127.0.0.1:3001/v1.0/browser_profiles/{profile_id}/start?automation=1'
    )
    data = res.json()['data']
    
    # Connect Selenium
    options = Options()
    options.debugger_address = f"127.0.0.1:{data['debug_port']}"
    
    driver = webdriver.Chrome(options=options)
    driver.get('https://example.com')
    
    # Do your automation...
    
    driver.quit()
    
    # Stop profile
    requests.get(f'http://127.0.0.1:3001/v1.0/browser_profiles/{profile_id}/stop')
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad request (invalid parameters)
- `404` - Resource not found
- `500` - Internal server error
