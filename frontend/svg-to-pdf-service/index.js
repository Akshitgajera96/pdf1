const express = require('express');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const upload = multer();

function getPageSizeFromViewBox(svgText) {
  const viewBoxMatch = svgText.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!viewBoxMatch) return null;

  const parts = viewBoxMatch[1]
    .trim()
    .split(/\s+/)
    .map((v) => Number(v));

  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    return null;
  }

  const [, , width, height] = parts;
  if (width <= 0 || height <= 0) return null;

  // Interpret viewBox units as points; this keeps vector and aspect ratio correct.
  return [width, height];
}

function parseViewBox(svgText) {
  const viewBoxMatch = svgText.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!viewBoxMatch) return null;

  const parts = viewBoxMatch[1]
    .trim()
    .split(/\s+/)
    .map((v) => Number(v));

  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    return null;
  }

  const [minX, minY, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { minX, minY, width, height };
}

function applyCropPercentToSvg(svgText, cropPercent) {
  if (!cropPercent) return svgText;

  const vb = parseViewBox(svgText);
  if (!vb) return svgText;

  const xPercent = Number(cropPercent.xPercent);
  const yPercent = Number(cropPercent.yPercent);
  const widthPercent = Number(cropPercent.widthPercent);
  const heightPercent = Number(cropPercent.heightPercent);

  if (
    !Number.isFinite(xPercent) ||
    !Number.isFinite(yPercent) ||
    !Number.isFinite(widthPercent) ||
    !Number.isFinite(heightPercent)
  ) {
    return svgText;
  }

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const xP = clamp(xPercent, 0, 100);
  const yP = clamp(yPercent, 0, 100);
  const wP = clamp(widthPercent, 0, 100);
  const hP = clamp(heightPercent, 0, 100);

  const cropX = vb.minX + (xP / 100) * vb.width;
  const cropY = vb.minY + (yP / 100) * vb.height;
  const cropW = (wP / 100) * vb.width;
  const cropH = (hP / 100) * vb.height;

  if (!Number.isFinite(cropW) || !Number.isFinite(cropH) || cropW <= 0 || cropH <= 0) {
    return svgText;
  }

  const nextViewBox = `${cropX} ${cropY} ${cropW} ${cropH}`;

  if (svgText.match(/viewBox\s*=\s*"[^"]+"/i)) {
    return svgText.replace(/viewBox\s*=\s*"[^"]+"/i, `viewBox="${nextViewBox}"`);
  }

  return svgText;
}

function svgToPdfBuffer(svgText) {
  return new Promise((resolve, reject) => {
    const pageSize = getPageSizeFromViewBox(svgText) || 'A4';
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.addPage({ size: pageSize });
    SVGtoPDF(doc, svgText, 0, 0, {
      preserveAspectRatio: 'xMidYMid meet',
      assumePt: true,
    });
    doc.end();
  });
}

function runGhostscriptCmyk(inputPdfBuffer, opts) {
  const timeoutMs = Number(opts?.timeoutMs) || 120000;
  const gsExecutable = process.platform === 'win32' ? 'gswin64c' : 'gs';

  const maxBytes = Number(opts?.maxBytes) || 60 * 1024 * 1024;
  if (inputPdfBuffer && inputPdfBuffer.length > maxBytes) {
    throw new Error('Input PDF too large');
  }

  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `svg2pdf-${jobId}-`));
  const inputPath = path.join(tmpDir, 'in.pdf');
  const outputPath = path.join(tmpDir, 'out.pdf');

  fs.writeFileSync(inputPath, inputPdfBuffer);

  const args = [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
    '-sColorConversionStrategy=CMYK',
    '-sProcessColorModel=DeviceCMYK',
    '-dUseCIEColor',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];

  return new Promise((resolve, reject) => {
    let settled = false;
    let gs;
    const cleanup = () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    };

    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (gs) gs.kill('SIGKILL');
      } catch {
        // ignore
      }
      cleanup();
      reject(new Error('Ghostscript timeout'));
    }, timeoutMs);

    gs = spawn(gsExecutable, args, { windowsHide: true });

    let stderr = '';
    gs.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    gs.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      cleanup();
      reject(err);
    });

    gs.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);

      if (code !== 0) {
        cleanup();
        reject(new Error(`Ghostscript failed (code ${code}): ${stderr}`));
        return;
      }

      try {
        const out = fs.readFileSync(outputPath);
        cleanup();
        resolve(out);
      } catch (e) {
        cleanup();
        reject(e);
      }
    });
  });
}

app.post('/svg-to-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('Missing SVG file');
    }

    const svgText = req.file.buffer.toString('utf8');

    const pdfBuffer = await svgToPdfBuffer(svgText);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('SVG-to-PDF error:', err);
    res.status(500).send('Conversion failed');
  }
});

// SVG -> PDF -> CMYK PDF (Ghostscript) with optional crop percent (ticketRegion)
app.post('/svg-to-pdf-cmyk', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('Missing SVG file');
    }

    const cropRaw = req.body && req.body.crop ? req.body.crop : null;
    let crop = null;
    if (cropRaw && typeof cropRaw === 'string') {
      try {
        crop = JSON.parse(cropRaw);
      } catch {
        crop = null;
      }
    } else if (cropRaw && typeof cropRaw === 'object') {
      crop = cropRaw;
    }

    const originalSvgText = req.file.buffer.toString('utf8');
    const svgText = applyCropPercentToSvg(originalSvgText, crop);

    const rgbPdf = await svgToPdfBuffer(svgText);
    const cmykPdf = await runGhostscriptCmyk(rgbPdf, { timeoutMs: 120000 });

    res.setHeader('Content-Type', 'application/pdf');
    res.send(cmykPdf);
  } catch (err) {
    console.error('SVG-to-PDF-CMYK error:', err);
    res.status(500).send('Conversion failed');
  }
});

// PDF -> CMYK PDF (Ghostscript)
app.post('/pdf-to-cmyk', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('Missing PDF file');
    }

    const inputPdf = req.file.buffer;
    const cmykPdf = await runGhostscriptCmyk(inputPdf, { timeoutMs: 120000 });

    res.setHeader('Content-Type', 'application/pdf');
    res.send(cmykPdf);
  } catch (err) {
    console.error('PDF-to-CMYK error:', err);
    res.status(500).send('Conversion failed');
  }
});

// Diagnostic endpoint: returns a simple vector PDF generated from an inline SVG
// so you can verify that the service is producing vector output.
app.get('/diagnostic/vector-test', (req, res) => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect x="10" y="10" width="180" height="180" fill="#1e90ff" stroke="#000" stroke-width="4"/>
  <circle cx="100" cy="100" r="60" fill="#fff" stroke="#000" stroke-width="3"/>
  <text x="100" y="110" font-size="24" text-anchor="middle" fill="#000">Vector</text>
</svg>`;

  const pageSize = getPageSizeFromViewBox(svg) || 'A4';
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks = [];

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => {
    const pdfBuffer = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  });

  doc.addPage({ size: pageSize });

  SVGtoPDF(doc, svg, 0, 0, {
    preserveAspectRatio: 'xMidYMid meet',
    assumePt: true,
  });

  doc.end();
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`SVG-to-PDF vector service listening on port ${port}`);
});
