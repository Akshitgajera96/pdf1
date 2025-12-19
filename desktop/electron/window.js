const path = require('path');
const { BrowserWindow, app } = require('electron');

// Only require express in production (not needed for dev)
let express;
try {
  express = require('express');
} catch (e) {
  console.log('[Electron Window] Express not found, will use dev mode');
}

let prodServer;
let prodPort;

function isDev() {
  return process.env.ELECTRON_DEV === '1' || !!process.env.ELECTRON_RENDERER_URL;
}

function getDevBaseUrl() {
  return process.env.ELECTRON_RENDERER_URL || 'http://localhost:8081';
}

function getProdDistDir() {
  const packagedDir = path.join(process.resourcesPath, 'frontend-dist');
  return packagedDir;
}

function getProdIndexPath() {
  return path.join(getProdDistDir(), 'index.html');
}

function ensureProdServer() {
  if (prodServer && prodPort) return;

  if (!express) {
    throw new Error('Express is required for production mode but not available');
  }

  const distDir = getProdDistDir();
  const indexPath = getProdIndexPath();

  const srv = express();
  srv.disable('x-powered-by');
  srv.use(express.static(distDir, { index: false }));
  srv.get('*', (_req, res) => res.sendFile(indexPath));

  return new Promise((resolve, reject) => {
    prodServer = srv.listen(0, '127.0.0.1', () => {
      prodPort = prodServer.address().port;
      resolve();
    });
    prodServer.on('error', reject);
  });
}

async function createMainWindow() {
  const preloadPath = path.resolve(__dirname, 'preload.js');
  console.log('[Electron Window] Preload path:', preloadPath);
  console.log('[Electron Window] Preload exists:', require('fs').existsSync(preloadPath));
  
  const win = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    frame: false,
    resizable: false,
    width: 1280,
    height: 900,
    useContentSize: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      enableRemoteModule: false,
      devTools: false,
      sandbox: true,
      webSecurity: true,
      partition: 'nopersist:secure-print-hub',
      zoomFactor: 1,
    },
  });

  try {
    win.webContents.session.on('will-download', (e) => e.preventDefault());
  } catch (e) {
    // ignore
  }

  try {
    win.webContents.setZoomFactor(1);
    const p = win.webContents.setVisualZoomLevelLimits(1, 1);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {
    // ignore
  }

  win.once('ready-to-show', () => {
    console.log('[Electron Window] Ready to show, showing window');
    win.show();
    win.focus();
  });

  win.webContents.on('did-finish-load', () => {
    console.log('[Electron Window] Finished loading URL');
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Electron Window] Failed to load:', errorCode, errorDescription, validatedURL);
  });

  if (isDev()) {
    const url = getDevBaseUrl();
    console.log('[Electron Window] Loading dev URL:', url);
    await win.loadURL(url);
  } else {
    await ensureProdServer();
    const url = `http://127.0.0.1:${prodPort}`;
    console.log('[Electron Window] Loading prod URL:', url);
    await win.loadURL(url);
  }

  return win;
}

module.exports = { createMainWindow };
