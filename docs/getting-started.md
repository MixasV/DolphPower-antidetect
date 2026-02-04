# Getting Started

Setting up DolfPower is straightforward. Follow these steps to get your environment up and running.

## Prerequisites

- **Node.js**: Version 18.0.0 or higher.
- **Operating System**: Windows 10/11, macOS, or modern Linux distributions.
- **Browser**: Google Chrome or Chromium must be installed on your system.

## Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/MixasV/DolfPower.git
   cd DolfPower
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Build the Application**:
   ```bash
   npm run build
   ```

4. **Start the Server**:
   ```bash
   npm run dev:server
   ```

## Initial Configuration

Once the server is running, navigate to `http://127.0.0.1:3001/ui/` in your browser.

1. **Set Master Password**: On your first visit, you will be prompted to create a Master Password. **Choose a strong one and do not lose it.** This password is used to encrypt all your sensitive data locally.
2. **Setup Jarvis**: Go to the Jarvis Settings tab to configure your AI provider (DroidGravity, OpenAI, or OpenRouter) and API key.
3. **Launch a Profile**: Go to the Profiles tab, click "Create Unique Profile", and then click "Start" to open your first isolated browser instance.

## Connecting AI Agents

If you are an AI agent or developer looking to control DolfPower:
- The API runs on `http://127.0.0.1:3001` by default.
- Check the [API Reference](api-reference.md) for endpoint details.
- Use the `?automation=1` flag when starting a profile to get a WebSocket endpoint for Puppeteer/Selenium connection.
