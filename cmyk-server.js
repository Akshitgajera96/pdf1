const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.post('/api/convert-to-cmyk', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  const inputPath = req.file.path;
  const outputPath = `${inputPath}-cmyk.pdf`;

  const gsExecutable = process.platform === 'win32' ? 'gswin64c' : 'gs';

  const args = [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    '-sColorConversionStrategy=CMYK',
    '-sProcessColorModel=DeviceCMYK',
    '-dUseCIEColor',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];

  const gs = spawn(gsExecutable, args);

  gs.on('error', (err) => {
    console.error('Ghostscript error', err);
    fs.unlinkSync(inputPath);
    return res.status(500).send('Ghostscript not found or failed');
  });

  gs.on('close', (code) => {
    fs.unlinkSync(inputPath);

    if (code !== 0) {
      console.error('Ghostscript exit code', code);
      return res.status(500).send('Failed to convert to CMYK');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="tickets-cmyk.pdf"');

    const stream = fs.createReadStream(outputPath);
    stream.on('close', () => {
      fs.unlinkSync(outputPath);
    });
    stream.pipe(res);
  });
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`CMYK server running on http://localhost:${PORT}`);
});
