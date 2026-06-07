# Security & Privacy

DolfPower is built on a "Zero Trust" local architecture. We believe your digital identities should be accessible only to you.

## Data Encryption

### Master Password
When you initialize DolfPower, you create a Master Password. 
- This password is used to derive a 256-bit AES key via PBKDF2 with 100,000 iterations.
- **Nothing is stored in plain text**: Proxy passwords, TOTP secrets, Jarvis API keys, and Cookies are all encrypted.
- The Master Key is stored only in **volatile memory (RAM)** and is cleared upon logout or application restart.

### Hardware-Locked Fallback
For initial setup and basic configurations, DolfPower uses a unique key derived from your machine's hardware ID (MAC address, CPU info, OS details). This ensures that even if your database file is stolen, it cannot be decrypted on a different machine without your Master Password.

## Multi-Factor Authentication (2FA)

DolfPower supports industry-standard TOTP (Google Authenticator, etc.) for two purposes:
1. **Application Access**: Secure your entire DolfPower dashboard.
2. **Profile-Specific 2FA**: Manage and generate codes for your social media or crypto accounts directly within the profile management UI.

## Telegram Sandbox

Our Telegram integration uses a "Sandbox" model:
- **PIN Confirmation**: Dangerous actions (delete, run script, update config) require a 6-digit PIN that Jarvis generates and sends to your chat.
- **Session Cleanup**: Logout clears all pending PINs and security tokens.

## Privacy Features

- **Isolated UserDataDirs**: Each profile has its own directory on your disk, making it impossible for Chromium instances to share cache or session data.
- **Fingerprint Randomization**: Every profile uses a unique `fingerprint_seed` to generate consistent but distinct hardware signatures.
- **No Cloud Sync**: By default, all your data stays on your machine. You are in control of your backups.

## Advanced Security Features

### Wallet Security Service
DolfPower provides specialized protection for cryptocurrency wallet data:
- **Encrypted Storage**: Seed phrases, private keys, and wallet metadata are encrypted using the master key derived from your Master Password
- **Local-Only Architecture**: All wallet data is stored exclusively on your local machine in an encrypted vault file
- **Secure Wipe Functionality**: Emergency wipe capability that overwrites the wallet vault with random data before deletion
- **Input Validation**: Built-in validation for seed phrases (BIP39 format), private keys, and wallet addresses to prevent accidental exposure of invalid data
- **Master Key Dependency**: Wallet operations require successful user login to access the encryption master key

### Clipboard Protection Service
Automatic protection against clipboard theft of sensitive data:
- **Pattern Recognition**: Detects potentially sensitive data including seed phrases (12/24 words), private keys, wallet addresses, API keys, and strong passwords
- **Delayed Clearing**: Automatically clears detected sensitive clipboard content after a configurable delay (default 10 seconds)
- **History Tracking**: Maintains a history of recent clipboard contents to avoid repeated checks on the same data
- **Manual Clear Option**: Provides immediate manual clearing capability for emergency situations

### Screen Protection Service
Mitigation against screen capture and recording of sensitive information:
- **Visibility Monitoring**: Detects when the application window is hidden or minimized, which may indicate screen capture attempts
- **Warning Overlays**: Displays semi-transparent warning overlays when potential screen capture is detected
- **Element-Level Protection**: Can protect specific DOM elements with visual indicators and position tracking
- **Best-Effort Approach**: Implements browser-based protection techniques while acknowledging OS-level limitations

### Emergency Lockout Service
Instant protection mechanisms for imminent threats:
- **One-Click Activation**: Immediately secures all sensitive data with a single action
- **Comprehensive Data Wiping**: 
  - Wipes encrypted wallet vault from storage
  - Clears clipboard contents immediately
  - Stops clipboard monitoring
  - Activates screen protection
  - Clears encryption master key from memory
- **Timed Lockout**: Automatic reset after configurable period (default 5 minutes) requiring user re-authentication
- **Manual Trigger**: Can be activated via panic button or key combination in the UI

### Secure Input Service
Protected entry of sensitive credentials to defeat keyloggers:
- **Secure Overlay**: Presents input field in a secure overlay that prevents access by other applications
- **Character Masking**: Shows entered characters briefly before masking them to prevent shoulder surfing
- **Focus Protection**: Prevents loss of focus to maintain input security
- **Escape Handling**: Allows cancellation with Escape key and submission with Enter
- **Memory Sanitization**: Clears input value immediately after submission

### Advanced Proxy Manager
Intelligent proxy management with health monitoring:
- **Performance Metrics**: Tracks success rate, latency, and reliability for each proxy
- **Intelligent Rotation**: Automatically selects the best proxy based on performance scoring
- **Health Monitoring**: Periodically tests all proxies and updates their metrics
- **Failure Detection**: Marks proxies as inactive after consecutive failures
- **Geographic Filtering**: Supports country-based proxy selection when geographic data is available
- **Free Proxy Integration**: Automatically fetches and tests proxies from public sources

### Captcha Solving Service
Automated solving of various captcha types with local API key storage:
- **Multiple Provider Support**: Compatible with 2captcha, Anti-Captcha, DeathByCaptcha, and ImgType services
- **Encrypted Credentials**: Stores API keys locally using the same encryption as other sensitive data
- **Multiple Captcha Types**: Handles image-based captchas, reCAPTCHA, hCaptcha, FunCaptcha, and Geetest
- **Local Configuration**: All settings stored locally on your machine with no external dependencies
- **Test Functionality**: Includes service testing capabilities to verify configuration

### Profile Versioning Service
Snapshot and rollback capabilities for browser profiles:
- **Version Snapshots**: Creates complete backups of profile and fingerprint configurations
- **Change Description**: Allows adding descriptive notes to each version for better tracking
- **File System Backup**: Optionally saves versions to local file system for additional redundancy
- **Database Storage**: Maintains version metadata in the local SQLite database
- **Selective Rollback**: Enables restoring profiles to any previous version state
- **Cleanup Options**: Provides version deletion to manage storage space

### Threat Monitoring Service
Proactive detection of local security threats:
- **Process Monitoring**: Scans for known malicious processes (keyloggers, stealers, RATs, etc.)
- **File System Integrity**: Checks monitored directories for suspicious files
- **Configurable Scanning**: Adjustable scan intervals and detection sensitivity
- **Automatic Response**: Can trigger emergency lockout automatically on high-threat detections
- **Local Analysis**: All threat detection performed locally without external reporting
- **Manual Configuration**: Adjustable sensitivity and monitored directories through configuration
