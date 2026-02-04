import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    getApiPort: () => ipcRenderer.invoke('get-api-port'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    selectFile: () => ipcRenderer.invoke('select-file'),
    saveTempImage: (base64Data: string) => ipcRenderer.invoke('save-temp-image', base64Data),
    onBackendReady: (callback: (data: any) => void) => {
        ipcRenderer.on('backend-ready', (event, data) => callback(data));
    },
});

// Generic electron object for easier event handling in app.js
contextBridge.exposeInMainWorld('electron', {
    on: (channel: string, callback: (...args: any[]) => void) => {
        const validChannels = ['backend-ready', 'jarvis-status-update'];
        if (validChannels.includes(channel)) {
            // Filtering events to prevent security issues
            ipcRenderer.on(channel, (event, ...args) => callback(event, ...args));
        }
    },
    send: (channel: string, data: any) => {
        const validChannels = ['jarvis-command'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    selectFile: () => ipcRenderer.invoke('select-file'),
    saveTempImage: (base64Data: string) => ipcRenderer.invoke('save-temp-image', base64Data),
});
