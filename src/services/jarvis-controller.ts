import { ChromiumManager } from './chromium-manager';
import { JarvisService } from './jarvis-service';
import * as fs from 'fs/promises';
import * as path from 'path';

export class JarvisController {
  private recordingProfileId: string | null = null;
  private chromiumManager: ChromiumManager;
  private jarvisService: JarvisService;

  constructor(chromiumManager: ChromiumManager, jarvisService: JarvisService) {
    this.chromiumManager = chromiumManager;
    this.jarvisService = jarvisService;
  }

  async startRecording(profileId: string) {
    if (!this.chromiumManager.isProfileRunning(profileId)) {
      throw new Error('Profile is not running');
    }

    const port = this.chromiumManager.getDevToolsPort(profileId);
    if (!port) throw new Error('Could not get DevTools port');

    this.recordingProfileId = profileId;

    // Resolve path for both dev (src/services) and prod (dist/services)
    let recorderScriptPath = path.join(__dirname, '../../resources/jarvis-recorder.js');
    
    // Check if we are in dist
    try {
        await fs.access(recorderScriptPath);
    } catch (e) {
        // Fallback for different build structures if needed
        recorderScriptPath = path.join(process.cwd(), 'resources', 'jarvis-recorder.js');
    }

    const recorderScript = await fs.readFile(recorderScriptPath, 'utf8');

    // Inject recorder into the page via CDP
    const CDP = require('chrome-remote-interface');
    const client = await CDP({ port });
    const { Runtime } = client;

    try {
      await Runtime.evaluate({ expression: recorderScript });
      await Runtime.evaluate({ expression: 'window.__dolfJarvisRecorder.start();' });
      console.log(`[Jarvis] Started/Resumed recording on profile ${profileId}`);
    } finally {
      await client.close();
    }
  }

  async injectOverlay(profileId: string, sessionId?: string) {
    if (!this.chromiumManager.isProfileRunning(profileId)) return;

    const port = this.chromiumManager.getDevToolsPort(profileId);
    if (!port) return;

    let overlayScriptPath = path.join(__dirname, '../../resources/jarvis-overlay.js');
    try {
        await fs.access(overlayScriptPath);
    } catch (e) {
        overlayScriptPath = path.join(process.cwd(), 'resources', 'jarvis-overlay.js');
    }

    let overlayScript = await fs.readFile(overlayScriptPath, 'utf8');
    
    if (sessionId) {
        overlayScript += `\nwindow.__dolfJarvisSessionId = "${sessionId}";`;
    }

    const CDP = require('chrome-remote-interface');
    const client = await CDP({ port });
    const { Runtime } = client;

    try {
      await Runtime.evaluate({ expression: overlayScript });
      console.log(`[Jarvis] Injected Overlay to profile ${profileId} (Session: ${sessionId || 'none'})`);
    } catch (e: any) {
      console.error(`[Jarvis] Failed to inject overlay: ${e.message}`);
    } finally {
      await client.close();
    }
  }

  async pauseRecording() {
    if (!this.recordingProfileId) return;

    const port = this.chromiumManager.getDevToolsPort(this.recordingProfileId);
    if (!port) return;

    const CDP = require('chrome-remote-interface');
    const client = await CDP({ port });
    const { Runtime } = client;

    try {
      await Runtime.evaluate({ expression: 'window.__dolfJarvisRecorder.pause();' });
      console.log(`[Jarvis] Paused recording on profile ${this.recordingProfileId}`);
    } finally {
      await client.close();
    }
  }

  async getRecordingStatus(): Promise<{ isRecording: boolean, isPaused: boolean }> {
    if (!this.recordingProfileId) return { isRecording: false, isPaused: false };

    const port = this.chromiumManager.getDevToolsPort(this.recordingProfileId);
    if (!port) return { isRecording: false, isPaused: false };

    const CDP = require('chrome-remote-interface');
    const client = await CDP({ port });
    const { Runtime } = client;

    try {
        const result = await Runtime.evaluate({ 
            expression: 'window.__dolfJarvisRecorder.isRecording();',
            returnByValue: true 
        });
        const isRecording = result.result.value;
        return { isRecording: true, isPaused: !isRecording };
    } catch (e) {
        return { isRecording: false, isPaused: false };
    } finally {
        await client.close();
    }
  }

  async stopRecording(): Promise<any[]> {
    if (!this.recordingProfileId) return [];

    const profileId = this.recordingProfileId;
    const port = this.chromiumManager.getDevToolsPort(profileId);
    if (!port) return [];

    const CDP = require('chrome-remote-interface');
    const client = await CDP({ port });
    const { Runtime } = client;

    try {
      const result = await Runtime.evaluate({ 
        expression: 'window.__dolfJarvisRecorder.stop();',
        returnByValue: true 
      });
      
      this.recordingProfileId = null;
      console.log(`[Jarvis] Stopped recording on profile ${profileId}`);
      return result.result.value || [];
    } catch (e) {
      console.error('Failed to stop recording:', e);
      return [];
    } finally {
      await client.close();
    }
  }

  isRecording(): boolean {
    return this.recordingProfileId !== null;
  }

  getRecordingProfileId(): string | null {
    return this.recordingProfileId;
  }
}
