// PDF: kurulu Chrome / Edge / Chromium'u başsız modda kullanır. Ek paket indirmez.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function findBrowser() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const home = os.homedir();
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ],
    win32: [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'],
  }[process.platform] || [];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

export function renderPdf(htmlPath, pdfPath) {
  const bin = findBrowser();
  if (!bin) {
    const e = new Error('PDF için Chrome, Edge ya da Chromium bulunamadı. Rehberi tarayıcıda açıp Yazdır → PDF olarak kaydet seçeneğini kullanabilirsin.');
    e.status = 501;
    return Promise.reject(e);
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-rehber-pdf-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--no-first-run',
    `--user-data-dir=${profile}`, `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
  ];
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 90_000 }, (err) => {
      fs.rm(profile, { recursive: true, force: true }, () => {});
      if (err && !fs.existsSync(pdfPath)) return reject(new Error(`PDF oluşturulamadı: ${err.message.slice(0, 200)}`));
      resolve(pdfPath);
    });
  });
}
