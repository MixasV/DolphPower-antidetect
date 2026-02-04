import axios from 'axios';
import { EncryptionService } from './encryption-service';
import { JarvisConfig, JarvisSession } from '../database/schema';
import { MCPManager } from './mcp-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

export class JarvisService {
  private config: JarvisConfig | null = null;
  private baseUrl: string = 'http://127.0.0.1:8045';
  private mcpManager: MCPManager = new MCPManager();

  constructor(config?: JarvisConfig) {
    if (config) {
      this.config = config;
      this.baseUrl = config.api_url || 'http://127.0.0.1:8045';
      this.updateMCPConfig(config.mcp_servers);
    }
  }

  async setConfig(config: JarvisConfig) {
    this.config = config;
    this.baseUrl = config.api_url;
    this.updateMCPConfig(config.mcp_servers);
  }

  private updateMCPConfig(mcpServersJson?: string) {
    try {
      const servers = mcpServersJson ? JSON.parse(mcpServersJson) : [];
      this.mcpManager.setServers(servers);
    } catch (e) {
      console.error('[JarvisService] Failed to parse MCP servers:', e);
    }
  }

  getMCPManager() {
    return this.mcpManager;
  }

  private async getSystemReminder(): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const osInfo = `${process.platform} ${process.arch}`;
    const permission = this.config?.permission_level || 'standard';
    
    return `<system-reminder>

User system info (${osInfo})
Model: ${this.config?.model_name || 'gemini-3-flash'}
Today's date: ${today}
Current Permission Level: ${permission}

# DolfPower Context
# This is an AntiDetect Browser management assistant.
# You have access to tools for profiles, proxies, and RPA.

</system-reminder>`;
  }

  private async getSystemPrompt(): Promise<string> {
    const mcpTools = await this.mcpManager.getAllTools();
    const mcpDescription = mcpTools.length > 0 
      ? `\nAvailable MCP Tools (Provided by external servers):\n${mcpTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}\nYou can call these tools the same way as internal tools.`
      : '';

    const basePrompt = `You are Jarvis, a powerful agentic AI automation assistant for DolfPower AntiDetect Browser.
You can manage the entire browser system, including profiles, proxies, and automation scripts.

Permission Rules:
1. 'readonly': You can only list and view data. Do NOT suggest or attempt any changes.
2. 'standard': You can create and update profiles/scripts, but cannot delete them.
3. 'admin': Full control, including deletion.

Tools & Commands:
If you need to perform a system action, respond with a JSON object in your message using this format:
{
  "action": "callTool",
  "tool": "toolName",
  "args": { "param": "value" }
}

Available Tools:
- listProfiles: {} -> Returns list of all profiles.
- getProfile: { id: "string" } -> Returns detailed profile config.
- createProfile: { name: "string", options: { fingerprintConfig?: object } } -> Creates a new profile with optional detailed fingerprint settings.
- bulkCreateProfiles: { count: number, namePrefix: "string", options: { fingerprintConfig?: object } } -> Creates multiple profiles.
- updateProfile: { id: "string", updates: { name?: "string", options?: {}, fingerprintConfig?: object } } -> Updates an existing profile and its fingerprint.
- deleteProfile: { id: "string" } -> Deletes a profile.
- startProfile: { id: "string" } -> Starts a browser profile.
- stopProfile: { id: "string" } -> Stops a browser profile.
- listProxies: {} -> Returns list of all proxies.
- createProxy: { name: "string", protocol: "http|https|socks5", host: "string", port: number, username?: "string", password?: "string" } -> Creates a new proxy.
- deleteProxy: { id: "string" } -> Deletes a proxy.
- listGroups: {} -> Returns list of profile groups.
- runRpa: { scenarioId: "string", profileId?: "string", profileIds?: string[], taskName?: "string", scheduledAt?: number, repeatInterval?: number } -> Starts a scenario on one or many profiles. Supports scheduling and periodic repetition (interval in minutes).
- installExtension: { extensionId: "string", profileId?: "string", profileIds?: string[] } -> Installs extension to one or many profiles.
- startRecording: { profileId: "string" } -> Starts/Resumes action recording on a profile.
- stopRecording: {} -> Stops current recording and returns analyzed steps.
- updateConfig: { tgToken?: string, tgChatId?: string, tgNotifySuccess?: boolean, tgNotifyError?: boolean, tgNotifySummary?: boolean } -> Updates Jarvis system configuration, including Telegram settings.
${mcpDescription}

Telegram Notifications:
You can help user configure Telegram notifications. If they provide a token or chat ID, you can use updateConfig logic (via user instructions) or just explain how to set it in settings. You are aware that the system can send real-time notifications about task start, errors, and summary results to a Telegram bot. All TG data and task logs are encrypted in the database.

Guidelines:
- If a tool call fails due to permissions, explain this to the user.
- For dangerous actions (like delete) in 'standard' mode, ask for confirmation first.
- When generating RPA scripts, use the JSON array format.
- Support for external files: {{FILE:C:\\path\\to\\file.txt|line:INDEX}}
- Humanized behavior is applied automatically.

IMPORTANT RULES:
1. TIMEZONE: You are STRICTLY FORBIDDEN from managing or setting the timezone. DolfPower handles this automatically based on the proxy or real IP. Never include "timezone" in fingerprintConfig.
2. ABSOLUTE PATHS: Always use absolute paths for any file operations.
3. FINGERPRINTS: You can "turn the knobs" of any other fingerprint settings like Canvas mode, WebGL renderer, Hardware Concurrency, etc., to make profiles more unique.
`;

    if (this.config?.system_prompt) {
      return `${basePrompt}\n\nAdditional User Instructions:\n${this.config.system_prompt}`;
    }
    
    return basePrompt;
  }

  async askJarvis(query: string, history: any[] = [], attachedFiles: string[] = [], pageContext?: { url: string, title: string, html?: string }, source: 'ui' | 'telegram' = 'ui'): Promise<string> {
    try {
      const systemReminder = await this.getSystemReminder();
      let systemPrompt = await this.getSystemPrompt();

      // Security: File access restriction for Telegram
      if (source === 'telegram') {
        systemPrompt += `\n\n[SECURITY RESTRICTION] You are currently operating via Telegram. 
File access tools and the {{FILE:...}} syntax are STRICTLY DISABLED for this channel. 
Do NOT attempt to read local files or provide their content. 
If user asks for file data, explain that this requires direct access via the browser UI for safety.`;
      } else {
        // Add information about attached files to the context (UI only)
        if (attachedFiles && attachedFiles.length > 0) {
          systemPrompt += `\n\nAttached Files Available for this Session:
${attachedFiles.map((f, i) => `${i + 1}. ${f}`).join('\n')}
You can use these files in RPA scripts using {{FILE:path|line:INDEX}} syntax.`;
        }
      }

      // Add page context if provided (from Overlay)
      if (pageContext) {
        systemPrompt += `\n\nCurrent Browser Context:
URL: ${pageContext.url}
Title: ${pageContext.title}
${pageContext.html ? `HTML Context (Simplified): \n${pageContext.html}` : ''}
The user is currently interacting with you via an overlay on this page. You can refer to elements or content on this page.`;
      }
      
      const apiKey = this.config?.api_key ? EncryptionService.decrypt(this.config.api_key) : '';
      const provider = this.config?.provider || 'droidgravity';
      
      let messages: any[] = [];
      let apiUrl = this.baseUrl;

      if (provider === 'droidgravity') {
        // Strict format for DroidGravity
        messages = [
          {
            role: 'user',
            content: [
              { type: 'text', text: systemReminder },
              { type: 'text', text: systemPrompt },
              ...history.map(msg => ({ 
                type: 'text', 
                text: `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}` 
              })),
              { type: 'text', text: query }
            ]
          }
        ];
        // DroidGravity uses /v1/chat/completions
        if (!apiUrl || apiUrl === '') apiUrl = 'http://127.0.0.1:8045';
        if (!apiUrl.endsWith('/v1')) {
          apiUrl = apiUrl.replace(/\/$/, '') + '/v1';
        }
      } else {
        // Standard format for OpenAI/OpenRouter - BYPASS DroidManager
        messages = [
          { role: 'system', content: `${systemPrompt}\n\n${systemReminder}` },
          ...history.map(msg => ({ role: msg.role, content: msg.content })),
          { role: 'user', content: query }
        ];

        if (provider === 'openai' && (!apiUrl || apiUrl === '')) {
          apiUrl = 'https://api.openai.com/v1';
        } else if (provider === 'openrouter' && (!apiUrl || apiUrl === '')) {
          apiUrl = 'https://openrouter.ai/api/v1';
        }
      }

      const response = await axios.post(`${apiUrl}/chat/completions`, {
        model: this.config?.model_name || (provider === 'droidgravity' ? 'gemini-3-flash' : 'gpt-4o'),
        messages: messages,
        temperature: 0.3
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://dolfpower.com', 'X-Title': 'DolfPower' } : {})
        }
      });

      return response.data.choices[0].message.content;
    } catch (error: any) {
      console.error('Error calling Jarvis:', error.message);
      throw new Error(`Jarvis connection failed: ${error.message}`);
    }
  }

  /**
   * Cleans up recorded raw logs into human-readable steps
   */
  async humanizeLogs(rawLogs: string): Promise<string> {
    const prompt = `Convert the following raw browser event logs into a clean, human-readable list of steps.
Remove noise like unnecessary scrolls or duplicate clicks.
Output format:
1. [Action] Description
2. [Action] Description

Raw Logs:
${rawLogs}`;

    return this.askJarvis(prompt);
  }

  /**
   * Generates a working RPA script from a human-readable description
   */
  async generateRPAScript(description: string): Promise<any> {
    const prompt = `Generate a DolfPower RPA JSON script based on this description:
"${description}"

Example format:
[
  {"type": "navigation", "url": "https://google.com"},
  {"type": "click", "selector": "#search-btn"},
  {"type": "type", "selector": "input[name='q']", "text": "Hello World"}
]

Respond ONLY with the JSON array.`;

    const response = await this.askJarvis(prompt);
    try {
      // Extract JSON if AI wrapped it in markdown
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      return JSON.parse(jsonMatch ? jsonMatch[0] : response);
    } catch (e) {
      console.error('Failed to parse Jarvis RPA script:', e);
      return null;
    }
  }

  /**
   * Heals a failed selector by analyzing the HTML context
   */
  async healSelector(failedSelector: string, htmlContext: string, actionType: string): Promise<string | null> {
    const prompt = `The RPA action "${actionType}" failed for selector "${failedSelector}".
I have captured the relevant HTML context around the intended element.
Please analyze the HTML and provide the corrected CSS selector to perform the same action.

HTML Context:
${htmlContext}

Respond ONLY with the corrected CSS selector string. If you cannot find a suitable element, respond with "FAILED".`;

    const response = await this.askJarvis(prompt);
    const cleaned = response.trim().replace(/^`+|`+$/g, '');
    return cleaned === 'FAILED' ? null : cleaned;
  }
}
