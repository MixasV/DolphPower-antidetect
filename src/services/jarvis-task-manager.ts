import { Database } from 'sqlite3';
import { ChromiumManager } from './chromium-manager';
import { RPAEngine } from './rpa-engine';
import { ProfileManager } from './profile-manager';
import { ResourceMonitor } from './resource-monitor';
import { TelegramService } from './telegram-service';
import { EncryptionService } from './encryption-service';
import { v4 as uuidv4 } from 'uuid';

export interface JarvisTask {
    id: string;
    name: string;
    script_id: string;
    profile_ids: string[];
    status: 'pending' | 'running' | 'completed' | 'failed' | 'scheduled';
    scheduled_at: number | null;
    repeat_interval: number;
    cron_expression: string | null;
    last_run_at: number | null;
    created_at: number;
    silent?: boolean;
    allowed_paths?: string[]; // New field for whitelisted file paths
    parent_session_id?: string; // New field to link task to a chat session
}

interface ActiveTask {
    task: JarvisTask;
    scenario: any;
    remainingProfileIds: string[];
    runningCount: number;
    completedCount: number;
    failedCount: number;
    lastErrors: string[];
    silent: boolean;
    debug: boolean;
    allowedPaths: string[];
}

export class JarvisTaskManager {
    private isRunning = false;
    private telegramService: TelegramService;
    private activeTasks: Map<string, ActiveTask> = new Map();
    private globalConcurrency: number = 5;

    constructor(
        private db: Database,
        private chromiumManager: ChromiumManager,
        private rpaEngine: RPAEngine,
        private profileManager: ProfileManager
    ) {
        this.telegramService = new TelegramService();
        this.globalConcurrency = ResourceMonitor.calculateOptimalConcurrency(true);
    }

    private async refreshTGConfig() {
        return new Promise<void>((resolve) => {
            this.db.get('SELECT * FROM jarvis_config WHERE id = 1', (err, row: any) => {
                if (row) {
                    this.telegramService.updateConfig(row);
                }
                resolve();
            });
        });
    }

    async createTask(name: string, scriptId: string, profileIds: string[], options: { scheduledAt?: number | null, repeatInterval?: number, cronExpression?: string | null, silent?: boolean, allowedPaths?: string[], sessionId?: string } = {}): Promise<string> {
        const id = uuidv4();
        const now = Date.now();
        const profileIdsJson = JSON.stringify(profileIds);
        const allowedPathsJson = options.allowedPaths ? JSON.stringify(options.allowedPaths) : null;

        await new Promise<void>((resolve, reject) => {
            this.db.run(
                'INSERT INTO jarvis_tasks (id, name, script_id, profile_ids, scheduled_at, repeat_interval, cron_expression, status, created_at, silent, allowed_paths, parent_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    id, 
                    name, 
                    scriptId, 
                    profileIdsJson, 
                    options.scheduledAt || null, 
                    options.repeatInterval || 0, 
                    options.cronExpression || null, 
                    'pending', 
                    now, 
                    options.silent ? 1 : 0,
                    allowedPathsJson,
                    options.sessionId || null
                ],
                (err) => err ? reject(err) : resolve()
            );
        });

        this.runScheduler();
        return id;
    }

    async runScheduler() {
        if (this.isRunning) return;
        
        // If master key is not set, we cannot process tasks (especially those with encrypted logs/data)
        if (!EncryptionService.isMasterKeySet()) {
            // Check again in 10 seconds if we are still locked
            setTimeout(() => this.runScheduler(), 10000);
            return;
        }

        this.isRunning = true;

        try {
            await this.refreshTGConfig();
            
            // 1. Pick up new tasks that are due
            const dueTasks = await this.getDueTasks();
            for (const task of dueTasks) {
                if (!this.activeTasks.has(task.id)) {
                    let scenario: any = null;
                    
                    // Support for inline JSON scenarios (Jarvis sometimes sends actions directly)
                    if (task.script_id.trim().startsWith('[') && task.script_id.trim().endsWith(']')) {
                        try {
                            scenario = {
                                id: 'inline-' + task.id,
                                name: task.name,
                                actions: JSON.parse(task.script_id)
                            };
                        } catch (e) {
                            console.error('[JarvisTaskManager] Failed to parse inline scenario:', e);
                        }
                    } else {
                        scenario = await this.rpaEngine.getScenario(task.script_id);
                    }

                    if (!scenario) {
                        await this.updateTaskStatus(task.id, 'failed');
                        continue;
                    }

                    this.activeTasks.set(task.id, {
                        task,
                        scenario,
                        remainingProfileIds: [...task.profile_ids],
                        runningCount: 0,
                        completedCount: 0,
                        failedCount: 0,
                        lastErrors: [],
                        silent: !!task.silent,
                        debug: task.name.includes('ТЕСТ:') || task.name.toLowerCase().includes('debug'),
                        allowedPaths: task.allowed_paths || []
                    });

                    await this.updateTaskStatus(task.id, 'running');
                    if (task.parent_session_id) {
                        await this.appendStatusToSession(task.parent_session_id, `🚀 Starting task: ${task.name}`);
                    }
                    
                    // Only notify TG if NOT silent
                    if (!task.silent) {
                        await this.telegramService.notifyTaskStarted(task.name, task.profile_ids.length, !!task.silent);
                    }
        }
    }

    // 1.5 Prevent spam loop: check if task failed too many times in a short interval
    const taskIds = Array.from(this.activeTasks.keys());
    for (const taskId of taskIds) {
        const active = this.activeTasks.get(taskId)!;
        // If task failed on many profiles quickly, maybe stop it?
        if (active.failedCount > 3 && active.completedCount === 0 && active.runningCount === 0 && active.remainingProfileIds.length > 0) {
             console.warn(`[JarvisTaskManager] Task ${taskId} is failing consistently. Stopping to prevent spam.`);
             await this.stopTask(taskId);
             await this.telegramService.sendMessage(`⚠️ <b>Task Aborted</b>\n\nTask "${active.task.name}" was aborted after multiple consecutive failures to prevent spam.`);
        }
    }

    // 2. Resource distribution and execution
    await this.executeStep();

        } catch (e) {
            console.error('[JarvisTaskManager] Scheduler error:', e);
        } finally {
            this.isRunning = false;
            // Schedule next heart-beat
            setTimeout(() => this.runScheduler(), 5000);
        }
    }

    private async executeStep() {
        this.globalConcurrency = ResourceMonitor.calculateOptimalConcurrency(true);
        const tasksArray = Array.from(this.activeTasks.values());
        let totalRunning = tasksArray.reduce((sum, t) => sum + t.runningCount, 0);

        if (totalRunning >= this.globalConcurrency || this.activeTasks.size === 0) return;

        // Round-Robin allocation
        const taskIds = Array.from(this.activeTasks.keys());
        let taskIndex = 0;

        while (totalRunning < this.globalConcurrency && this.hasWorkToDo()) {
            const taskId = taskIds[taskIndex % taskIds.length];
            const activeTask = this.activeTasks.get(taskId)!;

            if (activeTask.remainingProfileIds.length > 0) {
                const profileId = activeTask.remainingProfileIds.shift()!;
                activeTask.runningCount++;
                totalRunning++;
                
                // Fire and forget profile execution
                this.runProfileInTask(activeTask, profileId).then(() => {
                    activeTask.runningCount--;
                    this.checkTaskCompletion(activeTask);
                    this.runScheduler(); // Re-trigger scheduler to fill the slot
                });
            }
            taskIndex++;
            
            // Safety break if we looped through all tasks and none had work
            if (taskIndex > taskIds.length * 2) break;
        }
    }

    private hasWorkToDo(): boolean {
        for (const t of this.activeTasks.values()) {
            if (t.remainingProfileIds.length > 0) return true;
        }
        return false;
    }

    private async runProfileInTask(activeTask: ActiveTask, profileId: string) {
        const puppeteer = require('puppeteer-core');
        const task = activeTask.task;
        const profileIndex = task.profile_ids.indexOf(profileId);
        
        // Use visible window if it's a single profile task (likely a test run or manual trigger)
        const isSingleProfile = task.profile_ids.length === 1;

        try {
            console.log(`[JarvisTaskManager] Executing task "${task.name}" on profile ${profileId} (Index: ${profileIndex})`);
            await this.logExecution(task.id, profileId, 'running', `Starting execution (Headless: ${!isSingleProfile})`);

            let devToolsPort = this.chromiumManager.getDevToolsPort(profileId);
            let autoClosed = false;

            const profileData = await this.profileManager.getProfileWithFingerprint(profileId);
            if (profileData) {
                if (!devToolsPort) {
                    const launchOptions: any = {
                        headless: !isSingleProfile,
                        restoreTabs: false
                    };

                    // Handle Proxy
                    if (profileData.profile.proxy_id) {
                        const { ProxyManager } = require('./proxy-manager');
                        const proxyManager = new ProxyManager(this.db);
                        const proxy = await proxyManager.getProxy(profileData.profile.proxy_id);
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

                    const launchInfo = await this.chromiumManager.launchProfile(profileId, profileData.profile.user_data_dir, launchOptions);
                    devToolsPort = launchInfo.devToolsPort;
                    autoClosed = true;

                    // Apply Fingerprint via CDP
                    if (devToolsPort) {
                        await this.chromiumManager.applyFingerprintViaCDP(profileId, devToolsPort, profileData.fingerprint);
                        // Unlock tunnel (which was started blocked for safety)
                        await this.chromiumManager.unlockProfile(profileId);
                    }
                    
                    // Wait for browser to initialize
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            if (devToolsPort) {
                const wsEndpoint = await this.chromiumManager.getDevToolsEndpoint(devToolsPort);
                const browser = await puppeteer.connect({ 
                    browserWSEndpoint: wsEndpoint, 
                    defaultViewport: null 
                });
                
                const pages = await browser.pages();
                const page = pages.length > 0 ? pages[0] : await browser.newPage();
                
                // Bring to front if visible
                if (!isSingleProfile === false) {
                    try { await page.bringToFront(); } catch(e) {}
                }

                const result = await this.rpaEngine.executeScenario(page, activeTask.scenario, { 
                    INDEX: profileIndex.toString(),
                    _ALLOWED_PATHS: JSON.stringify(activeTask.allowedPaths)
                }, profileId, activeTask.debug, async (progress) => {
                    // Real-time status updates to the chat session if linked
                    if (task.parent_session_id) {
                        const statusMsg = `[Task: ${task.name}] Step ${progress.currentStep}/${progress.totalSteps}: ${progress.action.type}${progress.action.selector ? ` on ${progress.action.selector}` : ''} - ${progress.status}${progress.details ? ` (${progress.details.substring(0, 50)}...)` : ''}`;
                        await this.appendStatusToSession(task.parent_session_id, statusMsg);
                    }
                });
                
                if (result.success) {
                    await this.logExecution(task.id, profileId, 'success', `RPA execution finished successfully.`);
                    activeTask.completedCount++;
                } else {
                    const errorSummary = result.errors.map(e => {
                        const act = e.action;
                        const target = act.selector || act.url || act.key || act.variableName || '';
                        return `[Action: ${act.type}${target ? ` on ${target}` : ''}] failed: ${e.error}`;
                    }).join('; ');
                    
                    if (activeTask.debug) {
                        await this.logExecution(task.id, profileId, 'failed', `RPA Failed. Error summary: ${errorSummary}`);
                    }
                    throw new Error(errorSummary);
                }

                await browser.disconnect();
                
                // Keep window open for a bit if it was visible so user can see result
                if (autoClosed) {
                    if (!isSingleProfile === false) await new Promise(r => setTimeout(r, 5000));
                    await this.chromiumManager.terminateProfile(profileId);
                }
            } else {
                throw new Error('Could not launch or connect to profile');
            }
        } catch (err: any) {
            console.error(`[JarvisTaskManager] Profile ${profileId} failed:`, err.message);
            await this.logExecution(task.id, profileId, 'failed', err.message);
            activeTask.failedCount++;
            activeTask.lastErrors.push(`${profileId}: ${err.message}`);
            // Silenced to avoid spam, summary will be sent at the end
            // await this.telegramService.notifyProfileError(task.name, profileId, err.message);
        }
    }

    private async checkTaskCompletion(activeTask: ActiveTask) {
        if (activeTask.remainingProfileIds.length === 0 && activeTask.runningCount === 0) {
            const task = activeTask.task;
            const finalStatus = activeTask.failedCount === task.profile_ids.length ? 'failed' : 'completed';
            
            await this.updateTaskStatus(task.id, finalStatus);
            
            if (task.parent_session_id) {
                const completionMsg = finalStatus === 'completed' || activeTask.failedCount === 0 
                    ? `✅ Task "${task.name}" finished successfully.` 
                    : `⚠️ Task "${task.name}" finished with ${activeTask.failedCount} errors.`;
                await this.appendStatusToSession(task.parent_session_id, completionMsg);
            }

            // Only notify TG if NOT silent
            if (!task.silent) {
                await this.telegramService.notifyTaskCompleted(task.name, activeTask.completedCount, activeTask.failedCount, activeTask.lastErrors, activeTask.silent);
            }
            
            // Handle repetition - Only reschedule if at least one profile succeeded or it's a scheduled task
            // If it failed completely on the first run, don't auto-reschedule to prevent spam loops
            if (task.repeat_interval > 0 && (activeTask.completedCount > 0 || task.last_run_at !== null)) {
                const nextRun = Date.now() + (task.repeat_interval * 60 * 1000);
                await this.rescheduleTask(task.id, nextRun);
            } else if (task.cron_expression) {
                // For cron tasks, just set back to scheduled
                await this.rescheduleTask(task.id, null);
            }

            this.activeTasks.delete(task.id);
        }
    }

    private async getDueTasks(): Promise<JarvisTask[]> {
        const now = Date.now();
        const nowObj = new Date();
        const currentMinute = nowObj.getMinutes();
        const currentHour = nowObj.getHours();
        const currentDay = nowObj.getDay(); // 0-6 (Sun-Sat)

        return new Promise((resolve) => {
            this.db.all(
                'SELECT * FROM jarvis_tasks WHERE status IN ("pending", "scheduled") AND (scheduled_at IS NULL OR scheduled_at <= ? OR cron_expression IS NOT NULL) ORDER BY created_at ASC',
                [now],
                (err, rows: any[]) => {
                    if (rows) {
                        const due: JarvisTask[] = [];
                        rows.forEach(r => {
                            r.profile_ids = JSON.parse(r.profile_ids);
                            
                            // Check if it's a cron task and if it's time to run
                            if (r.cron_expression) {
                                if (this.isCronDue(r.cron_expression, r.last_run_at)) {
                                    due.push(r as JarvisTask);
                                }
                            } else {
                                // Regular scheduled or pending task
                                if (!r.scheduled_at || r.scheduled_at <= now) {
                                    due.push(r as JarvisTask);
                                }
                            }
                        });
                        resolve(due);
                    } else {
                        resolve([]);
                    }
                }
            );
        });
    }

    private isCronDue(expression: string, lastRunAt: number | null): boolean {
        // Simple Cron Parser for: "min hour dayOfMonth month dayOfWeek"
        // Supports: "0 14 * * 0" (Sunday 14:00)
        try {
            const now = new Date();
            // Don't run twice in the same minute
            if (lastRunAt && (Date.now() - lastRunAt < 61000)) return false;

            const [min, hour, dom, month, dow] = expression.split(' ');
            
            const match = (val: number, pattern: string) => {
                if (pattern === '*') return true;
                if (pattern.includes(',')) return pattern.split(',').includes(val.toString());
                return val.toString() === pattern;
            };

            const isDue = match(now.getMinutes(), min) &&
                          match(now.getHours(), hour) &&
                          match(now.getDate(), dom) &&
                          match(now.getMonth() + 1, month) &&
                          match(now.getDay(), dow);

            return isDue;
        } catch (e) {
            return false;
        }
    }

    private async updateTaskStatus(id: string, status: string) {
        await new Promise<void>((resolve) => {
            this.db.run('UPDATE jarvis_tasks SET status = ?, last_run_at = ? WHERE id = ?', [status, Date.now(), id], () => resolve());
        });
    }

    private async rescheduleTask(id: string, nextRun: number | null) {
        await new Promise<void>((resolve) => {
            this.db.run('UPDATE jarvis_tasks SET status = "scheduled", scheduled_at = ? WHERE id = ?', [nextRun, id], () => resolve());
        });
    }

    private async logExecution(taskId: string, profileId: string, status: string, log: string) {
        const id = uuidv4();
        const now = Date.now();
        const encryptedLog = EncryptionService.encrypt(log);
        await new Promise<void>((resolve) => {
            this.db.run(
                'INSERT INTO jarvis_execution_logs (id, session_id, profile_id, status, log_data, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [id, taskId, profileId, status, encryptedLog, now, now],
                () => resolve()
            );
        });
    }

    // legacy method wrapper for compatibility
    async runPendingTasks() {
        this.runScheduler();
    }

    /**
     * Stop a specific task and its running profiles
     */
    async stopTask(taskId: string) {
        const active = this.activeTasks.get(taskId);
        
        // Clear repeat interval and scheduled_at in DB to prevent it from coming back
        await new Promise<void>((resolve) => {
            this.db.run('UPDATE jarvis_tasks SET status = "failed", repeat_interval = 0, scheduled_at = NULL WHERE id = ?', [taskId], () => resolve());
        });

        if (active) {
            active.remainingProfileIds = [];
            this.activeTasks.delete(taskId);
            console.log(`[JarvisTaskManager] Active task ${taskId} stopped by user`);
            return true;
        }
        return false;
    }

    /**
     * Stop all active tasks
     */
    async stopAllTasks() {
        const ids = Array.from(this.activeTasks.keys());
        for (const id of ids) {
            await this.stopTask(id);
        }
        
        // Also ensure DB status is updated for any tasks that might be in 'pending' or 'scheduled'
        await new Promise<void>((resolve) => {
            this.db.run('UPDATE jarvis_tasks SET status = "failed" WHERE status IN ("pending", "running", "scheduled")', [], () => resolve());
        });

        console.log('[JarvisTaskManager] All tasks stopped and cancelled');
        return ids.length;
    }

    private statusQueue: Map<string, { role: string, content: string, isStatusUpdate: boolean }[]> = new Map();
    private isProcessingQueue = false;

    /**
     * Appends a technical status message to a session's chat history
     */
    private async appendStatusToSession(sessionId: string, message: string) {
        if (!this.statusQueue.has(sessionId)) {
            this.statusQueue.set(sessionId, []);
        }
        this.statusQueue.get(sessionId)!.push({ role: 'system', content: message, isStatusUpdate: true });
        
        this.processStatusQueue();
    }

    private async processStatusQueue() {
        if (this.isProcessingQueue || this.statusQueue.size === 0) return;
        this.isProcessingQueue = true;

        try {
            const sessionIds = Array.from(this.statusQueue.keys());
            for (const sessionId of sessionIds) {
                const pendingMessages = this.statusQueue.get(sessionId);
                if (!pendingMessages || pendingMessages.length === 0) {
                    this.statusQueue.delete(sessionId);
                    continue;
                }

                // Batch process messages for this session
                const messagesToAppend = [...pendingMessages];
                this.statusQueue.set(sessionId, []); // Clear queue for this session while processing

                await new Promise<void>((resolve) => {
                    this.db.get('SELECT history FROM jarvis_sessions WHERE id = ?', [sessionId], (err, row: any) => {
                        if (row) {
                            try {
                                const history = JSON.parse(EncryptionService.decrypt(row.history));
                                history.push(...messagesToAppend);
                                const encrypted = EncryptionService.encrypt(JSON.stringify(history));
                                this.db.run('UPDATE jarvis_sessions SET history = ?, updated_at = ? WHERE id = ?', 
                                    [encrypted, Date.now(), sessionId], () => resolve());
                            } catch (e) {
                                resolve();
                            }
                        } else {
                            resolve();
                        }
                    });
                });
                
                if (this.statusQueue.get(sessionId)?.length === 0) {
                    this.statusQueue.delete(sessionId);
                }
            }
        } finally {
            this.isProcessingQueue = false;
            // Check if more messages arrived during processing
            if (this.statusQueue.size > 0) {
                setTimeout(() => this.processStatusQueue(), 100);
            }
        }
    }
}
