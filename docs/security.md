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
