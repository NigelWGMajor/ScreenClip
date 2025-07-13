const { contextBridge, ipcRenderer } = require('electron');

// Debug the preload script loading
console.log('Preload script loaded');

// Listen for IPC events directly in the preload script
ipcRenderer.on('toggle-border', () => {
    console.log('toggle-border event received in preload');
});

// Expose IPC events to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    onToggleBorder: (callback) => {
        console.log('Registering toggle-border handler in preload');
        ipcRenderer.on('toggle-border', (event, ...args) => {
            console.log('Event received in preload, forwarding to renderer');
            callback(event, ...args);
        });
    }
});