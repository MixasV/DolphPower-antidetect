# Jarvis AI Assistant

**Jarvis** is the "brain" of DolfPower. It is an agentic AI assistant designed to simplify complex browser management and automation tasks.

## Capabilities

Jarvis is not just a chatbot; it has direct access to the DolfPower internal toolset:
- **Profile Management**: "Create 10 profiles for Facebook ads."
- **Proxy Configuration**: "Set the US proxy for my latest profile."
- **Browser Control**: "Start profile #5 and open Google."
- **Automation Execution**: "Run the login-scenario on all profiles in the 'Farming' group."

## Jarvis Overlay

DolfPower automatically injects an AI Overlay into your browser profiles (configurable). This allows you to:
- Chat with Jarvis while browsing.
- Ask Jarvis to analyze the page content.
- Request RPA generation based on what you see on the screen.

## Self-Healing RPA

One of Jarvis's most powerful features is **Self-Healing**. 
- If an RPA script fails because a website updated its layout, Jarvis captures the HTML context.
- It analyzes the context and suggests a corrected CSS selector.
- It automatically retries the action, ensuring your automation flows remain stable.

## Model Context Protocol (MCP)

Jarvis supports **MCP**, allowing you to extend its knowledge and capabilities. You can connect Jarvis to external servers to:
- Access local files.
- Interact with other APIs.
- Provide custom domain knowledge for specialized automation.

## Telegram Integration

Manage your browser farm from anywhere in the world. 
- **Full Control**: Send commands to Jarvis via your private Telegram bot.
- **Real-time Notifications**: Receive updates when tasks start, finish, or encounter errors.
- **Sandboxed Security**: High-risk actions (like deleting profiles or running new scripts) require a one-time PIN confirmation sent to your chat.
