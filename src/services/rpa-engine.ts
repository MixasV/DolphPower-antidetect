import { v4 as uuidv4 } from 'uuid';
import { Database } from 'sqlite3';
import * as fs from 'fs/promises';
import * as path from 'path';
import { JarvisService } from './jarvis-service';
import { ExtensionManager } from './extension-manager';
import { PathSanitizer } from './path-sanitizer';

export interface RPAAction {
    type: 'click' | 'type' | 'scroll' | 'wait' | 'screenshot' | 'navigate' | 'select' | 'hover' | 'pressKey' | 'keyPress' | 'reload' | 'back' | 'variable' | 'installExtension' | 'getText' | 'writeFile';
    selector?: string;
    value?: any;
    text?: string;
    key?: string;
    url?: string;
    ms?: number;
    delay?: number;
    x?: number;
    y?: number;
    condition?: string;
    variableName?: string;
    variable?: string; // Alias for variableName
    extensionId?: string;
    path?: string;
    content?: string;
    append?: boolean;
    timeout?: number;
    args?: any; // To support Jarvis passing args inside an object
    healingAttempted?: boolean;
}

export interface RPAScenario {
    id: string;
    profile_id: string | null;
    name: string;
    actions: RPAAction[];
    loops?: number;
    onError?: 'stop' | 'skip' | 'retry';
    created_at: number;
    variables?: Record<string, string>; // Dynamic variables for this execution
}

export class RPAEngine {
    private lastMouseX: number = Math.random() * 1000;
    private lastMouseY: number = Math.random() * 800;
    private fileCache: Map<string, string[]> = new Map();

    constructor(
        private db: Database, 
        private jarvisService?: JarvisService,
        private extensionManager?: ExtensionManager
    ) { }

    async createScenario(name: string, actions: RPAAction[], profile_id: string | null = null): Promise<RPAScenario> {
        const scenario: RPAScenario = {
            id: uuidv4(),
            name,
            actions,
            profile_id,
            created_at: Date.now()
        };

        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO rpa_scenarios (id, name, actions, profile_id, created_at) VALUES (?, ?, ?, ?, ?)',
                [scenario.id, scenario.name, JSON.stringify(scenario.actions), scenario.profile_id, scenario.created_at],
                (err) => {
                    if (err) reject(err);
                    else resolve(scenario);
                }
            );
        });
    }

    async listScenarios(profileId?: string): Promise<RPAScenario[]> {
        return new Promise((resolve, reject) => {
            let query = 'SELECT * FROM rpa_scenarios';
            let params: any[] = [];
            if (profileId) {
                query += ' WHERE profile_id = ? OR profile_id IS NULL';
                params.push(profileId);
            }
            query += ' ORDER BY created_at DESC';

            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map((row: any) => ({
                    ...row,
                    actions: JSON.parse(row.actions)
                })));
            });
        });
    }

    async getScenario(id: string): Promise<RPAScenario | null> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM rpa_scenarios WHERE id = ?', [id], (err, row: any) => {
                if (err) reject(err);
                else if (!row) resolve(null);
                else resolve({
                    ...row,
                    actions: JSON.parse(row.actions)
                } as RPAScenario);
            });
        });
    }

    async deleteScenario(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM rpa_scenarios WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    private async resolveValue(value: string, executionVars: Record<string, string> = {}): Promise<string> {
        if (!value || typeof value !== 'string') return value;

        let resolved = value;

        // 1. Handle {{FILE:path|line:N}} or {{FILE:path|line:INDEX}}
        // Regex improved to handle Windows paths, spaces, and optional line index more reliably
        const fileRegex = /\{\{FILE:([\s\S]+?)(?:\|line:([\s\S]+?))?\}\}/gi;
        
        // Use a loop to handle multiple matches manually to support async resolution
        let match;
        while ((match = fileRegex.exec(resolved)) !== null) {
            const fullMatch = match[0];
            const filePathRaw = match[1].trim();
            const linePart = match[2]?.trim();
            
            let lineIndex = 0;
            if (linePart === 'INDEX') {
                lineIndex = parseInt(executionVars['INDEX'] || '0');
            } else if (linePart) {
                lineIndex = parseInt(linePart) || 0;
            }

            try {
                // Support both slash types and normalize
                const filePath = filePathRaw.replace(/\//g, path.sep).replace(/\\/g, path.sep);
                
                // Explicit whitelist check for attached files
                let isWhitelisted = false;
                if (executionVars['_ALLOWED_PATHS']) {
                    try {
                        const allowed = JSON.parse(executionVars['_ALLOWED_PATHS']);
                        if (Array.isArray(allowed) && allowed.some(p => path.resolve(p) === path.resolve(filePath))) {
                            isWhitelisted = true;
                        }
                    } catch(e) {}
                }

                const sanitizedPath = isWhitelisted ? path.resolve(filePath) : PathSanitizer.sanitize(filePath);
                
                if (!sanitizedPath) {
                    console.error(`[Security] RPA blocked access to path: ${filePathRaw}`);
                    resolved = resolved.replace(fullMatch, `[ACCESS_DENIED: ${filePathRaw}]`);
                    continue;
                }

                let lines = this.fileCache.get(sanitizedPath);
                if (!lines) {
                    try {
                        const content = await fs.readFile(sanitizedPath, 'utf8');
                        lines = content.split(/\r?\n/).filter(line => line.trim());
                        this.fileCache.set(sanitizedPath, lines);
                    } catch (readErr: any) {
                        console.error(`[RPA] File read error: ${sanitizedPath}`, readErr.message);
                        resolved = resolved.replace(fullMatch, `[FILE_ERROR: ${filePathRaw}]`);
                        continue;
                    }
                }

                if (lines && lines.length > 0) {
                    const lineValue = lines[lineIndex % lines.length] || '';
                    resolved = resolved.replace(fullMatch, lineValue);
                } else {
                    resolved = resolved.replace(fullMatch, '');
                }
            } catch (e: any) {
                console.error(`Failed to resolve file placeholder: ${fullMatch}`, e.message);
                resolved = resolved.replace(fullMatch, '');
            }
            
            // Reset regex index because we modified the string
            fileRegex.lastIndex = 0;
        }

        // 2. Handle {{VAR:name}} and {{name}} (common Jarvis format)
        resolved = resolved.replace(/\{\{(?:VAR:)?([^|{}]+)\}\}/g, (match, name) => {
            const cleanName = name.trim();
            if (cleanName.includes(':') && !cleanName.startsWith('VAR:')) return match;
            
            const val = executionVars[cleanName];
            return val !== undefined ? val : match;
        });

        return resolved;
    }

    /**
     * Execute scenario on a page
     */
    async executeScenario(
        page: any,
        scenario: RPAScenario,
        externalVars: Record<string, string> = {},
        profileId?: string,
        debug: boolean = false,
        onProgress?: (progress: { currentStep: number; totalSteps: number; action: RPAAction; status: string; details?: string }) => void
    ): Promise<{ success: boolean; results: any[]; errors: any[] }> {
        const results: any[] = [];
        const errors: any[] = [];
        const loops = scenario.loops || 1;
        const totalSteps = scenario.actions.length * loops;
        const executionVars = { ...(scenario.variables || {}), ...externalVars };

        // Clear file cache at start of scenario
        this.fileCache.clear();

        let stepCounter = 0;
        for (let i = 0; i < loops; i++) {
            for (const action of scenario.actions) {
                stepCounter++;
                try {
                    if (debug) console.log(`[RPA-Debug] Executing ${action.type}...`);
                    
                    if (onProgress) {
                        onProgress({ 
                            currentStep: stepCounter, 
                            totalSteps, 
                            action, 
                            status: 'executing' 
                        });
                    }

                    const result = await this.executeAction(page, action, executionVars, profileId);
                    results.push(result);
                    
                    if (onProgress) {
                        onProgress({ 
                            currentStep: stepCounter, 
                            totalSteps, 
                            action, 
                            status: 'success',
                            details: JSON.stringify(result)
                        });
                    }
                    
                    // In debug mode, we might want to take a screenshot after each step
                    if (debug && (action.type === 'click' || action.type === 'type' || action.type === 'navigate')) {
                        try {
                            const ssName = `debug-${Date.now()}.png`;
                            await this.performAction(page, { type: 'screenshot', value: ssName } as any, executionVars, profileId);
                            results.push({ debug_screenshot: ssName });
                        } catch(e) {}
                    }
                } catch (e: any) {
                    errors.push({ action, error: e.message });
                    
                    if (onProgress) {
                        onProgress({ 
                            currentStep: stepCounter, 
                            totalSteps, 
                            action, 
                            status: 'failed',
                            details: e.message
                        });
                    }

                    if (scenario.onError === 'stop' || debug) break; // In debug, stop on first error
                }
            }
            if ((scenario.onError === 'stop' || debug) && errors.length > 0) break;
        }

        return { success: errors.length === 0, results, errors };
    }

    /**
     * Execute a single action
     */
    private async executeAction(page: any, action: RPAAction, executionVars: Record<string, string> = {}, profileId?: string): Promise<any> {
        // Normalize action: Jarvis often sends "action" instead of "type" or puts everything inside "args"
        const normalizedAction = { ...action };
        
        // 1. Normalize type/action
        if (!normalizedAction.type && (action as any).action) {
            normalizedAction.type = (action as any).action;
        }
        if (!normalizedAction.type && normalizedAction.args?.action) {
            normalizedAction.type = normalizedAction.args.action;
        }
        if (!normalizedAction.type && normalizedAction.args?.type) {
            normalizedAction.type = normalizedAction.args.type;
        }

        // 2. Normalize args: merge from normalizedAction.args into the action itself if missing
        if (normalizedAction.args && typeof normalizedAction.args === 'object') {
            for (const [key, val] of Object.entries(normalizedAction.args)) {
                if ((normalizedAction as any)[key] === undefined) {
                    (normalizedAction as any)[key] = val;
                }
            }
        }

        // Resolve dynamic values in action properties
        if (normalizedAction.selector) normalizedAction.selector = await this.resolveValue(normalizedAction.selector, executionVars);
        if (normalizedAction.text) normalizedAction.text = await this.resolveValue(normalizedAction.text, executionVars);
        if (normalizedAction.value) normalizedAction.value = await this.resolveValue(normalizedAction.value, executionVars);
        if (normalizedAction.url) normalizedAction.url = await this.resolveValue(normalizedAction.url, executionVars);

        try {
            return await this.performAction(page, normalizedAction, executionVars, profileId);
        } catch (error: any) {
            // AI Healing Logic
            if (this.jarvisService && normalizedAction.selector && !normalizedAction.healingAttempted) {
                console.log(`[RPA] Action ${normalizedAction.type} failed for ${normalizedAction.selector}. Attempting AI healing...`);
                
                try {
                    // Smart HTML Context capture
                    const htmlContext = await page.evaluate((sel: string) => {
                        const getCleanEl = (el: any) => {
                            const attrs = ['id', 'class', 'name', 'type', 'value', 'placeholder', 'aria-label', 'role', 'href'];
                            let attrStr = '';
                            attrs.forEach(attr => {
                                const val = el.getAttribute(attr);
                                if (val) attrStr += ` ${attr}="${val}"`;
                            });
                            return `<${el.tagName.toLowerCase()}${attrStr}>${el.textContent?.trim().substring(0, 50) || ''}</${el.tagName.toLowerCase()}>`;
                        };

                        let contextEl: any = null;
                        const parts = sel.split(/[ >+~]/).filter(Boolean);
                        
                        for (let i = parts.length - 1; i >= 0; i--) {
                            try {
                                const partial = parts.slice(0, i).join(' ');
                                if (partial) {
                                    const found = (document as any).querySelector(partial);
                                    if (found) { contextEl = found; break; }
                                }
                            } catch(e) {}
                        }
                        
                        if (!contextEl) contextEl = (document as any).body;

                        const interactive = Array.from(contextEl.querySelectorAll('button, input, a, [role="button"], select, [onclick]'))
                            .slice(0, 40)
                            .map(el => getCleanEl(el))
                            .join('\n');

                        return `Target Selector: ${sel}\nContext Parent: ${contextEl.tagName}\nInteractive Elements:\n${interactive}`;
                    }, normalizedAction.selector);

                    const newSelector = await this.jarvisService.healSelector(normalizedAction.selector, htmlContext, normalizedAction.type);
                    
                    if (newSelector && newSelector !== normalizedAction.selector) {
                        console.log(`[RPA] Jarvis found new selector: ${newSelector}. Retrying...`);
                        normalizedAction.selector = newSelector;
                        normalizedAction.healingAttempted = true;
                        return await this.performAction(page, normalizedAction, executionVars);
                    }
                } catch (healingError) {
                    console.error('[RPA] AI Healing failed:', healingError);
                }
            }
            throw error;
        }
    }

    private async performAction(page: any, resolvedAction: RPAAction, executionVars: Record<string, string>, profileId?: string): Promise<any> {
        // Extract common arguments from either direct properties or Jarvis-style 'args' object
        const selector = resolvedAction.selector || resolvedAction.args?.selector;
        const value = resolvedAction.value !== undefined ? resolvedAction.value : resolvedAction.args?.value;
        const text = resolvedAction.text || resolvedAction.args?.text;
        const key = resolvedAction.key || resolvedAction.args?.key;
        const url = resolvedAction.url || resolvedAction.args?.url;
        const pathParam = resolvedAction.path || resolvedAction.args?.path;
        const contentParam = resolvedAction.content || resolvedAction.args?.content;
        const variableParam = resolvedAction.variableName || resolvedAction.variable || resolvedAction.args?.variable || resolvedAction.args?.variableName;
        const timeoutParam = resolvedAction.timeout || resolvedAction.args?.timeout || resolvedAction.ms || resolvedAction.args?.ms;

        switch (resolvedAction.type) {
            case 'click':
                if (!selector) throw new Error('Selector required for click action');
                
                try {
                    const box = await page.$eval(selector, (el: any) => {
                        const { x, y, width, height } = el.getBoundingClientRect();
                        return { x, y, width, height };
                    });
                    
                    const jitterX = Math.random() * (box.width * 0.4) - (box.width * 0.2);
                    const jitterY = Math.random() * (box.height * 0.4) - (box.height * 0.2);
                    
                    const targetX = box.x + box.width / 2 + jitterX;
                    const targetY = box.y + box.height / 2 + jitterY;

                    // Move mouse humanly to target before clicking
                    await this.moveMouseHumanly(page, targetX, targetY);
                    
                    await page.mouse.down();
                    await this.wait(30 + Math.random() * 100);
                    await page.mouse.up();
                } catch (e) {
                    await page.click(selector);
                }
                return { clicked: selector };

            case 'hover':
                if (!selector) throw new Error('Selector required for hover action');
                try {
                    const box = await page.$eval(selector, (el: any) => {
                        const { x, y, width, height } = el.getBoundingClientRect();
                        return { x, y, width, height };
                    });
                    const targetX = box.x + box.width / 2 + (Math.random() * 10 - 5);
                    const targetY = box.y + box.height / 2 + (Math.random() * 10 - 5);
                    await this.moveMouseHumanly(page, targetX, targetY);
                } catch (e) {
                    await page.hover(selector);
                }
                return { hovered: selector };

            case 'type':
                const textToType = text || value;
                if (!selector || textToType === undefined) {
                    throw new Error('Selector and text/value required for type action');
                }
                
                await page.focus(selector);
                await this.typeHumanly(page, String(textToType));
                return { typed: textToType, into: selector };

            case 'pressKey':
            case 'keyPress':
                const keyToPress = key || value;
                if (!keyToPress) throw new Error('Key required for pressKey action');
                await page.keyboard.press(keyToPress);
                return { pressed: keyToPress };

            case 'reload':
                await page.reload({ waitUntil: 'networkidle2' });
                return { reloaded: true };

            case 'back':
                await page.goBack({ waitUntil: 'networkidle2' });
                return { back: true };

            case 'scroll':
                const scrollX = resolvedAction.x !== undefined ? resolvedAction.x : (resolvedAction.args?.x || 0);
                const scrollY = resolvedAction.y !== undefined ? resolvedAction.y : (resolvedAction.args?.y || 500);

                if (scrollX !== undefined && scrollY !== undefined) {
                    await page.evaluate(`
                        window.scrollTo({
                            top: ${scrollY},
                            left: ${scrollX},
                            behavior: 'smooth'
                        })
                    `);
                } else if (selector) {
                    await page.evaluate(`
                        const element = document.querySelector('${selector}');
                        if (element) {
                            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    `);
                }
                await this.wait(1000 + Math.random() * 1000); // Wait for scroll to finish humanly
                return { scrolled: true };

            case 'wait':
                if (selector) {
                    const timeout = timeoutParam || 30000;
                    await page.waitForSelector(selector, { timeout });
                    return { waitedForSelector: selector, timeout };
                }

                const waitTime = timeoutParam || resolvedAction.delay || resolvedAction.args?.delay || 1000;
                // Humanization: Perform micro-movements during long waits
                if (waitTime > 2000) {
                    const iterations = Math.floor(waitTime / 1000);
                    for (let j = 0; j < iterations; j++) {
                        if (Math.random() > 0.7) {
                            const microX = this.lastMouseX + (Math.random() * 4 - 2);
                            const microY = this.lastMouseY + (Math.random() * 4 - 2);
                            await page.mouse.move(microX, microY);
                            this.lastMouseX = microX;
                            this.lastMouseY = microY;
                        }
                        await this.wait(1000);
                    }
                } else {
                    await this.wait(waitTime);
                }
                return { waited: waitTime };

            case 'screenshot':
                const rawFilename = value || text || `screenshot-${Date.now()}.png`;
                const sanitizedFilename = PathSanitizer.sanitizeFilename(rawFilename);
                const screenshotPath = path.join(PathSanitizer.getProjectRoot(), '.screens', sanitizedFilename);
                
                // Ensure .screens exists
                await fs.mkdir(path.dirname(screenshotPath), { recursive: true }).catch(() => {});
                
                await page.screenshot({ path: screenshotPath });
                return { screenshot: sanitizedFilename };

            case 'navigate':
                const targetUrl = url || value || text;
                if (!targetUrl) throw new Error('URL required for navigate action');
                await page.goto(targetUrl, { waitUntil: 'networkidle2' });
                return { navigated: targetUrl };

            case 'select':
                if (!selector || value === undefined) {
                    throw new Error('Selector and value required for select action');
                }
                await page.select(selector, String(value));
                return { selected: value, in: selector };

            case 'variable':
                if (variableParam && value !== undefined) {
                    executionVars[variableParam] = String(value);
                    return { variableSet: variableParam };
                }
                return { error: 'Variable name and value required' };

            case 'getText':
                if (!selector || !variableParam) {
                    throw new Error('Selector and variableName required for getText action');
                }
                const textResult = await page.$eval(selector, (el: any) => el.textContent || el.innerText || '');
                executionVars[variableParam] = textResult.trim();
                return { getText: textResult.trim(), into: variableParam };

            case 'writeFile':
                const filePath = pathParam || value;
                const fileContent = contentParam || text || '';
                if (!filePath) throw new Error('Path required for writeFile action');
                
                const sanitizedWritePath = PathSanitizer.sanitize(filePath);
                if (!sanitizedWritePath) throw new Error(`Security block: Access to path ${filePath} is denied.`);
                
                // Ensure directory exists
                await fs.mkdir(path.dirname(sanitizedWritePath), { recursive: true }).catch(() => {});
                
                const isAppend = resolvedAction.append || resolvedAction.args?.append || false;
                if (isAppend) {
                    await fs.appendFile(sanitizedWritePath, fileContent, 'utf8');
                } else {
                    await fs.writeFile(sanitizedWritePath, fileContent, 'utf8');
                }
                return { writeFile: sanitizedWritePath, appended: !!isAppend };

            case 'installExtension':
                if (!this.extensionManager) throw new Error('ExtensionManager not initialized in RPAEngine');
                const extId = resolvedAction.extensionId || resolvedAction.value;
                if (!extId) throw new Error('Extension ID required for installExtension action');
                
                let extension: any;
                // If it's a Chrome Store ID (32 chars)
                if (extId.length === 32 && /^[a-z]+$/.test(extId)) {
                    extension = await this.extensionManager.installFromChromeStore(extId);
                } else {
                    // Assume it's a local ID
                    extension = await this.extensionManager.getExtension(extId);
                    if (!extension) throw new Error(`Extension ${extId} not found`);
                }

                // Automatically link to profile if profileId is provided
                if (profileId && extension && extension.id) {
                    await this.extensionManager.assignToProfile(profileId, extension.id);
                    console.log(`[RPA] Extension ${extension.id} assigned to profile ${profileId}`);
                }

                return { installed: extId, assignedTo: profileId };

            default:
                throw new Error(`Unknown action type: ${resolvedAction.type}`);
        }
    }

    /**
     * Wait helper
     */
    private wait(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Move mouse humanly using Bezier curves
     */
    private async moveMouseHumanly(page: any, targetX: number, targetY: number): Promise<void> {
        const startX = this.lastMouseX;
        const startY = this.lastMouseY;

        const steps = 15 + Math.floor(Math.random() * 10);
        const points = this.generateBezierPoints(startX, startY, targetX, targetY, steps);

        for (const point of points) {
            await page.mouse.move(point.x, point.y);
            await this.wait(5 + Math.random() * 10);
        }

        this.lastMouseX = targetX;
        this.lastMouseY = targetY;
    }

    /**
     * Generate points along a quadratic Bezier curve with acceleration/deceleration
     */
    private generateBezierPoints(x1: number, y1: number, x2: number, y2: number, steps: number) {
        // More natural curve with dynamic control points
        const cx = (x1 + x2) / 2 + (Math.random() * 400 - 200);
        const cy = (y1 + y2) / 2 + (Math.random() * 400 - 200);

        const points = [];
        for (let i = 0; i <= steps; i++) {
            // Natural easing (Ease-In-Out)
            const t = this.easeInOutQuad(i / steps);
            const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
            const y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
            points.push({ x, y });
        }
        return points;
    }

    private easeInOutQuad(t: number): number {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    /**
     * Type text humanly with variations and pauses
     */
    private async typeHumanly(page: any, text: string): Promise<void> {
        for (const char of text) {
            // Random chance to make a "typo" (and then fix it)
            if (Math.random() > 0.98 && text.length > 3) {
                const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
                await page.keyboard.type(wrongChar, { delay: 50 + Math.random() * 100 });
                await this.wait(200 + Math.random() * 300);
                await page.keyboard.press('Backspace');
                await this.wait(100 + Math.random() * 200);
            }

            await page.keyboard.type(char, { delay: 40 + Math.random() * 160 });

            // Random long pauses between words or sentences
            if (char === ' ' && Math.random() > 0.8) {
                await this.wait(300 + Math.random() * 700);
            }
            if ((char === '.' || char === ',') && Math.random() > 0.5) {
                await this.wait(500 + Math.random() * 1000);
            }
        }
    }

    /**
     * Record actions from a page (simplified version)
     */
    async recordActions(page: any, duration: number = 60000): Promise<RPAAction[]> {
        // Inject recording script as string
        await page.evaluate(`
            window.__rpaActions = [];

            document.addEventListener('click', (e) => {
                const target = e.target;
                const selector = target.id ? '#' + target.id : target.className ? '.' + target.className.split(' ')[0] : target.tagName.toLowerCase();
                window.__rpaActions.push({
                    type: 'click',
                    selector: selector,
                    timestamp: Date.now()
                });
            });

            document.addEventListener('input', (e) => {
                const target = e.target;
                const selector = target.id ? '#' + target.id : target.name ? '[name="' + target.name + '"]' : 'input';
                window.__rpaActions.push({
                    type: 'type',
                    selector: selector,
                    value: target.value,
                    timestamp: Date.now()
                });
            });
        `);

        // Wait for recording duration
        await this.wait(duration);

        // Get recorded actions
        const recordedActions = await page.evaluate('window.__rpaActions || []');

        return recordedActions;
    }
}
