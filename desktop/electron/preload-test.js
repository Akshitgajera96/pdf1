console.log('[TEST PRELOAD] LOADING!!!');

const { contextBridge, ipcRenderer } = require('electron');

console.log('[TEST PRELOAD] Electron modules loaded');

contextBridge.exposeInMainWorld('testAPI', {
  hello: () => 'Hello from preload!'
});

console.log('[TEST PRELOAD] API exposed');
