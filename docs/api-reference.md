# API Reference

DolfPower provides a comprehensive REST API running on `http://127.0.0.1:3001` (by default).

## Authentication & Security

### Initialize Auth
`POST /v1.0/auth/initialize`
Used to set the first master password.
**Body:** `{ "password": "..." }`

### Login
`POST /v1.0/auth/login`
Unlock the master key in memory.
**Body:** `{ "password": "..." }`

### Logout
`POST /v1.0/auth/logout`
Clears master key and security tokens.

## Profiles

### List Profiles
`GET /v1.0/browser_profiles`

### Create Profile
`POST /v1.0/browser_profiles/create`
**Body:**
```json
{
  "name": "My New Profile",
  "template": "windows_chrome",
  "proxy_id": "optional_id",
  "fingerprint_config": {
    "canvas": { "mode": "noise", "noise": 10 },
    "webgl": { "mode": "noise" }
  }
}
```

### Start Browser
`GET /v1.0/browser_profiles/:id/start`
**Query Params:**
- `headless=true`: Start without UI.
- `automation=true`: Return WebSocket endpoint for Puppeteer.

### Stop Browser
`GET /v1.0/browser_profiles/:id/stop`

## Migration

### Detect Browsers
`GET /v1.0/migration/detect`
Find supported antidetect browsers installed on the local system.

### List Profiles
`GET /v1.0/migration/list/:browser`
List profiles from a specific browser (e.g., `dolphin`, `adspower`).

### Migrate Profile
`POST /v1.0/migration/migrate`
Transfer a profile to DolfPower.
**Body:** `{ "profile": { "id": "...", "name": "...", "browser": "...", "path": "..." } }`

### Deep Scan
`POST /v1.0/migration/deep-scan`
Search for profiles in a custom directory.
**Body:** `{ "path": "C:\\Custom\\Path" }`

## Jarvis AI

### Chat with Jarvis
`POST /v1.0/jarvis/chat`
**Body:**
```json
{
  "message": "Start all my profiles in the 'Crypto' group",
  "session_id": "optional_session_uuid",
  "history": [],
  "attached_files": []
}
```

### Create Task (Scheduled/RPA)
`POST /v1.0/jarvis/tasks`
**Body:**
```json
{
  "name": "Daily Farm",
  "script_id": "rpa_scenario_id",
  "profile_ids": ["id1", "id2"],
  "repeat_interval": 1440,
  "cron_expression": "0 9 * * 1"
}
```

## Proxies

### Create Proxy
`POST /v1.0/proxies/create`

### Bulk Import
`POST /v1.0/proxies/bulk/import`
**Body:**
```json
{
  "proxies_text": "host:port:user:pass\nhost2:port2",
  "default_protocol": "socks5"
}
```

### Test Proxy
`POST /v1.0/proxies/:id/test`

## RPA Engine

### Create Scenario
`POST /v1.0/rpa/scenarios/create`
**Body:**
```json
{
  "name": "Login Gmail",
  "actions": [
    { "type": "navigate", "url": "https://gmail.com" },
    { "type": "type", "selector": "#identifierId", "text": "user@gmail.com" }
  ]
}
```

## System

### Health Check
`GET /health`

### Shutdown
`POST /system/shutdown`
Terminates all running Chromium instances.

---

*Note: For full JSON schemas and additional endpoints (Cookies, Extensions, Groups), please see the developer-oriented `API.md` in the repository root.*

