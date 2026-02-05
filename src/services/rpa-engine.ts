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

    /**
     * Resolve dynamic values like {{FILE:path|line:N}}, {{VAR:name}}, or {{name}}
     */
    private async resolveValue(value: string, executionVars: Record<string, string> = {}): Promise<string> {
        if (!value || typeof value !== 'string') return value;

        // Handle {{VAR:name}} and {{name}} (common Jarvis format)
        let resolved = value.replace(/\{\{(?:VAR:)?([^|{}]+)\}\}/g, (match, name) => {
            const cleanName = name.trim();
            // Don't match FILE: patterns here
            if (cleanName.startsWith('FILE:')) return match;
            return executionVars[cleanName] !== undefined ? executionVars[cleanName] : match;
        });

        // Handle {{FILE:path|line:N}} or {{FILE:path|line:INDEX}}
        const fileMatches = resolved.match(/\{\{FILE:([^|{}]+)(?:\|line:(\w+))?\}\}/g);
        if (fileMatches) {
            for (const match of fileMatches) {
                const parts = match.slice(7, -2).split('|');
                const filePath = parts[0];
                let lineIndex = 0;

                if (parts[1]) {
                    const linePart = parts[1].split(':')[1];
                    if (linePart === 'INDEX') {
                        lineIndex = parseInt(executionVars['INDEX'] || '0');
                    } else {
                        lineIndex = parseInt(linePart) || 0;
                    }
                }

                try {
                    const sanitizedPath = PathSanitizer.sanitize(filePath);
                    if (!sanitizedPath) {
                        console.error(`[Security] RPA blocked access to path: ${filePath}`);
                        resolved = resolved.replace(match, '');
                        continue;
                    }

                    let lines = this.fileCache.get(sanitizedPath);
                    if (!lines) {
                        const content = await fs.readFile(sanitizedPath, 'utf8');
                        lines = content.split(/\r?\n/).filter(line => line.trim());
                        this.fileCache.set(sanitizedPath, lines);
                    }
                    const lineValue = lines[lineIndex % lines.length] || '';
                    resolved = resolved.replace(match, lineValue);
                } catch (e) {
                    console.error(`Failed to read file for RPA: ${filePath}`, e);
                    resolved = resolved.replace(match, '');
                }
            }
        }

        return resolved;
    }

    /**
     * Execute scenario on a page
     */
    async executeScenario(
        page: any,
        scenario: RPAScenario,
        externalVars: Record<string, string> = {},
        profileId?: string
    ): Promise<{ success: boolean; results: any[]; errors: any[] }> {
        const results: any[] = [];
        const errors: any[] = [];
        const loops = scenario.loops || 1;
        const executionVars = { ...(scenario.variables || {}), ...externalVars };

        // Clear file cache at start of scenario
        this.fileCache.clear();

        for (let i = 0; i < loops; i++) {
            for (const action of scenario.actions) {
                try {
                    const result = await this.executeAction(page, action, executionVars, profileId);
                    results.push(result);
                } catch (e: any) {
                    errors.push({ action, error: e.message });
                    if (scenario.onError === 'stop') break;
                }
            }
            if (scenario.onError === 'stop' && errors.length > 0) break;
        }

        return { success: errors.length === 0, results, errors };
    }

    /**
     * Execute a single action
     */
    private async executeAction(page: any, action: RPAAction, executionVars: Record<string, string> = {}, profileId?: string): Promise<any> {
        // Resolve dynamic values in action properties
        const resolvedAction = { ...action };
        if (resolvedAction.selector) resolvedAction.selector = await this.resolveValue(resolvedAction.selector, executionVars);
        if (resolvedAction.text) resolvedAction.text = await this.resolveValue(resolvedAction.text, executionVars);
        if (resolvedAction.value) resolvedAction.value = await this.resolveValue(resolvedAction.value, executionVars);
        if (resolvedAction.url) resolvedAction.url = await this.resolveValue(resolvedAction.url, executionVars);

        try {
            return await this.performAction(page, resolvedAction, executionVars, profileId);
        } catch (error: any) {
            // AI Healing Logic
            if (this.jarvisService && resolvedAction.selector && !resolvedAction.healingAttempted) {
                console.log(`[RPA] Action ${resolvedAction.type} failed for ${resolvedAction.selector}. Attempting AI healing...`);
                
                try {
                    // Smart HTML Context capture: 
                    // 1. Try to find the closest parent that still exists
                    // 2. Extract interactive elements within that parent
                    // 3. Fallback to a broader but cleaned-up search
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
                        
                        // Walk backwards to find existing parent
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

                        // Get interactive elements in context
                        const interactive = Array.from(contextEl.querySelectorAll('button, input, a, [role="button"], select, [onclick]'))
                            .slice(0, 40) // Limit to avoid token bloat
                            .map(el => getCleanEl(el))
                            .join('\n');

                        return `Target Selector: ${sel}\nContext Parent: ${contextEl.tagName}\nInteractive Elements:\n${interactive}`;
                    }, resolvedAction.selector);

                    const newSelector = await this.jarvisService.healSelector(resolvedAction.selector, htmlContext, resolvedAction.type);
                    
                    if (newSelector && newSelector !== resolvedAction.selector) {
                        console.log(`[RPA] Jarvis found new selector: ${newSelector}. Retrying...`);
                        resolvedAction.selector = newSelector;
                        resolvedAction.healingAttempted = true;
                        return await this.performAction(page, resolvedAction, executionVars);
                    }
                } catch (healingError) {
                    console.error('[RPA] AI Healing failed:', healingError);
                }
            }
            throw error;
        }
    }

    private async performAction(page: any, resolvedAction: RPAAction, executionVars: Record<string, string>, profileId?: string): Promise<any> {
        switch (resolvedAction.type) {
            case 'click':
                if (!resolvedAction.selector) throw new Error('Selector required for click action');
                
                try {
                    const box = await page.$eval(resolvedAction.selector, (el: any) => {
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
                    await page.click(resolvedAction.selector);
                }
                return { clicked: resolvedAction.selector };

            case 'hover':
                if (!resolvedAction.selector) throw new Error('Selector required for hover action');
                try {
                    const box = await page.$eval(resolvedAction.selector, (el: any) => {
                        const { x, y, width, height } = el.getBoundingClientRect();
                        return { x, y, width, height };
                    });
                    const targetX = box.x + box.width / 2 + (Math.random() * 10 - 5);
                    const targetY = box.y + box.height / 2 + (Math.random() * 10 - 5);
                    await this.moveMouseHumanly(page, targetX, targetY);
                } catch (e) {
                    await page.hover(resolvedAction.selector);
                }
                return { hovered: resolvedAction.selector };

            case 'type':
                const textToType = resolvedAction.text || resolvedAction.value || resolvedAction.args?.text;
                const typeSelector = resolvedAction.selector || resolvedAction.args?.selector;
                if (!typeSelector || textToType === undefined) {
                    throw new Error('Selector and text/value required for type action');
                }
                
                await page.focus(typeSelector);
                await this.typeHumanly(page, String(textToType));
                return { typed: textToType, into: typeSelector };

            case 'pressKey':
            case 'keyPress':
                const keyToPress = resolvedAction.key || resolvedAction.value || resolvedAction.args?.key;
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
                if (resolvedAction.x !== undefined && resolvedAction.y !== undefined) {
                    await page.evaluate(`
                        window.scrollTo({
                            top: ${resolvedAction.y},
                            left: ${resolvedAction.x},
                            behavior: 'smooth'
                        })
                    `);
                } else if (resolvedAction.selector) {
                    await page.evaluate(`
                        const element = document.querySelector('${resolvedAction.selector}');
                        if (element) {
                            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    `);
                }
                await this.wait(1000 + Math.random() * 1000); // Wait for scroll to finish humanly
                return { scrolled: true };

            case 'wait':
                if (resolvedAction.selector) {
                    const timeout = resolvedAction.timeout || resolvedAction.ms || 30000;
                    await page.waitForSelector(resolvedAction.selector, { timeout });
                    return { waitedForSelector: resolvedAction.selector, timeout };
                }

                const waitTime = resolvedAction.ms || resolvedAction.delay || 1000;
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
                const rawFilename = resolvedAction.value || `screenshot-${Date.now()}.png`;
                const sanitizedFilename = PathSanitizer.sanitizeFilename(rawFilename);
                const screenshotPath = path.join(PathSanitizer.getProjectRoot(), '.screens', sanitizedFilename);
                
                // Ensure .screens exists
                await fs.mkdir(path.dirname(screenshotPath), { recursive: true }).catch(() => {});
                
                await page.screenshot({ path: screenshotPath });
                return { screenshot: sanitizedFilename };

            case 'navigate':
                const targetUrl = resolvedAction.url || resolvedAction.value;
                if (!targetUrl) throw new Error('URL required for navigate action');
                await page.goto(targetUrl, { waitUntil: 'networkidle2' });
                return { navigated: targetUrl };

            case 'select':
                if (!resolvedAction.selector || !resolvedAction.value) {
                    throw new Error('Selector and value required for select action');
                }
                await page.select(resolvedAction.selector, resolvedAction.value);
                return { selected: resolvedAction.value, in: resolvedAction.selector };

            case 'variable':
                const vName = resolvedAction.variableName || resolvedAction.variable;
                if (vName && resolvedAction.value !== undefined) {
                    executionVars[vName] = String(resolvedAction.value);
                    return { variableSet: vName };
                }
                return { error: 'Variable name and value required' };

            case 'getText':
                const getVarName = resolvedAction.variableName || resolvedAction.variable;
                if (!resolvedAction.selector || !getVarName) {
                    throw new Error('Selector and variableName required for getText action');
                }
                const text = await page.$eval(resolvedAction.selector, (el: any) => el.textContent || el.innerText || '');
                executionVars[getVarName] = text.trim();
                return { getText: text.trim(), into: getVarName };

            case 'writeFile':
                const filePath = resolvedAction.path || resolvedAction.value;
                const content = resolvedAction.content || resolvedAction.text || '';
                if (!filePath) throw new Error('Path required for writeFile action');
                
                const sanitizedWritePath = PathSanitizer.sanitize(filePath);
                if (!sanitizedWritePath) throw new Error(`Security block: Access to path ${filePath} is denied.`);
                
                // Ensure directory exists
                await fs.mkdir(path.dirname(sanitizedWritePath), { recursive: true }).catch(() => {});
                
                if (resolvedAction.append) {
                    await fs.appendFile(sanitizedWritePath, content, 'utf8');
                } else {
                    await fs.writeFile(sanitizedWritePath, content, 'utf8');
                }
                return { writeFile: sanitizedWritePath, appended: !!resolvedAction.append };

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
