console.log('[Preload] START - Preload script is loading...');

const { contextBridge, ipcRenderer } = require('electron');

try {
  window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
  window.addEventListener(
    'keydown',
    (e) => {
      const key = String(e.key || '').toLowerCase();

      const blockedFnKeys = new Set(['f12', 'f11', 'printscreen']);
      if (blockedFnKeys.has(key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const isModifier = e.ctrlKey || e.metaKey;
      if (!isModifier) return;

      // Secure mode: block ALL Ctrl/Meta shortcuts.
      e.preventDefault();
      e.stopPropagation();
      return;
    },
    { capture: true }
  );
} catch (e) {
  // ignore
}

console.log('[Preload] Electron modules imported successfully');

let backendUrl;
try {
  backendUrl = ipcRenderer.sendSync('securePrintHub:getBackendUrlSync') || undefined;
  console.log('[Preload] Backend URL:', backendUrl);
} catch (err) {
  console.error('[Preload] Failed to get backend URL:', err);
  backendUrl = undefined;
}

const api = {
  backendUrl,
  openExternal: (url) => {
    console.log('[Preload] openExternal called with:', url);
    return ipcRenderer.invoke('securePrintHub:openExternal', url);
  },
  downloadPdf: (url) => {
    console.log('[Preload] downloadPdf called with:', url);
    return ipcRenderer.invoke('securePrintHub:downloadPdf', url);
  },
  openSystemSettings: (target) => {
    console.log('[Preload] openSystemSettings called with:', target);
    return ipcRenderer.invoke('securePrintHub:openSystemSettings', target);
  },
  getPrinters: () => {
    console.log('[Preload] getPrinters called');
    return ipcRenderer.invoke('securePrintHub:getPrinters');
  },
  getPrintersDetailed: () => {
    console.log('[Preload] getPrintersDetailed called');
    return ipcRenderer.invoke('securePrintHub:getPrintersDetailed');
  },
  getConnectivityState: () => {
    console.log('[Preload] getConnectivityState called');
    return ipcRenderer.invoke('securePrintHub:getConnectivityState');
  },
  onConnectivityChanged: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const wrapped = (_event, state) => {
      try {
        handler(state);
      } catch (err) {
        console.error('[Preload] onConnectivityChanged handler error:', err);
      }
    };
    ipcRenderer.on('connectivity:changed', wrapped);
    return () => {
      ipcRenderer.removeListener('connectivity:changed', wrapped);
    };
  },
  onPrintersChanged: (handler) => {
    if (typeof handler !== 'function') return () => {};

    const wrapped = (_event, printers) => {
      try {
        handler(printers);
      } catch (err) {
        console.error('[Preload] onPrintersChanged handler error:', err);
      }
    };

    ipcRenderer.on('printers:changed', wrapped);
    return () => {
      ipcRenderer.removeListener('printers:changed', wrapped);
    };
  },
  setJwt: (token) => ipcRenderer.invoke('securePrintHub:setJwt', { token }),
  prepareOfflinePrint: (params) => ipcRenderer.invoke('securePrintHub:prepareOfflinePrint', params),
  validateOfflinePrint: (params) => ipcRenderer.invoke('securePrintHub:validateOfflinePrint', params),
  markOfflinePrintUsed: (params) => ipcRenderer.invoke('securePrintHub:markOfflinePrintUsed', params),
  reconcileOfflineHistory: (params) => ipcRenderer.invoke('securePrintHub:reconcileOfflineHistory', params),
  listOfflineTokens: () => ipcRenderer.invoke('securePrintHub:listOfflineTokens'),
  silentPrintPdf: (params) => {
    console.log('[Preload] silentPrintPdf called with:', {
      url: params?.url,
      printerName: params?.printerName,
      printerKind: params?.printerKind,
    });
    return ipcRenderer.invoke('securePrintHub:silentPrintPdf', {
      url: params?.url,
      printerName: params?.printerName,
      printerKind: params?.printerKind,
    });
  },
  requestPrint: (params) => {
    console.log('[Preload] requestPrint called with:', {
      hasSessionToken: !!params?.sessionToken,
    });
    return ipcRenderer.invoke('securePrintHub:requestPrint', {
      sessionToken: params?.sessionToken,
      printerName: params?.printerName,
      copies: params?.copies,
      pageRange: params?.pageRange,
      orientation: params?.orientation,
      colorMode: params?.colorMode,
    });
  },
};

console.log('[Preload] About to expose API to window.securePrintHub');
try {
  contextBridge.exposeInMainWorld('securePrintHub', api);
  console.log('[Preload] securePrintHub API exposed successfully');
} catch (err) {
  console.error('[Preload] Failed to expose API:', err);
}

console.log('[Preload] END - Script execution completed');
