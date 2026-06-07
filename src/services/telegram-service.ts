import axios from 'axios';
import { EncryptionService } from './encryption-service';
import { JarvisConfig } from '../database/schema';

export class TelegramService {
    private token: string | null = null;
    private chatId: string | null = null;
    private whitelist: string[] = [];
    private notifySuccess: boolean = true;
    private notifyError: boolean = true;
    private notifySummary: boolean = true;
    private tgMode: string = 'notify';
    private isPolling: boolean = false;
    private lastUpdateId: number = 0;
    private onCommandHandler: ((message: string, chatId: string) => Promise<string>) | null = null;

    constructor(config?: JarvisConfig) {
        if (config) {
            this.updateConfig(config);
        }
    }

    updateConfig(config: JarvisConfig) {
        // Only attempt to decrypt if master key is set or fields are not encrypted
        // EncryptionService.decrypt handles the check internally now, but we should be cautious here
        if (!EncryptionService.isMasterKeySet()) {
            this.token = null;
            this.chatId = null;
            this.whitelist = [];
            this.stopPolling();
            return;
        }

        this.token = config.tg_token ? EncryptionService.decrypt(config.tg_token) : null;
        this.chatId = config.tg_chat_id ? EncryptionService.decrypt(config.tg_chat_id) : null;
        
        const wl = config.tg_whitelist ? EncryptionService.decrypt(config.tg_whitelist) : '';
        this.whitelist = wl ? wl.split(',').map(id => id.trim()).filter(id => id) : [];
        
        this.notifySuccess = config.tg_notify_success === 1;
        this.notifyError = config.tg_notify_error === 1;
        this.notifySummary = config.tg_notify_summary === 1;
        this.tgMode = config.tg_mode || 'notify';

        if (this.tgMode === 'full' && !this.isPolling && this.token) {
            this.startPolling();
        } else if (this.tgMode !== 'full' && this.isPolling) {
            this.stopPolling();
        }
    }

    setCommandHandler(handler: (message: string, chatId: string) => Promise<string>) {
        this.onCommandHandler = handler;
    }

    private async startPolling() {
        if (this.isPolling || !this.token) return;
        this.isPolling = true;
        console.log('[TelegramService] Starting long polling for commands...');

        while (this.isPolling) {
            try {
                const url = `https://api.telegram.org/bot${this.token}/getUpdates`;
                const response = await axios.get(url, {
                    params: {
                        offset: this.lastUpdateId + 1,
                        timeout: 30
                    }
                });

                if (response.data.ok && response.data.result.length > 0) {
                    for (const update of response.data.result) {
                        this.lastUpdateId = update.update_id;
                        if (update.message && update.message.text) {
                            await this.handleIncomingMessage(update.message);
                        }
                    }
                }
            } catch (error: any) {
                console.error('[TelegramService] Polling error:', error.message);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    private stopPolling() {
        this.isPolling = false;
        console.log('[TelegramService] Stopping long polling.');
    }

    private async handleIncomingMessage(message: any) {
        const senderId = message.from.id.toString();
        const text = message.text;
        const chatId = message.chat.id.toString();

        // Check whitelist if not empty
        if (this.whitelist.length > 0 && !this.whitelist.includes(senderId)) {
            console.warn(`[TelegramService] Unauthorized message from ${senderId}`);
            return;
        }

        if (this.onCommandHandler) {
            try {
                // Send "typing" action
                await axios.post(`https://api.telegram.org/bot${this.token}/sendChatAction`, {
                    chat_id: chatId,
                    action: 'typing'
                });

                const response = await this.onCommandHandler(text, chatId);
                await this.sendCustomMessage(chatId, response);
            } catch (error: any) {
                await this.sendCustomMessage(chatId, `❌ Error processing command: ${error.message}`);
            }
        }
    }

    private async sendCustomMessage(chatId: string, text: string) {
        if (!this.token) return;
        try {
            await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML'
            });
        } catch (error: any) {
            console.error('[TelegramService] Failed to send response message:', error.message);
        }
    }

    async sendMessage(message: string): Promise<boolean> {
        if (!this.token) return false;

        // If specific ChatID is set, send to it
        if (this.chatId) {
            // Check whitelist if destination ChatID is allowed
            if (this.whitelist.length > 0 && !this.whitelist.includes(this.chatId)) {
                console.warn(`[TelegramService] ChatID ${this.chatId} is not in the white-list.`);
                return false;
            }
            return this.sendToId(this.chatId, message);
        }

        // If no ChatID is set, broadcast to ALL whitelisted users
        if (this.whitelist.length > 0) {
            console.log(`[TelegramService] No ChatID set, broadcasting to ${this.whitelist.length} users in whitelist`);
            const results = await Promise.all(this.whitelist.map(id => this.sendToId(id, message)));
            return results.some(r => r);
        }

        return false;
    }

    private async sendToId(chatId: string, message: string): Promise<boolean> {
        try {
            const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
            await axios.post(url, {
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            });
            return true;
        } catch (error: any) {
            console.error(`[TelegramService] Failed to send message to ${chatId}:`, error.response?.data || error.message);
            return false;
        }
    }

    async notifyTaskStarted(taskName: string, profileCount: number, silent: boolean = false) {
        if (!this.notifySummary || silent) return;
        const message = `🚀 <b>Task Started</b>\n\n<b>Name:</b> ${taskName}\n<b>Profiles:</b> ${profileCount}\n<b>Time:</b> ${new Date().toLocaleString()}`;
        await this.sendMessage(message);
    }

    async notifyTaskCompleted(taskName: string, successCount: number, failCount: number, errors: string[], silent: boolean = false) {
        if (!this.notifySummary || silent) return;
        
        let message = `✅ <b>Task Completed</b>\n\n<b>Name:</b> ${taskName}\n<b>Success:</b> ${successCount}\n<b>Errors:</b> ${failCount}`;
        
        if (errors.length > 0 && this.notifyError) {
            message += `\n\n⚠️ <b>Latest Errors:</b>\n- ${errors.slice(0, 5).join('\n- ')}`;
        }
        
        await this.sendMessage(message);
    }

    async notifyProfileError(taskName: string, profileName: string, error: string, silent: boolean = false) {
        if (!this.notifyError || silent) return;
        const message = `❌ <b>Profile Error</b>\n\n<b>Task:</b> ${taskName}\n<b>Profile:</b> ${profileName}\n<b>Error:</b> <code>${error}</code>`;
        await this.sendMessage(message);
    }
}
