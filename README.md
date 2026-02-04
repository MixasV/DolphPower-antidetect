# DolfPower - Agentic AI Antidetect Browser

<p align="center">
  <img src="dolpfpower.jpg" alt="DolfPower Logo" width="200">
</p>

DolfPower is a next-generation, open-source antidetect browser designed for privacy, security, and seamless AI automation. Unlike traditional browsers, DolfPower integrates a powerful AI agent (Jarvis) to handle complex tasks, from profile management to humanized RPA execution.

## 🚀 The Power of AI Automation

DolfPower is built for the era of AI. It includes **Jarvis**, an agentic assistant that can:
- **Automate Everything**: Generate and execute RPA scripts from simple natural language descriptions.
- **Self-Healing Selectors**: If a web element changes, Jarvis analyzes the HTML and automatically "heals" the RPA script to continue execution.
- **Humanized Behavior**: Mouse movements use Bezier curves, and typing includes natural delays and "typo" simulations to mimic real human interaction perfectly.
- **Overlay Integration**: Interact with Jarvis directly inside the browser window via a persistent overlay.
- **MCP Tooling**: Extend Jarvis's capabilities with Model Context Protocol (MCP) to connect with external services.

## 🔒 Security First Architecture

We take security seriously. DolfPower implements a multi-layered defense strategy:
- **Master Password Protection**: All sensitive data (API keys, Proxy passwords, TOTP secrets, Cookies) is encrypted with AES-256 using a key derived from your master password.
- **Multi-Factor Authentication (2FA)**: Support for TOTP-based 2FA to protect your account and sensitive actions.
- **Hardware-Locked Encryption**: For initial setup or as a fallback, data is protected using a unique hardware-derived key.
- **Telegram Sandbox**: Manage your farm via Telegram with a secure sandbox that requires PIN confirmation for sensitive actions.
- **Automatic Cleanup**: Secure session termination that clears master keys from memory and resolves pending security actions.

## ✨ Key Features

- **40+ Fingerprint Parameters**: Full control over Canvas, WebGL, Audio, WebRTC, Media Devices, Fonts, and more.
- **Isolated Environments**: Every profile has its own storage, cookies, and fingerprint, ensuring zero cross-linking.
- **Advanced Proxy Management**: Support for HTTP/SOCKS5 with automatic IP/Timezone/Language sync.
- **Free Proxy Fetcher**: Built-in tools to grab and test free proxies from public sources.
- **Extension & Bookmark Management**: Global and profile-specific extensions/bookmarks.
- **Comprehensive API**: A full REST API allows integration with any external tool or custom AI agent.

## 🛠 Quick Start

### Installation
```bash
git clone https://github.com/MixasV/DolfPower.git
cd DolfPower
npm install
npm run build
npm run dev:server
```

### Accessing Jarvis
Launch the server and navigate to `http://127.0.0.1:3001/ui/`. You can set up your Master Password and start interacting with Jarvis immediately.

## 📚 Documentation
For detailed guides, API reference, and advanced automation tips, visit our [Documentation](docs/introduction.md).

## 📄 License
MIT License. Free to use, modify, and distribute.

---
Created by [Mixas](https://mixas.pro/)
- Telegram: [@onexv](http://onexv.t.me/)
- Twitter: [@MihailVarich](https://x.com/MihailVarich)
