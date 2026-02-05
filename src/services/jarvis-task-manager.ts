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
}

interface ActiveTask {
    task: JarvisTask;
    scenario: any;
    remainingProfileIds: string[];
    runningCount: number;
    completedCount: number;
    failedCount: number;
    lastErrors: string[];
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

    async createTask(name: string, scriptId: string, profileIds: string[], options: { scheduledAt?: number | null, repeatInterval?: number, cronExpression?: string | null } = {}): Promise<string> {
        const id = uuidv4();
        const now = Date.now();
        const profileIdsJson = JSON.stringify(profileIds);

        await new Promise<void>((resolve, reject) => {
            this.db.run(
                'INSERT INTO jarvis_tasks (id, name, script_id, profile_ids, scheduled_at, repeat_interval, cron_expression, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [id, name, scriptId, profileIdsJson, options.scheduledAt || null, options.repeatInterval || 0, options.cronExpression || null, 'pending', now],
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
                    const scenario = await this.rpaEngine.getScenario(task.script_id);
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
                        lastErrors: []
                    });

                    await this.updateTaskStatus(task.id, 'running');
                    await this.telegramService.notifyTaskStarted(task.name, task.profile_ids.length);
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

        try {
            let devToolsPort = this.chromiumManager.getDevToolsPort(profileId);
            let autoClosed = false;

            const profileData = await this.profileManager.getProfileWithFingerprint(profileId);
            if (profileData) {
                if (!devToolsPort) {
                    const launchInfo = await this.chromiumManager.launchProfile(profileId, profileData.profile.user_data_dir, { headless: true });
                    devToolsPort = launchInfo.devToolsPort;
                    autoClosed = true;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            if (devToolsPort) {
                const wsEndpoint = await this.chromiumManager.getDevToolsEndpoint(devToolsPort);
                const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
                const pages = await browser.pages();
                const page = pages.length > 0 ? pages[0] : await browser.newPage();

                await this.rpaEngine.executeScenario(page, activeTask.scenario, { INDEX: profileIndex.toString() }, profileId);

                await browser.disconnect();
                if (autoClosed) await this.chromiumManager.terminateProfile(profileId);

                await this.logExecution(task.id, profileId, 'success', 'Completed successfully');
                activeTask.completedCount++;
            } else {
                throw new Error('Could not launch profile');
            }
        } catch (err: any) {
            console.error(`[JarvisTaskManager] Profile ${profileId} failed:`, err.message);
            await this.logExecution(task.id, profileId, 'failed', err.message);
            activeTask.failedCount++;
            activeTask.lastErrors.push(`${profileId}: ${err.message}`);
            await this.telegramService.notifyProfileError(task.name, profileId, err.message);
        }
    }

    private async checkTaskCompletion(activeTask: ActiveTask) {
        if (activeTask.remainingProfileIds.length === 0 && activeTask.runningCount === 0) {
            const task = activeTask.task;
            const finalStatus = activeTask.failedCount === task.profile_ids.length ? 'failed' : 'completed';
            
            await this.updateTaskStatus(task.id, finalStatus);
            await this.telegramService.notifyTaskCompleted(task.name, activeTask.completedCount, activeTask.failedCount, activeTask.lastErrors);
            
            // Handle repetition
            if (task.repeat_interval > 0) {
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
}
