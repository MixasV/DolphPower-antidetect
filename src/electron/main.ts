import { app, BrowserWindow, ipcMain, globalShortcut, dialog } from 'electron';
import path from 'path';
import { createApp, startServer } from '../server/app';
import { initializeDatabase } from '../database/schema';
import axios from 'axios';

let mainWindow: BrowserWindow | null = null;
const API_PORT = 3001;

async function registerJarvisHotkeys() {
    // Ctrl+Space to Start/Pause recording
    globalShortcut.register('CommandOrControl+Space', async () => {
        console.log('[Hotkey] Ctrl+Space pressed - Jarvis Toggle Recording');
        try {
            const statusRes = await axios.get(`http://127.0.0.1:${API_PORT}/v1.0/jarvis/recorder/status`);
            const { is_recording, profile_id } = statusRes.data.data;

            if (is_recording) {
                // If already recording in the sense that the controller has a profileId, 
                // we need to check if it's currently capturing or paused.
                // However, the current API status returns jarvisController.isRecording() which is based on recordingProfileId.
                // Let's refine the status API or logic.
                // For now, if profile_id exists, we toggle pause/start.
                
                // We'll call a more detailed status
                const detailRes = await axios.get(`http://127.0.0.1:${API_PORT}/v1.0/jarvis/recorder/detailed-status`);
                const { isPaused } = detailRes.data.data;

                if (isPaused) {
                    await axios.post(`http://127.0.0.1:${API_PORT}/v1.0/jarvis/recorder/start`, { profile_id });
                    if (mainWindow) mainWindow.webContents.send('jarvis-status-update', { status: 'recording', profileId: profile_id });
                } else {
                    await axios.post(`http://127.0.0.1:${API_PORT}/v1.0/jarvis/recorder/pause`);
                    if (mainWindow) mainWindow.webContents.send('jarvis-status-update', { status: 'paused', profileId: profile_id });
                }
            } else {
                const profilesRes = await axios.get(`http://127.0.0.1:${API_PORT}/v1.0/browser_profiles/running/list`);
                const running = profilesRes.data.data.profiles;
                if (running.length > 0) {
                    const targetProfileId = running[0].profileId;
                    await axios.post(`http://127.0.0.1:${API_PORT}/v1.0/jarvis/recorder/start`, { profile_id: targetProfileId });
                    if (mainWindow) mainWindow.webContents.send('jarvis-status-update', { status: 'recording', profileId: targetProfileId });
                }
            }
        } catch (e) {
            console.error('Hotkey start error:', e);
        }
    });

    // Ctrl+Shift+Space to Finish recording
    globalShortcut.register('CommandOrControl+Shift+Space', async () => {
        console.log('[Hotkey] Ctrl+Shift+Space pressed - Jarvis Stop Recording');
        try {
            const res = await axios.post(`http://127.0.0.1:${API_PORT}/v1.0/jarvis/recorder/stop`);
            if (mainWindow) {
                mainWindow.webContents.send('jarvis-status-update', { 
                    status: 'finished', 
                    data: res.data.data 
                });
                // Bring main window to front to show the results
                mainWindow.show();
            }
        } catch (e) {
            console.error('Hotkey stop error:', e);
        }
    });
}

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        title: 'AntiDetect Browser',
    });

    // In development, load from localhost
    // In production, load from file
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

async function startBackend() {
    try {
        console.log('Starting backend API server...');

        // Initialize database
        const db = await initializeDatabase();

        // Create and start API server
        const expressApp = createApp(db);
        await startServer(expressApp, API_PORT);

        console.log(`✓ Backend started on port ${API_PORT}`);

        // Notify renderer when ready
        if (mainWindow) {
            mainWindow.webContents.send('backend-ready', { port: API_PORT });
        }

        return db;
    } catch (error) {
        console.error('Failed to start backend:', error);
        throw error;
    }
}

// App lifecycle
// Disable GPU hardware acceleration to prevent "GPU process exited unexpectedly" errors on some systems
app.disableHardwareAcceleration();

// Additional Chromium flags for stability
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');

app.whenReady().then(async () => {
    try {
        // Start backend first
        await startBackend();

        // Register hotkeys for Jarvis
        await registerJarvisHotkeys();

        // Then create window
        await createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    } catch (error) {
        console.error('Failed to initialize app:', error);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', async () => {
    console.log('Application shutting down...');
    // Cleanup will be handled by server shutdown handlers
});

// IPC handlers
ipcMain.handle('get-api-port', () => {
    return API_PORT;
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Text Files', extensions: ['txt', 'csv', 'json'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('save-temp-image', async (event, base64Data) => {
    try {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const { v4: uuidv4 } = require('uuid');

        const buffer = Buffer.from(base64Data.split(',')[1], 'base64');
        const tempDir = path.join(os.tmpdir(), 'dolfpower_screenshots');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const fileName = `screenshot_${Date.now()}_${uuidv4().substring(0, 8)}.png`;
        const filePath = path.join(tempDir, fileName);
        
        fs.writeFileSync(filePath, buffer);
        return filePath;
    } catch (e) {
        console.error('Failed to save temp image:', e);
        return null;
    }
});
