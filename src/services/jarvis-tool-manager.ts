import { Database } from 'sqlite3';
import { ProfileManager } from './profile-manager';
import { ProxyManager } from './proxy-manager';
import { ChromiumManager } from './chromium-manager';
import { RPAEngine } from './rpa-engine';
import { JarvisTaskManager } from './jarvis-task-manager';
import { ExtensionManager } from './extension-manager';
import { JarvisConfig } from '../database/schema';
import { JarvisController } from './jarvis-controller';
import { EncryptionService } from './encryption-service';
import { MCPManager } from './mcp-manager';
import { PathSanitizer } from './path-sanitizer';

export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
    requiresConfirmation?: boolean;
}

export class JarvisToolManager {
    constructor(
        private db: Database,
        private config: JarvisConfig,
        private profileManager: ProfileManager,
        private proxyManager: ProxyManager,
        private chromiumManager: ChromiumManager,
        private rpaEngine: RPAEngine,
        private taskManager: JarvisTaskManager,
        private extensionManager: ExtensionManager,
        private jarvisController: JarvisController,
        private mcpManager?: MCPManager
    ) {}

    async executeTool(toolName: string, args: any, source: 'ui' | 'telegram' = 'ui', sessionId?: string): Promise<ToolResult> {
        const permission = this.config.permission_level || 'standard';
        const isConfirmed = args.confirmed === true;

        // Security: Telegram Sandbox
        if (source === 'telegram') {
            const safeTools = this.config.tg_safe_tools ? JSON.parse(this.config.tg_safe_tools) : ['listProfiles', 'listProxies', 'getProfile', 'startProfile', 'stopProfile', 'listGroups', 'stopAll', 'stopAllTasks'];
            if (!safeTools.includes(toolName)) {
                return { success: false, error: `Tool '${toolName}' is not allowed via Telegram for security reasons.` };
            }

            // Always require confirmation for "active" tools via Telegram if configured
            if (this.config.tg_requires_2fa === 1 && toolName.match(/start|stop|run|create|update/i) && !isConfirmed) {
                return { 
                    success: false, 
                    error: `Action '${toolName}' requires manual confirmation in the browser or via 2FA.`,
                    requiresConfirmation: true 
                };
            }
        }

        // Check permissions for write/delete actions
        if (permission === 'readonly' && toolName.match(/create|delete|update|start|stop|run/i)) {
            return { success: false, error: 'Permission denied: Jarvis is in Read-Only mode.' };
        }

        // Deletion protection for standard users
        if (permission === 'standard' && toolName.match(/delete/i) && !isConfirmed) {
            return { 
                success: false, 
                error: 'Warning: This action will delete data. Please confirm to proceed.',
                requiresConfirmation: true 
            };
        }

        try {
            switch (toolName) {
                case 'listProfiles':
                    const profiles = await this.profileManager.listProfiles();
                    return { success: true, data: profiles };

                case 'getProfile':
                    const profile = await this.profileManager.getProfileWithFingerprint(args.id);
                    return { success: true, data: profile };

                case 'startProfile':
                    const pData = await this.profileManager.getProfileWithFingerprint(args.id);
                    if (!pData) return { success: false, error: 'Profile not found' };
                    
                    const launchOptions: any = {};
                    if (pData.profile.proxy_id) {
                        const proxy = await this.proxyManager.getProxy(pData.profile.proxy_id);
                        if (proxy) {
                            launchOptions.proxy = `${proxy.host}:${proxy.port}`;
                            if (proxy.username) {
                                launchOptions.proxyAuth = {
                                    username: proxy.username,
                                    password: proxy.password
                                };
                            }
                        }
                    }

                    await this.chromiumManager.launchProfile(pData.profile.id, pData.profile.user_data_dir, launchOptions);
                    
                    // Apply fingerprint after launch
                    const port = this.chromiumManager.getDevToolsPort(pData.profile.id);
                    if (port) {
                        await this.chromiumManager.applyFingerprintViaCDP(pData.profile.id, port, pData.fingerprint);
                    }
                    
                    return { success: true, data: { action: 'start', id: args.id } };

                case 'stopProfile':
                    await this.chromiumManager.terminateProfile(args.id);
                    return { success: true, data: { action: 'stop', id: args.id } };

                case 'listProxies':
                    const proxies = await this.proxyManager.listProxies();
                    return { success: true, data: proxies };

                case 'createProxy':
                    const proxy = await this.proxyManager.createProxy(args.name, args.protocol, args.host, args.port, args.username, args.password);
                    return { success: true, data: proxy };

                case 'deleteProxy':
                    if (permission === 'readonly') return { success: false, error: 'Permission denied.' };
                    if (permission === 'standard' && !isConfirmed) {
                        return { success: false, error: 'Action requires confirmation.', requiresConfirmation: true };
                    }
                    await this.proxyManager.deleteProxy(args.id);
                    return { success: true, data: { deleted: args.id } };

                case 'createProfile':
                    const newProfile = await this.profileManager.createProfile(args.name, args.options || {});
                    return { success: true, data: newProfile };

                case 'updateProfile':
                    if (!args.id) return { success: false, error: 'profile id is required' };
                    if (args.updates) {
                        await this.profileManager.updateProfile(args.id, args.updates);
                    }
                    if (args.fingerprintConfig) {
                        await this.profileManager.updateFingerprintConfig(args.id, args.fingerprintConfig);
                    }
                    return { success: true, data: { updated: args.id } };

                case 'bulkCreateProfiles':
                    if (!args.count || args.count < 1) return { success: false, error: 'count must be at least 1' };
                    const bulkResult = await this.profileManager.bulkCreateProfiles(args.count, {
                        namePrefix: args.namePrefix || 'Jarvis Profile',
                        ...args.options
                    });
                    return { success: true, data: bulkResult };

                case 'deleteProfile':
                    if (permission === 'readonly') return { success: false, error: 'Permission denied.' };
                    if (permission === 'standard' && !isConfirmed) {
                        return { success: false, error: 'Action requires confirmation.', requiresConfirmation: true };
                    }
                    await this.profileManager.deleteProfile(args.id);
                    return { success: true, data: { deleted: args.id } };

                case 'listGroups':
                    const groups = await new Promise((res, rej) => {
                        this.db.all('SELECT * FROM profile_groups', (err, rows) => err ? rej(err) : res(rows));
                    });
                    return { success: true, data: groups };

                case 'runRpa':
                case 'testRpa':
                    const profileIds = args.profileIds || (args.profileId ? [args.profileId] : []);
                    if (!args.scenarioId || profileIds.length === 0) {
                        return { success: false, error: 'scenarioId and profileIds are required' };
                    }
                    
                    const isTest = toolName === 'testRpa' || args.test === true;
                    let taskName = args.taskName;
                    const isRawScenario = Array.isArray(args.scenarioId) || (typeof args.scenarioId === 'string' && args.scenarioId.trim().startsWith('['));
                    
                    if (!taskName || taskName.trim().startsWith('[') || taskName.trim().startsWith('{') || taskName.length > 100) {
                        taskName = isTest ? `ТЕСТ: ${args.scenarioName || 'Проверка'}` : (isRawScenario ? 'Автоматизация Jarvis' : 'RPA Задача');
                    }

                    const taskId = await this.taskManager.createTask(
                        taskName,
                        typeof args.scenarioId === 'string' ? args.scenarioId : JSON.stringify(args.scenarioId),
                        profileIds,
                        {
                            scheduledAt: args.scheduledAt,
                            repeatInterval: args.repeatInterval,
                            silent: isTest || args.silent, // Tests are always silent by default
                            allowedPaths: args.attachedFiles, // Pass whitelisted files from UI
                            sessionId: sessionId || args.session_id
                        }
                    );
                    return { success: true, data: { action: toolName, taskId, isTest, count: profileIds.length } };

                case 'getTaskStatus':
                    if (!args.taskId) return { success: false, error: 'taskId is required' };
                    const task: any = await new Promise((res) => {
                        this.db.get('SELECT * FROM jarvis_tasks WHERE id = ?', [args.taskId], (err, row) => res(row));
                    });
                    if (!task) return { success: false, error: 'Task not found' };
                    return { success: true, data: task };

                case 'getTaskLogs':
                    if (!args.taskId) return { success: false, error: 'taskId is required' };
                    const taskLogs: any[] = await new Promise((res) => {
                        this.db.all('SELECT * FROM jarvis_execution_logs WHERE session_id = ? ORDER BY started_at ASC', [args.taskId], (err, rows) => res(rows || []));
                    });
                    const decryptedTaskLogs = taskLogs.map(l => ({
                        ...l,
                        log_data: l.log_data ? EncryptionService.decrypt(l.log_data) : ''
                    }));
                    return { success: true, data: decryptedTaskLogs };

                case 'installExtension':
                    const targetProfileIds = args.profileIds || (args.profileId ? [args.profileId] : []);
                    if (targetProfileIds.length === 0 || !args.extensionId) {
                        return { success: false, error: 'profileIds and extensionId are required' };
                    }
                    
                    let extension: any;
                    // If it's a Chrome Store ID (32 chars)
                    if (args.extensionId.length === 32 && /^[a-z]+$/.test(args.extensionId)) {
                        extension = await this.extensionManager.installFromChromeStore(args.extensionId);
                    } else {
                        extension = await this.extensionManager.getExtension(args.extensionId);
                        if (!extension) {
                            try {
                                const sanitizedPath = PathSanitizer.sanitize(args.extensionId);
                                if (!sanitizedPath) {
                                    return { success: false, error: `Security block: Access to path ${args.extensionId} is denied.` };
                                }
                                extension = await this.extensionManager.addExtension(`Jarvis Ext ${Date.now()}`, sanitizedPath);
                            } catch (e) {
                                return { success: false, error: `Extension not found or invalid path: ${args.extensionId}` };
                            }
                        }
                    }

                    // Create an RPA scenario to install extension if multiple profiles
                    // Actually, we can just do it via DB and then restart if needed, 
                    // but for automation we usually want to just assign it.
                    for (const pid of targetProfileIds) {
                        await this.extensionManager.assignToProfile(pid, extension.id);
                    }
                    
                    return { success: true, data: { action: 'installExtension', extensionId: extension.id, count: targetProfileIds.length } };

                case 'startRecording':
                    if (!args.profileId) return { success: false, error: 'profileId is required' };
                    await this.jarvisController.startRecording(args.profileId);
                    return { success: true, data: { action: 'startRecording', profileId: args.profileId, note: 'Recording started. Perform actions in the browser.' } };

                case 'stopRecording':
                    const recordedLogs = await this.jarvisController.stopRecording();
                    return { success: true, data: { action: 'stopRecording', logs: recordedLogs, note: 'Recording stopped. You can see the result in the chat.' } };

                case 'stopAll':
                case 'stopAllTasks':
                    const stoppedCount = await this.taskManager.stopAllTasks();
                    // Also stop all running profiles
                    const runningProfiles = this.chromiumManager.getRunningProfiles();
                    for (const rp of runningProfiles) {
                        await this.chromiumManager.terminateProfile(rp.profileId);
                    }
                    return { success: true, data: { action: 'stopAll', tasksStopped: stoppedCount, profilesStopped: runningProfiles.length } };

                case 'updateConfig':
                    // Map AI args to DB columns
                    const configUpdates: any = {};
                    if (args.tgToken) configUpdates.tg_token = EncryptionService.encrypt(args.tgToken);
                    if (args.tgChatId) configUpdates.tg_chat_id = EncryptionService.encrypt(args.tgChatId);
                    if (args.tgNotifySuccess !== undefined) configUpdates.tg_notify_success = args.tgNotifySuccess ? 1 : 0;
                    if (args.tgNotifyError !== undefined) configUpdates.tg_notify_error = args.tgNotifyError ? 1 : 0;
                    if (args.tgNotifySummary !== undefined) configUpdates.tg_notify_summary = args.tgNotifySummary ? 1 : 0;
                    
                    if (Object.keys(configUpdates).length === 0) return { success: false, error: 'No valid config parameters provided' };

                    const fields = Object.keys(configUpdates).map(k => `${k} = ?`).join(', ');
                    const values = Object.values(configUpdates);
                    values.push(Date.now()); // updated_at

                    await new Promise<void>((resolve, reject) => {
                        this.db.run(`UPDATE jarvis_config SET ${fields}, updated_at = ? WHERE id = 1`, [...values], (err) => err ? reject(err) : resolve());
                    });
                    return { success: true, data: { action: 'updateConfig', updatedFields: Object.keys(configUpdates) } };

                default:
                    // Try MCP tools if configured
                    if (this.mcpManager) {
                        const mcpResult = await this.mcpManager.callTool(toolName, args);
                        if (mcpResult && !mcpResult.error) {
                            return { success: true, data: mcpResult };
                        }
                        if (mcpResult && mcpResult.error && !mcpResult.error.includes('not found')) {
                            return { success: false, error: mcpResult.error };
                        }
                    }
                    return { success: false, error: `Unknown tool: ${toolName}` };
            }
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }
}
