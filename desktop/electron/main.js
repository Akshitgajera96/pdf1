const { app, ipcMain, shell, BrowserWindow, safeStorage, session, protocol } = require('electron');
const { createMainWindow } = require('./window');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

try {
  // Must run before app is ready. Ensures Chromium treats the custom scheme as a standard, secure scheme.
  // Without this, loading PDFs via secureprint:// can hang or fail unexpectedly.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'secureprint',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        allowServiceWorkers: false,
      },
    },
  ]);
} catch {
  // ignore
}

try {
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
} catch (e) {
  // ignore
}

const extractString = (v) => (typeof v === 'string' ? v : '');

let mainWindow = null;

let printerPollTimer = null;
let lastPrinterSnapshot = '[]';

let connectivityPollTimer = null;
let lastConnectivityState = 'UNKNOWN';
let currentJwt = null;

const printerDriverCache = new Map();

const inMemoryPdfStore = new Map();
let inMemoryPdfProtocolRegistered = false;

function ensureInMemoryPdfProtocol() {
  if (inMemoryPdfProtocolRegistered) return;
  inMemoryPdfProtocolRegistered = true;

  try {
    protocol.registerBufferProtocol('secureprint', (request, callback) => {
      try {
        const u = new URL(request.url);
        if (u.hostname !== 'pdf') {
          callback({ statusCode: 404, data: Buffer.from('Not found') });
          return;
        }

        const key = String(u.pathname || '').replace(/^\/+/, '');
        const buf = inMemoryPdfStore.get(key);
        if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
          callback({ statusCode: 404, data: Buffer.from('Not found') });
          return;
        }

        const headersIn = request?.headers || {};
        const rangeHeader = headersIn?.Range || headersIn?.range;
        if (typeof rangeHeader === 'string') {
          const m = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader.trim());
          if (m) {
            const start = Number(m[1]);
            const endRaw = m[2] ? Number(m[2]) : NaN;
            const end = Number.isFinite(endRaw) ? Math.min(endRaw, buf.length - 1) : buf.length - 1;
            if (Number.isFinite(start) && start >= 0 && start < buf.length && end >= start) {
              const chunk = buf.subarray(start, end + 1);
              callback({
                statusCode: 206,
                mimeType: 'application/pdf',
                data: chunk,
                headers: {
                  'Accept-Ranges': 'bytes',
                  'Content-Range': `bytes ${start}-${end}/${buf.length}`,
                  'Content-Length': String(chunk.length),
                },
              });
              return;
            }
          }
        }

        callback({
          statusCode: 200,
          mimeType: 'application/pdf',
          data: buf,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': String(buf.length),
          },
        });
      } catch {
        try {
          callback({ statusCode: 400, data: Buffer.from('Bad request') });
        } catch {
          // ignore
        }
      }
    });
  } catch (e) {
    console.error('[Electron Main] Failed to register secureprint protocol:', e);
  }
}

function getBackendBaseUrl() {
  const raw = process.env.ELECTRON_BACKEND_URL || process.env.VITE_API_BASE_URL;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed) return trimmed;

  return 'https://pdf1-backend.onrender.com';
}

// Offline cache utilities
function getMachineGuid() {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      '(Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Cryptography").MachineGuid'
    ]);
    let stdout = '';
    ps.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    ps.on('close', (code) => {
      const guid = stdout.trim();
      if (guid && /^[0-9a-f-]{36}$/i.test(guid)) resolve(guid);
      else reject(new Error('Failed to read MachineGuid'));
    });
    ps.on('error', reject);
  });
}

function hashMachineGuid(guid) {
  return crypto.createHash('sha256').update(guid).digest('hex');
}

function getEncryptionKey() {
  const keyPath = path.join(app.getPath('userData'), 'offline.key');
  let key;
  try {
    if (fs.existsSync(keyPath)) {
      const encrypted = fs.readFileSync(keyPath);
      if (safeStorage.isEncryptionAvailable()) {
        key = safeStorage.decryptString(encrypted);
      } else {
        console.warn('[Electron] safeStorage unavailable; using plaintext key (development only)');
        key = encrypted.toString();
      }
    } else {
      key = crypto.randomBytes(32).toString('hex');
      let encrypted;
      if (safeStorage.isEncryptionAvailable()) {
        encrypted = safeStorage.encryptString(key);
      } else {
        console.warn('[Electron] safeStorage unavailable; storing plaintext key (development only)');
        encrypted = Buffer.from(key);
      }
      fs.writeFileSync(keyPath, encrypted);
    }
  } catch (err) {
    console.error('[Electron] Failed to get/create encryption key:', err);
    throw err;
  }
  return Buffer.from(key, 'hex');
}

function encryptData(data, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

function classifyPrinterKind(deviceId, portName) {
  const hay = `${deviceId || ''} ${portName || ''}`;
  if (/(USB|DOT4|LPT|COM)/i.test(hay)) return 'USB_LOCAL';
  return 'NETWORK_WIFI';
}

function decryptData(encrypted, key) {
  const iv = encrypted.slice(0, 16);
  const ciphertext = encrypted.slice(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted;
}

async function downloadPdfToBuffer(url) {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;

  let reqRef = null;

  const res = await new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search || ''}`,
        headers: {
          ...(typeof currentJwt === 'string' && currentJwt.trim()
            ? { Authorization: `Bearer ${currentJwt.trim()}` }
            : {}),
        },
        timeout: 20000,
      },
      (res) => {
        resolve(res);
      }
    );

    reqRef = req;

    req.on('timeout', () => {
      req.destroy(new Error('PDF download timeout'));
    });
    req.on('error', reject);
    req.end();
  });

  if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    res.resume();
    return downloadPdfToBuffer(new URL(res.headers.location, url).toString());
  }

  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`PDF download failed: HTTP ${res.statusCode}`);
  }

  const overallTimeoutMs = 25_000;
  const idleTimeoutMs = 10_000;

  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let finished = false;

    const cleanup = () => {
      try {
        res.removeAllListeners('data');
        res.removeAllListeners('end');
        res.removeAllListeners('error');
        res.removeAllListeners('aborted');
      } catch {
        // ignore
      }
    };

    const fail = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(overallTimer);
      clearTimeout(idleTimer);
      cleanup();
      try {
        if (reqRef) reqRef.destroy(err);
      } catch {
        // ignore
      }
      try {
        res.destroy(err);
      } catch {
        // ignore
      }
      reject(err);
    };

    const overallTimer = setTimeout(() => {
      fail(new Error('PDF download timeout'));
    }, overallTimeoutMs);

    let idleTimer = setTimeout(() => {
      fail(new Error('PDF download stalled'));
    }, idleTimeoutMs);

    const bumpIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail(new Error('PDF download stalled'));
      }, idleTimeoutMs);
    };

    res.on('data', (chunk) => {
      try {
        bumpIdle();
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(b);
        total += b.length;
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    });

    res.on('aborted', () => fail(new Error('PDF download aborted')));
    res.on('error', (e) => fail(e instanceof Error ? e : new Error(String(e))));

    res.on('end', () => {
      if (finished) return;
      finished = true;
      clearTimeout(overallTimer);
      clearTimeout(idleTimer);
      cleanup();
      const out = Buffer.concat(chunks, total);
      if (!out.length) {
        reject(new Error('PDF download failed: empty body'));
        return;
      }
      resolve(out);
    });
  });

  return { buffer, size: buffer.length };
}

const OFFLINE_DB_PATH = path.join(app.getPath('userData'), 'offline-tokens.json');
function loadOfflineDb() {
  try {
    if (!fs.existsSync(OFFLINE_DB_PATH)) return [];
    const encrypted = fs.readFileSync(OFFLINE_DB_PATH);
    const key = getEncryptionKey();
    const json = decryptData(encrypted, key).toString();
    return JSON.parse(json);
  } catch (err) {
    console.error('[Electron] Failed to load offline DB:', err);
    return [];
  }
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function getWindowsPrinterDriverName(printerName) {
  try {
    if (!printerName || typeof printerName !== 'string') return Promise.resolve(null);
    if (printerDriverCache.has(printerName)) {
      return Promise.resolve(printerDriverCache.get(printerName) || null);
    }

    return new Promise((resolve) => {
      const safeName = escapePowerShellString(printerName);
      // Prefer Get-Printer when available, otherwise fall back to Win32_Printer (works on more systems).
      const cmd =
        `try { (Get-Printer -Name '${safeName}' | Select-Object -ExpandProperty DriverName) } catch { '' }` +
        `; ` +
        `if (-not $?) { '' }` +
        `; ` +
        `if (-not $LASTEXITCODE) { }` +
        `; ` +
        `if (-not $output) { }`;

      // Use a second command via Win32_Printer if the first yields empty output.
      const cmd2 =
        `try { (Get-CimInstance Win32_Printer -Filter "Name='${safeName}'" | Select-Object -ExpandProperty DriverName) } catch { '' }`;
      const ps = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], {
        windowsHide: true,
      });

      let stdout = '';
      ps.stdout.on('data', (d) => {
        stdout += d.toString();
      });

      ps.on('close', () => {
        const name1 = stdout.trim();
        if (name1) {
          printerDriverCache.set(printerName, name1);
          resolve(name1);
          return;
        }

        // Fallback
        const ps2 = spawn('powershell.exe', ['-NoProfile', '-Command', cmd2], { windowsHide: true });
        let stdout2 = '';
        ps2.stdout.on('data', (d) => {
          stdout2 += d.toString();
        });
        ps2.on('close', () => {
          const name2 = stdout2.trim();
          const normalized = name2 ? name2 : null;
          printerDriverCache.set(printerName, normalized);
          resolve(normalized);
        });
        ps2.on('error', () => {
          printerDriverCache.set(printerName, null);
          resolve(null);
        });
      });

      ps.on('error', () => {
        printerDriverCache.set(printerName, null);
        resolve(null);
      });
    });
  } catch {
    return Promise.resolve(null);
  }
}
function saveOfflineDb(db) {
  try {
    const key = getEncryptionKey();
    const json = JSON.stringify(db, null, 2);
    const encrypted = encryptData(Buffer.from(json), key);
    fs.writeFileSync(OFFLINE_DB_PATH, encrypted);
  } catch (err) {
    console.error('[Electron] Failed to save offline DB:', err);
  }
}
function getCachedFilePath(tokenId) {
  return path.join(app.getPath('userData'), `cached-${tokenId}.pdf`);
}

function stopConnectivityPolling() {
  if (connectivityPollTimer) {
    clearInterval(connectivityPollTimer);
    connectivityPollTimer = null;
  }
}

function emitConnectivity(state) {
  if (state === lastConnectivityState) return;
  lastConnectivityState = state;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connectivity:changed', { state });
  }
}

function probeHealthOnce() {
  return new Promise((resolve) => {
    try {
      const base = getBackendBaseUrl();
      const url = new URL('/api/health', base);
      const lib = url.protocol === 'https:' ? https : http;

      const req = lib.request(
        {
          method: 'GET',
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          timeout: 3000,
        },
        (res) => {
          // Any 2xx => ONLINE; other statuses => DEGRADED
          const code = res.statusCode || 0;
          res.resume();
          if (code >= 200 && code < 300) resolve('ONLINE');
          else resolve('DEGRADED');
        }
      );

      req.on('timeout', () => {
        try {
          req.destroy();
        } catch (_) {
          // ignore
        }
        resolve('OFFLINE');
      });

      req.on('error', () => resolve('OFFLINE'));
      req.end();
    } catch (_err) {
      resolve('OFFLINE');
    }
  });
}

function startConnectivityPolling() {
  stopConnectivityPolling();
  connectivityPollTimer = setInterval(async () => {
    try {
      const state = await probeHealthOnce();
      emitConnectivity(state);
    } catch (err) {
      console.error('[Electron Main] Connectivity polling error:', err);
      emitConnectivity('OFFLINE');
    }
  }, 5000);

  // Immediate probe
  probeHealthOnce().then(emitConnectivity).catch(() => emitConnectivity('OFFLINE'));
}

// Global error handlers for debugging
process.on('uncaughtException', (error) => {
  console.error('[Electron Main] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Electron Main] Unhandled Rejection at:', promise, 'reason:', reason);
});

app.whenReady().then(async () => {
  try {
    console.log('[Electron Main] Creating main window...');

    try {
      session.defaultSession.on('will-download', (e) => {
        e.preventDefault();
      });
    } catch (e) {
      // ignore
    }

    ensureInMemoryPdfProtocol();

    mainWindow = await createMainWindow();
    console.log('[Electron Main] Main window created successfully');

    // Ensure renderer can immediately gate printing based on real connectivity.
    // One-shot probe (no polling loop).
    try {
      probeHealthOnce().then(emitConnectivity).catch(() => emitConnectivity('OFFLINE'));
    } catch {
      emitConnectivity('OFFLINE');
    }

    try {
      mainWindow.setContentProtection(true);
    } catch (e) {
      // ignore
    }

    mainWindow.on('closed', () => {
      console.log('[Electron Main] Window closed');
      mainWindow = null;
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error('[Electron Main] Failed to load:', errorCode, errorDescription, validatedURL);
    });

    mainWindow.webContents.on('render-process-gone', (event, details) => {
      console.error('[Electron Main] Render process gone:', details);
    });

    mainWindow.on('unresponsive', () => {
      console.error('[Electron Main] Window became unresponsive');
    });

    mainWindow.on('responsive', () => {
      console.log('[Electron Main] Window became responsive again');
    });

    // Secure print-only mode: avoid polling loops/background renders.

  } catch (error) {
    console.error('[Electron Main] Failed to create main window:', error);
    app.quit();
  }
});

ipcMain.handle('securePrintHub:requestPrint', async (event, params) => {
  try {
    const sessionToken = typeof params?.sessionToken === 'string' ? params.sessionToken : null;
    if (!sessionToken || typeof sessionToken !== 'string') {
      return { success: false, error: 'Missing sessionToken' };
    }

    const printerNameFromUi = typeof params?.printerName === 'string' && params.printerName.trim()
      ? params.printerName.trim()
      : null;
    const copiesFromUi = typeof params?.copies === 'number' ? params.copies : undefined;
    const pageRangeFromUi = typeof params?.pageRange === 'string' ? params.pageRange : undefined;
    const orientationFromUi = params?.orientation === 'landscape' || params?.orientation === 'portrait'
      ? params.orientation
      : undefined;
    const colorModeFromUi = params?.colorMode === 'color' || params?.colorMode === 'grayscale'
      ? params.colorMode
      : undefined;

    if (!currentJwt || typeof currentJwt !== 'string' || !currentJwt.trim()) {
      return { success: false, error: 'Not authenticated (missing JWT)' };
    }

    const base = getBackendBaseUrl();

    const printIntentRes = await requestJson(new URL('/api/docs/secure-print', base).toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentJwt.trim()}` },
      body: { sessionToken },
      timeoutMs: 15000,
    });

    if (!printIntentRes || printIntentRes.statusCode !== 200) {
      const msg =
        typeof printIntentRes?.data?.message === 'string'
          ? printIntentRes.data.message
          : `Print intent failed (HTTP ${printIntentRes?.statusCode || '0'})`;
      return { success: false, error: msg };
    }

    const printToken = printIntentRes.data?.printToken;
    const printUrlPath = printIntentRes.data?.printUrlPath;
    if (!printToken || !printUrlPath) {
      return { success: false, error: 'Print intent response missing token/path' };
    }

    const fullPrintUrl = new URL(printUrlPath, base).toString();

    const preferredPrinterNameRaw = process.env.SECURE_PRINT_PRINTER_NAME;
    const preferredPrinterName =
      typeof preferredPrinterNameRaw === 'string' && preferredPrinterNameRaw.trim()
        ? preferredPrinterNameRaw.trim()
        : null;

    const choice = printerNameFromUi
      ? { name: printerNameFromUi, printerKind: 'NETWORK_WIFI' }
      : preferredPrinterName
        ? { name: preferredPrinterName, printerKind: 'USB_LOCAL' }
        : pickDefaultPrinter(event?.sender);

    if (!choice?.name) {
      return { success: false, error: 'No printers available' };
    }

    const printResult = await silentPrintPdfImpl(event, {
      url: fullPrintUrl,
      printerName: choice.name,
      printerKind: choice.printerKind || 'NETWORK_WIFI',
      copies: copiesFromUi,
      pageRange: pageRangeFromUi,
      orientation: orientationFromUi,
      colorMode: colorModeFromUi,
    });

    if (!printResult || printResult.success !== true) {
      const msg = typeof printResult?.error === 'string' ? printResult.error : 'Print failed';
      return { success: false, error: msg };
    }

    const confirmRes = await requestJson(new URL('/api/docs/print-confirm', base).toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentJwt.trim()}` },
      body: {
        printToken,
        printerName: choice.name,
        printerType: null,
        portName: null,
        clientOS: os.platform(),
      },
      timeoutMs: 15000,
    }).catch((e) => ({ statusCode: 0, data: { message: e?.message || String(e) } }));

    if (!confirmRes || confirmRes.statusCode !== 200) {
      const msg =
        typeof confirmRes?.data?.message === 'string'
          ? confirmRes.data.message
          : `Print confirm failed (HTTP ${confirmRes?.statusCode || '0'})`;
      return { success: false, error: msg };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
});

async function silentPrintPdfImpl(event, { url, printerName, printerKind, copies, pageRange, orientation, colorMode }) {
  let pdfSize;
  let inMemoryKey = null;
  let printWindow = null;
  try {
    ensureInMemoryPdfProtocol();

    if (!url || typeof url !== 'string') {
      throw new Error('Missing PDF URL');
    }

    if (!printerName || typeof printerName !== 'string') {
      throw new Error('Missing printer name');
    }

    const kind = printerKind === 'USB_LOCAL' ? 'USB_LOCAL' : 'NETWORK_WIFI';
    const isSilent = true;

    const jobId = `print-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const logStep = (step, extra) => {
      try {
        console.log(`[print] ${step}`, {
          jobId,
          printerName,
          printerKind: kind,
          silent: isSilent,
          ...(extra && typeof extra === 'object' ? extra : {}),
        });
      } catch {
        // ignore
      }
    };

    let driverName = getPrinterDriverNameFromSender(event?.sender, printerName);
    if (!driverName) {
      logPrinterDriverDiagnostics(event?.sender, printerName);
      driverName = await getWindowsPrinterDriverName(printerName);
    }

    logStep('request', { driverName });

    const isHttpUrl = /^https?:\/\//i.test(url);
    if (!isHttpUrl) {
      throw new Error('Only remote print URLs are allowed');
    }

    const downloaded = await downloadPdfToBuffer(url);
    const pdfBuffer = downloaded.buffer;
    pdfSize = downloaded.size;
    inMemoryKey = crypto.randomBytes(16).toString('hex');
    inMemoryPdfStore.set(inMemoryKey, pdfBuffer);

    logStep('file_ready', { sizeBytes: pdfSize, driverName });

    // Create an offscreen window to load the PDF and send it to the printer silently.
    // This relies on the printer being installed in Windows (USB/Wi‑Fi/Bluetooth).
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      autoHideMenuBar: true,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      modal: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
        webSecurity: true,
      },
    });

    printWindow = win;

    try {
      win.setContentProtection(true);
    } catch {
      // ignore
    }

    logStep('window_created', {
      show: false,
    });

    try {
      // Best-effort: block certain keys from affecting the renderer while dialog is up.
      // Note: native print dialog may not emit these as before-input-event.
      win.webContents.on('before-input-event', (e, input) => {
        const key = String(input?.key || '').toLowerCase();
        if (key === 'escape' || (input?.alt && key === 'f4')) {
          e.preventDefault();
        }
      });
    } catch {
      // ignore
    }

    const cleanup = () => {
      if (inMemoryKey) {
        const buf = inMemoryPdfStore.get(inMemoryKey);
        if (buf && Buffer.isBuffer(buf)) {
          try {
            buf.fill(0);
          } catch {
            // ignore
          }
        }
        inMemoryPdfStore.delete(inMemoryKey);
        inMemoryKey = null;
      }
      if (!win.isDestroyed()) {
        win.destroy();
      }
    };

    // Ensure we cleanup on unexpected crash
    win.webContents.once('render-process-gone', cleanup);

    win.webContents.on('did-start-loading', () => {
      logStep('did_start_loading', { currentUrl: win.webContents.getURL() });
    });
    win.webContents.on('did-stop-loading', () => {
      logStep('did_stop_loading', { currentUrl: win.webContents.getURL() });
    });
    win.webContents.on('did-finish-load', () => {
      logStep('did_finish_load', { currentUrl: win.webContents.getURL() });
    });
    win.webContents.on('did-fail-load', (_event2, errorCode, errorDescription, validatedURL) => {
      logStep('did_fail_load', { errorCode, errorDescription, validatedURL });
    });
    win.on('unresponsive', () => {
      logStep('window_unresponsive', {});
    });
    win.webContents.on('render-process-gone', (_event2, details) => {
      logStep('render_process_gone', details || {});
    });

    const fileUrl = `secureprint://pdf/${inMemoryKey}`;
    const loadStart = Date.now();
    logStep('load_start', { localFilePath: null, sizeBytes: pdfSize });
    try {
      const loadTimeoutMs = 15_000;
      await Promise.race([
        win.loadURL(fileUrl),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`PDF load timeout after ${loadTimeoutMs}ms`)), loadTimeoutMs)
        ),
      ]);
      logStep('load_ok', { ms: Date.now() - loadStart });
    } catch (err) {
      try {
        win.webContents.stop();
      } catch {
        // ignore
      }
      logStep('load_error', { ms: Date.now() - loadStart, error: err?.message || String(err) });
      throw err;
    }

    // Never show the print window in secure mode.

    // Wait for PDF viewer to finish loading
    const loadWaitStart = Date.now();
    const loadWaitTimeoutMs = 5000;
    await Promise.race([
      new Promise((resolve) => {
        try {
          if (win.webContents.isLoading()) {
            win.webContents.once('did-finish-load', resolve);
          } else {
            resolve();
          }
        } catch {
          resolve();
        }
      }),
      new Promise((resolve) => setTimeout(resolve, loadWaitTimeoutMs)),
    ]);
    logStep('load_wait_complete', {
      currentUrl: (() => {
        try {
          return win.webContents.getURL();
        } catch {
          return null;
        }
      })(),
      ms: Date.now() - loadWaitStart,
      stillLoading: (() => {
        try {
          return win.webContents.isLoading();
        } catch {
          return null;
        }
      })(),
    });
    await new Promise((r) => setTimeout(r, 750));
    logStep('post_load_delay_done', {});

    const safeCopies = typeof copies === 'number' && Number.isFinite(copies) && copies > 0 ? Math.floor(copies) : undefined;
    const landscape = orientation === 'landscape';
    const color = colorMode === 'grayscale' ? false : true;
    const parsedRanges = parsePageRanges(pageRange);

    const printOptions = {
      silent: true,
      printBackground: true,
      deviceName: printerName,
      ...(typeof safeCopies === 'number' ? { copies: safeCopies } : {}),
      ...(Array.isArray(parsedRanges) && parsedRanges.length > 0 ? { pageRanges: parsedRanges } : {}),
      ...(landscape ? { landscape: true } : {}),
      ...(color === false ? { color: false } : {}),
    };

    const runPrintAttempt = async (attemptLabel, opts) => {
      logStep('print_invoke', { attempt: attemptLabel, printOptions: { ...opts } });

      return await new Promise((resolve, reject) => {
        let finished = false;
        const timeoutMs = 45_000;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          logStep('print_timeout', {
            attempt: attemptLabel,
            timeoutMs,
            currentUrl: (() => {
              try {
                return win.webContents.getURL();
              } catch {
                return null;
              }
            })(),
            isLoading: (() => {
              try {
                return win.webContents.isLoading();
              } catch {
                return null;
              }
            })(),
            windowDestroyed: win.isDestroyed(),
            filePath: null,
            fileSize: typeof pdfSize === 'number' ? pdfSize : null,
            driverName,
          });
          reject(new Error(`Print callback timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        try {
          win.webContents.print(opts, (success, failureReason) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);

            logStep('print_callback', {
              attempt: attemptLabel,
              success: !!success,
              failureReason: failureReason || null,
              driverName,
              filePath: null,
              fileSize: typeof pdfSize === 'number' ? pdfSize : null,
            });

            if (!success) {
              logStep('print_failed', {
                attempt: attemptLabel,
                driverName,
                filePath: null,
                fileSize: typeof pdfSize === 'number' ? pdfSize : null,
                error: failureReason || 'Print failed',
              });
              reject(new Error(failureReason || 'Print failed'));
              return;
            }

            resolve(true);
          });
        } catch (err) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          logStep('print_throw', { attempt: attemptLabel, error: err?.message || String(err) });
          reject(err);
        }
      });
    };

    const ok = await runPrintAttempt('silent', printOptions);

    cleanup();

    return { success: true, message: 'Print job sent', ok };
  } catch (error) {
    try {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.destroy();
      }
    } catch {
      // ignore
    }
    if (inMemoryKey) {
      const buf = inMemoryPdfStore.get(inMemoryKey);
      if (buf && Buffer.isBuffer(buf)) {
        try {
          buf.fill(0);
        } catch {
          // ignore
        }
      }
      inMemoryPdfStore.delete(inMemoryKey);
      inMemoryKey = null;
    }
    try {
      const msg = error?.message || String(error);
      console.error('[print] handler_failed', {
        printerName,
        filePath: null,
        fileSize: typeof pdfSize === 'number' ? pdfSize : null,
        error: msg,
      });
    } catch {
      // ignore
    }
    return { success: false, error: error?.message || String(error) };
  }
}

app.on('window-all-closed', () => {
  console.log('[Electron Main] All windows closed, quitting app');
  stopPrinterPolling();
  stopConnectivityPolling();
  app.quit();
});

function stopPrinterPolling() {
  if (printerPollTimer) {
    clearInterval(printerPollTimer);
    printerPollTimer = null;
  }
}

function startPrinterPolling() {
  stopPrinterPolling();
  // Poll OS printers periodically to detect add/remove/change.
  printerPollTimer = setInterval(async () => {
    try {
      const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
      const printers = await getNormalizedPrinters(wc);
      const stable = printers
        .slice()
        .sort((a, b) => String(a.displayName || a.name).localeCompare(String(b.displayName || b.name)));
      const snapshot = JSON.stringify(stable);
      if (snapshot !== lastPrinterSnapshot) {
        lastPrinterSnapshot = snapshot;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('printers:changed', stable);
        }
      }
    } catch (err) {
      // Fail-safe: never crash the app due to printer polling.
      console.error('[Electron Main] Printer polling error:', err);
    }
  }, 5000);
}

function runPowerShellJson(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `PowerShell exited with code ${code}`));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve([]);
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch (e) {
        reject(new Error(`Failed to parse PowerShell JSON: ${e.message}`));
      }
    });
  });
}

function detectConnectionType(portName) {
  const pn = typeof portName === 'string' ? portName.trim().toLowerCase() : '';
  if (!pn) return 'LAN';
  if (pn.startsWith('usb')) return 'USB';
  if (pn.startsWith('bth') || pn.includes('bluetooth')) return 'BLUETOOTH';
  // Many Windows network printers use IP_ / WSD / TCP ports; treat as LAN by default.
  // Some drivers include wifi/wlan in port names; classify those as WIFI.
  if (pn.includes('wifi') || pn.includes('wlan')) return 'WIFI';
  if (pn.startsWith('ip_') || pn.includes('tcp') || pn.startsWith('wsd')) return 'LAN';
  return 'LAN';
}

async function getWindowsPrintersDetailed() {
  // Use Win32_Printer (WMI) for details not available via Electron.
  // ConvertTo-Json may output a single object instead of array; normalize.
  const ps = `
$ErrorActionPreference = 'Stop';
$printers = Get-CimInstance -ClassName Win32_Printer |
  Select-Object Name, DeviceID, PortName, Default, WorkOffline, PrinterStatus, DriverName;
$printers | ConvertTo-Json -Depth 4
`;
  const raw = await runPowerShellJson(ps);
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return list.map((p) => {
    const name = typeof p?.Name === 'string' ? p.Name : '';
    const deviceId = typeof p?.DeviceID === 'string' ? p.DeviceID : '';
    const portName = typeof p?.PortName === 'string' ? p.PortName : '';
    const isDefault = !!p?.Default;
    const workOffline = !!p?.WorkOffline;
    const printerStatus = typeof p?.PrinterStatus === 'number' ? p.PrinterStatus : undefined;
    const driverName = typeof p?.DriverName === 'string' ? p.DriverName : undefined;
    const connectionType = detectConnectionType(portName);
    const printerKind = classifyPrinterKind(deviceId, portName);
    // Fail-safe: treat WorkOffline as authoritative offline signal.
    const isOnline = !workOffline;

    return {
      name,
      deviceId,
      connectionType,
      printerKind,
      isOnline,
      isDefault,
      portName,
      printerStatus,
      driverName,
      workOffline,
    };
  });
}

async function getElectronPrintersBasic(senderWebContents) {
  const printers = await senderWebContents.getPrintersAsync();
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName,
    isDefault: printer.isDefault,
    status: printer.status,
    deviceId: extractString(printer?.options?.deviceId || printer?.options?.DeviceID || printer?.options?.deviceID),
    portName: extractString(printer?.options?.portName || printer?.options?.PortName),
  }));
}

async function getNormalizedPrinters(senderWebContents = null) {
  // OS-only source: Electron's getPrintersAsync (no manual add)
  if (senderWebContents) {
    const basic = await getElectronPrintersBasic(senderWebContents);
    return basic.map((p) => ({
      name: p.name,
      connectionType: detectConnectionType(p.portName),
      printerKind: classifyPrinterKind(p.deviceId, p.portName),
      isOnline: true,
      isDefault: !!p.isDefault,
      portName: p.portName || '',
      deviceId: p.deviceId || '',
      displayName: p.displayName,
      status: p.status,
    }));
  }

  return [];
}

// IPC handlers for printing functionality
ipcMain.on('securePrintHub:getBackendUrlSync', (event) => {
  event.returnValue = getBackendBaseUrl();
});

ipcMain.handle('securePrintHub:setJwt', async (event, { token }) => {
  currentJwt = token;
  return { success: true };
});

ipcMain.handle('securePrintHub:getConnectivityState', async () => {
  try {
    const state = await probeHealthOnce();
    emitConnectivity(state);
  } catch {
    emitConnectivity('OFFLINE');
  }
  return { state: lastConnectivityState };
});

// Offline token IPC handlers
ipcMain.handle('securePrintHub:prepareOfflinePrint', async (event, { sessionToken, printerName, printerType, portName, clientOS, machineGuidHash, expiresInSeconds }) => {
  try {
    return { success: false, error: 'Offline printing is disabled' };
    const base = getBackendBaseUrl();
    const url = new URL('/api/docs/offline-token/prepare', base);
    const lib = url.protocol === 'https:' ? https : http;

    const payload = JSON.stringify({
      sessionToken,
      printerName,
      printerType,
      portName,
      clientOS,
      machineGuidHash,
      expiresInSeconds,
    });

    const res = await new Promise((resolve, reject) => {
      const req = lib.request(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Authorization': `Bearer ${currentJwt || ''}`,
          },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve({ statusCode: res.statusCode, data: parsed });
            } catch (e) {
              resolve({ statusCode: res.statusCode, data });
            }
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    if (res.statusCode !== 200) {
      return { success: false, error: res.data?.message || `HTTP ${res.statusCode}` };
    }

    // Cache the file bytes while online using the returned cacheUrl
    const cacheUrl = res.data.cacheUrl;
    const tokenId = res.data.offlineTokenId;
    const cacheFile = getCachedFilePath(tokenId);
    const cacheReq = lib.request(
      {
        method: 'GET',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: new URL(cacheUrl, base).pathname,
        headers: { Authorization: `Bearer ${currentJwt || ''}` },
        timeout: 15000,
      },
      (cacheRes) => {
        if (cacheRes.statusCode !== 200) {
          return { success: false, error: `Failed to cache file: ${cacheRes.statusCode}` };
        }
        const stream = fs.createWriteStream(cacheFile);
        cacheRes.pipe(stream);
        stream.on('finish', () => {
          // Save token metadata to offline DB
          const db = loadOfflineDb();
          db.push({
            tokenId,
            sessionToken,
            printerName,
            printerType,
            portName,
            clientOS,
            machineGuidHash,
            expiresAt: res.data.expiresAt,
            createdAt: new Date().toISOString(),
            usedAt: null,
            reconciledAt: null,
            filePath: cacheFile,
          });
          saveOfflineDb(db);
        });
      }
    );
    cacheReq.on('error', (err) => {
      console.error('[Electron] Failed to cache offline file:', err);
    });
    cacheReq.end();

    return { success: true, data: res.data };
  } catch (err) {
    console.error('[Electron] prepareOfflinePrint error:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
});

ipcMain.handle('securePrintHub:validateOfflinePrint', async (event, { tokenId, printerName }) => {
  try {
    return { valid: false, reason: 'Offline printing is disabled' };
    const machineGuid = await getMachineGuid();
    const machineHash = hashMachineGuid(machineGuid);
    const db = loadOfflineDb();
    const entry = db.find(e => e.tokenId === tokenId && !e.usedAt);
    if (!entry) return { valid: false, reason: 'Token not found or already used' };
    if (entry.machineGuidHash !== machineHash) return { valid: false, reason: 'Machine mismatch' };
    if (entry.printerName !== printerName) return { valid: false, reason: 'Printer mismatch' };
    if (new Date() > new Date(entry.expiresAt)) return { valid: false, reason: 'Token expired' };
    if (!fs.existsSync(entry.filePath)) return { valid: false, reason: 'Cached file missing' };
    return { valid: true, filePath: entry.filePath };
  } catch (err) {
    console.error('[Electron] validateOfflinePrint error:', err);
    return { valid: false, reason: 'Validation error' };
  }
});

ipcMain.handle('securePrintHub:markOfflinePrintUsed', async (event, { tokenId, printedAt, printerName, printerType, portName, clientOS, machineGuidHash }) => {
  try {
    return { success: false, error: 'Offline printing is disabled' };
    const db = loadOfflineDb();
    const entry = db.find(e => e.tokenId === tokenId && !e.usedAt);
    if (!entry) return { success: false, error: 'Token not found or already used' };
    entry.usedAt = printedAt;
    entry.printerName = printerName;
    entry.printerType = printerType;
    entry.portName = portName;
    entry.clientOS = clientOS;
    entry.machineGuidHash = machineGuidHash;
    saveOfflineDb(db);
    // Optionally delete cached file after use
    try {
      if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath);
    } catch {}
    return { success: true };
  } catch (err) {
    console.error('[Electron] markOfflinePrintUsed error:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
});

ipcMain.handle('securePrintHub:reconcileOfflineHistory', async (event, { entries }) => {
  try {
    return { success: false, error: 'Offline printing is disabled' };
    const base = getBackendBaseUrl();
    const url = new URL('/api/docs/offline-token/reconcile', base);
    const lib = url.protocol === 'https:' ? https : http;

    const payload = JSON.stringify({ entries });
    const res = await new Promise((resolve, reject) => {
      const req = lib.request(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Authorization': `Bearer ${currentJwt || ''}`,
          },
          timeout: 15000,
        },
        (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve({ statusCode: res.statusCode, data: parsed });
            } catch (e) {
              resolve({ statusCode: res.statusCode, data });
            }
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    if (res.statusCode !== 200) {
      return { success: false, error: res.data?.message || `HTTP ${res.statusCode}` };
    }

    // Clear reconciled entries from local DB
    const db = loadOfflineDb();
    const reconciledIds = new Set();
    for (const result of res.data.results || []) {
      if (result.status === 'reconciled') reconciledIds.add(result.offlineTokenId);
    }
    const updatedDb = db.filter(e => !reconciledIds.has(e.tokenId));
    saveOfflineDb(updatedDb);

    return { success: true, data: res.data };
  } catch (err) {
    console.error('[Electron] reconcileOfflineHistory error:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
});

ipcMain.handle('securePrintHub:listOfflineTokens', async () => {
  try {
    return { success: false, error: 'Offline printing is disabled' };
    const db = loadOfflineDb();
    return { success: true, data: db.filter(e => !e.usedAt) };
  } catch (err) {
    console.error('[Electron] listOfflineTokens error:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
});

ipcMain.handle('securePrintHub:openExternal', async (event, url) => {
  return { success: false, error: 'External links are disabled' };
});

ipcMain.handle('securePrintHub:downloadPdf', async (event, url) => {
  return { success: false, error: 'Downloads are disabled' };
});

ipcMain.handle('securePrintHub:openSystemSettings', async (_event, target) => {
  // Renderer asks to open OS settings to help the user add/pair printers.
  // Use ms-settings deep links on Windows; fall back to general settings.
  const t = typeof target === 'string' ? target.toLowerCase() : '';

  let uri = 'ms-settings:';
  if (t === 'printers' || t === 'printer' || t === 'usb') {
    uri = 'ms-settings:printers';
  } else if (t === 'bluetooth') {
    uri = 'ms-settings:bluetooth';
  } else if (t === 'wifi' || t === 'wi-fi') {
    uri = 'ms-settings:network-wifi';
  }

  await shell.openExternal(uri);
  return { success: true };
});

ipcMain.handle('securePrintHub:getPrinters', async (event) => {
  try {
    // Use event.sender.getPrintersAsync() to get printers from the renderer's webContents
    const printers = await event.sender.getPrintersAsync();
    return printers;
  } catch (err) {
    console.error('[Electron Main] Failed to get printers:', err);
    return [];
  }
});

ipcMain.handle('securePrintHub:getPrintersDetailed', async (event) => {
  try {
    const sender = event?.sender;
    if (!sender || sender.isDestroyed()) {
      return [];
    }
    const printers = await getNormalizedPrinters(sender);
    let windowsDetails = [];
    try {
      windowsDetails = await getWindowsPrintersDetailed();
    } catch {
      windowsDetails = [];
    }
    const detailsByName = new Map(
      (Array.isArray(windowsDetails) ? windowsDetails : []).map((p) => [String(p?.name || '').toLowerCase(), p])
    );
    const merged = printers.map((p) => {
      const d = detailsByName.get(String(p?.name || '').toLowerCase());
      return {
        ...p,
        isOnline: typeof d?.isOnline === 'boolean' ? d.isOnline : p.isOnline,
      };
    });
    // Maintain stable order: default first, then alphabetical
    return merged
      .slice()
      .sort((a, b) => {
        const da = a.isDefault ? 1 : 0;
        const db = b.isDefault ? 1 : 0;
        if (da !== db) return db - da;
        return String(a.displayName || a.name).localeCompare(String(b.displayName || b.name));
      });
  } catch (err) {
    console.error('[Electron Main] Failed to get detailed printers:', err);
    return [];
  }
});

function parsePageRanges(input) {
  try {
    const s = typeof input === 'string' ? input.trim() : '';
    if (!s) return [];

    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    const ranges = [];
    for (const part of parts) {
      const m = /^([0-9]+)\s*(?:-\s*([0-9]+))?$/.exec(part);
      if (!m) continue;
      const a = Number(m[1]);
      const b = typeof m[2] === 'string' ? Number(m[2]) : a;
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const fromPage = Math.min(a, b);
      const toPage = Math.max(a, b);
      if (fromPage <= 0 || toPage <= 0) continue;
      ranges.push({ from: fromPage - 1, to: toPage - 1 });
    }
    return ranges;
  } catch {
    return [];
  }
}

function getPrinterDriverNameFromSender(senderWebContents, printerName) {
  try {
    if (!senderWebContents || senderWebContents.isDestroyed()) return null;
    if (!printerName || typeof printerName !== 'string') return null;
    const printers = senderWebContents.getPrinters();
    const match = Array.isArray(printers) ? printers.find((p) => p?.name === printerName) : null;
    const opts = match?.options || {};
    return (
      extractString(opts?.driverName || opts?.DriverName || opts?.driver || opts?.Driver) ||
      extractString(match?.displayName) ||
      null
    );
  } catch {
    return null;
  }
}

async function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = 10000 } = {}) {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;

  const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

  return await new Promise((resolve, reject) => {
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search || ''}`,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : null;
            resolve({ statusCode: res.statusCode || 0, data: parsed });
          } catch {
            resolve({ statusCode: res.statusCode || 0, data });
          }
        });
      }
    );
    req.on('timeout', () => {
      try {
        req.destroy(new Error('Request timeout'));
      } catch {
        // ignore
      }
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pickDefaultPrinter(senderWebContents) {
  try {
    if (!senderWebContents || senderWebContents.isDestroyed()) return null;
    const printers = senderWebContents.getPrinters();
    if (!Array.isArray(printers) || printers.length === 0) return null;
    const def = printers.find((p) => p?.isDefault) || printers[0];
    const name = typeof def?.name === 'string' ? def.name : null;
    const deviceId = extractString(def?.options?.deviceId || def?.options?.DeviceID || def?.options?.deviceID);
    const portName = extractString(def?.options?.portName || def?.options?.PortName);
    const printerKind = classifyPrinterKind(deviceId, portName);
    return { name, printerKind };
  } catch {
    return null;
  }
}

function logPrinterDriverDiagnostics(senderWebContents, printerName) {
  try {
    if (!senderWebContents || senderWebContents.isDestroyed()) return;
    if (!printerName || typeof printerName !== 'string') return;
    const printers = senderWebContents.getPrinters();
    const match = Array.isArray(printers) ? printers.find((p) => p?.name === printerName) : null;
    if (!match) return;
    const opts = match?.options || {};
    console.log('[print] printer_meta', {
      printerName,
      displayName: extractString(match?.displayName) || null,
      optionKeys: opts && typeof opts === 'object' ? Object.keys(opts) : [],
    });
  } catch {
    // ignore
  }
}

ipcMain.handle('securePrintHub:silentPrintPdf', async (event, { url, printerName, printerKind }) => {
  return await silentPrintPdfImpl(event, { url, printerName, printerKind });
});
