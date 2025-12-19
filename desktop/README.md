# Secure Print Hub (Desktop)

This folder contains the **Electron wrapper** that packages the existing React UI (`../frontend`) into a **Windows .exe installer**.

Hard rules followed:
- Backend is **NOT** bundled.
- Electron talks to backend **over HTTP** only.
- S3 is **NOT** accessed by Electron (it only opens `pdfUrl`).

## Prerequisites

- Node.js LTS
- Windows 10/11

## Dev (runs Electron + React dev server)

From `desktop/`:

```bash
npm install
npm run dev
```

Electron will open the app at:
- `http://localhost:8080/printing`

This will:
- Start the Vite dev server at `http://localhost:8080`
- Launch Electron pointing to `http://localhost:8080`

To change the start route, set:

```bash
set ELECTRON_START_PATH=/printing
```

(Default is `/printing`.)

Backend:
- Run your backend separately (example):

```bash
npm --prefix ../backend run dev
```

Make sure your frontend env points to the correct backend:
- `../frontend/.env` has `VITE_API_BASE_URL` (dev default: `http://localhost:4000`)

## Production build (Windows installer)

From `desktop/`:

```bash
npm install
npm run build
```

Output:
- `desktop/dist/` will contain the installer.
- The installed app runs as **SecurePrintHub.exe**.

Important:
- The production frontend build bakes in `VITE_API_BASE_URL` at build time.
- Before building for production, set `VITE_API_BASE_URL` to your deployed backend URL (or use a `.env.production` in `frontend/`).

Routing note (important):
- Your frontend uses `BrowserRouter`.
- In production, Electron starts a tiny local server that serves the built frontend and always falls back to `index.html`, so routes like `/printing` work correctly.

## PDF open flow

When your backend returns `{ pdfUrl }`:
- If the React UI uses `window.open(pdfUrl)` (or creates a normal `<a target="_blank">`), Electron will open the URL in the **default system browser**.

Additionally, Electron exposes a safe IPC API:
- `window.securePrintHub.openExternal(pdfUrl)`
- `window.securePrintHub.downloadPdf(pdfUrl)`

(You only need these if you want explicit open/download wiring in the UI later.)

## Common errors

### Vite dev server not reachable

- Ensure `frontend/vite.config.ts` uses port `8080` (it currently does).
- If port `8080` is in use, free it or change both Vite + the Electron dev URL.

### Blank window in production build

- Ensure `npm --prefix ../frontend run build` produces `../frontend/dist/index.html`.
- Re-run `npm run build` from `desktop/`.

### Backend calls fail in production

- Your built frontend still points at the wrong `VITE_API_BASE_URL`.
- Set `VITE_API_BASE_URL` to the deployed backend URL and rebuild.
