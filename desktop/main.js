// qaHere masaüstü kabuğu: depodaki sunucuyu (bin/qahere.js) başlatır ve arayüzü kendi penceresinde açar.
// Sunucu kodu ve güncelleme akışı aynıdır; bu dosya yalnızca pencere, menü, bağlantı ve indirme davranışını ekler.
import { app, BrowserWindow, Menu, shell, dialog, session, nativeTheme } from 'electron';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4310;
const ORIGIN = `http://localhost:${PORT}`;
const REPO_URL = 'https://github.com/yunusemreyildiz/qahere';

app.setName('qaHere');
// Ayrı bir profil (ör. örnek veriyle ekran görüntüsü): açık qaHere'den bağımsız ikinci bir pencere açar.
if (process.env.QAHERE_USER_DATA) app.setPath('userData', path.resolve(process.env.QAHERE_USER_DATA));

/** Depo klasörü: QAHERE_HOME > paketlerken yazılan home.json > bu klasörün bir üstü. */
function repoRoot() {
  const ok = (p) => p && fs.existsSync(path.join(p, 'server.js')) && fs.existsSync(path.join(p, 'bin', 'qahere.js'));
  if (ok(process.env.QAHERE_HOME)) return path.resolve(process.env.QAHERE_HOME);
  try {
    const { root } = JSON.parse(fs.readFileSync(path.join(here, 'home.json'), 'utf8'));
    if (ok(root)) return root;
  } catch { /* paketlenmemiş */ }
  const parent = path.resolve(here, '..');
  return ok(parent) ? parent : '';
}

/** Finder'dan açılınca PATH kısadır (claude, maestro, adb, npm bulunmaz); oturum kabuğunun PATH'i eklenir. */
function adoptLoginPath() {
  if (process.platform === 'win32') return;
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__QP__%s__QP__" "$PATH"'], {
      encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const found = out.match(/__QP__(.*)__QP__/)?.[1];
    if (found) process.env.PATH = [...new Set([...found.split(':'), ...(process.env.PATH || '').split(':')].filter(Boolean))].join(':');
  } catch { /* kabuk okunamadı; var olan PATH ile devam */ }
}

// ---- Sunucu ----
let child = null;
let quitting = false;
const logLines = [];
let logFile = '';

function log(chunk) {
  const text = String(chunk);
  try { fs.appendFileSync(logFile, text); } catch { /* günlük yazılamadı */ }
  logLines.push(...text.split('\n').filter(Boolean));
  if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
}

async function isQahere() {
  try {
    const r = await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    const j = await r.json();
    return Boolean(j && typeof j === 'object' && 'claude' in j);
  } catch { return false; }
}

function startServer(root) {
  logFile = path.join(app.getPath('userData'), 'qahere.log');
  try { fs.writeFileSync(logFile, ''); } catch { /* yok say */ }
  logLines.length = 0;
  // Electron kendi Node'uyla çalıştırır: ayrıca Node kurulu olmasa da sunucu açılır.
  child = spawn(process.execPath, [path.join(root, 'bin', 'qahere.js')], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.on('exit', (code, signal) => {
    log(`\n[qaHere sunucusu kapandı: ${signal || code}]\n`);
    child = null;
    if (!quitting) showError('Sunucu beklenmedik şekilde kapandı.');
  });
}

async function waitReady(ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await isQahere()) return true;
    if (!child) return false;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function stopServer() {
  if (!child) return Promise.resolve();
  const c = child;
  return new Promise((resolve) => {
    const t = setTimeout(() => { c.kill('SIGKILL'); resolve(); }, 4000);
    c.once('exit', () => { clearTimeout(t); resolve(); });
    c.kill('SIGTERM');
  });
}

// ---- Pencere ----
let win = null;
let ownServer = false;
const stateFile = () => path.join(app.getPath('userData'), 'window.json');

function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (b.width >= 900 && b.height >= 600) return b;
  } catch { /* ilk açılış */ }
  return { width: 1440, height: 920 };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function page(title, body) {
  const html = `<!doctype html><meta charset="utf-8"><title>qaHere</title><style>
  :root{color-scheme:light dark;--bg:#f3f4f6;--ink:#16191c;--mute:#59606a;--well:#fff;--rule:#d9dce0}
  @media (prefers-color-scheme:dark){:root{--bg:#121416;--ink:#eceeec;--mute:#a3a9b0;--well:#1b1e21;--rule:#2e3237}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
  font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  main{max-width:640px;padding:32px}h1{font-size:20px;margin:0 0 8px}p{color:var(--mute);margin:0 0 16px}
  pre{background:var(--well);border:1px solid var(--rule);border-radius:8px;padding:12px;font-size:12px;
  max-height:46vh;overflow:auto;white-space:pre-wrap}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#0071e3;margin-right:10px;
  animation:p 1s ease-in-out infinite alternate}@keyframes p{to{opacity:.25}}
  @media (prefers-reduced-motion:reduce){.dot{animation:none}}</style><main>${body.replace('{{T}}', esc(title))}</main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function showLoading() {
  win?.loadURL(page('qaHere açılıyor', `<h1><span class="dot"></span>{{T}}</h1><p>Sunucu başlatılıyor.</p>
  <p id="h" hidden>İlk açılışta macOS klasör erişimi isteyebilir; pencere çıktıysa <b>İzin Ver</b>'e bas.</p>
  <script>setTimeout(()=>{document.getElementById('h').hidden=false},4000)</script>`));
}

function showError(message) {
  if (!win || win.isDestroyed()) return;
  const tail = logLines.slice(-40).join('\n');
  win.loadURL(page(message, `<h1>{{T}}</h1><p>Menüden <b>Sunucu → Sunucuyu yeniden başlat</b> ile tekrar dene.
  ${PORT === 4310 ? 'Başka bir program 4310 bağlantı noktasını kullanıyorsa onu kapat.' : ''}
  Ayrıntı: Sunucu → Günlüğü göster.</p>${tail ? `<pre>${esc(tail)}</pre>` : ''}`));
}

function isLocal(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname) && Number(u.port) === PORT;
  } catch { return false; }
}

function openOutside(url) {
  try {
    const u = new URL(url);
    if (['https:', 'http:', 'mailto:'].includes(u.protocol)) shell.openExternal(u.href);
  } catch { /* geçersiz adres */ }
}

/** Pencere içi gezinme yalnızca qaHere sunucusunda kalır; dış bağlantılar (Jira, Slack…) varsayılan tarayıcıda açılır. */
function guard(w) {
  w.webContents.on('will-navigate', (e, url) => {
    if (isLocal(url) || url.startsWith('data:')) return;
    e.preventDefault();
    openOutside(url);
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocal(url)) {
      // "Yeni sekmede aç": tam rapor ayrı bir pencerede.
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 900, title: 'qaHere', webPreferences: { sandbox: true, contextIsolation: true } } };
    }
    openOutside(url);
    return { action: 'deny' };
  });
  w.webContents.on('did-create-window', (cw) => guard(cw));
}

function createWindow() {
  const b = savedBounds();
  win = new BrowserWindow({
    ...b, minWidth: 900, minHeight: 600, title: 'qaHere', show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121416' : '#f3f4f6',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  guard(win);
  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    try { if (!win.isFullScreen()) fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds())); } catch { /* yok say */ }
  });
  win.on('closed', () => { win = null; });
  return win;
}

async function openApp() {
  if (!win) createWindow();
  if (await isQahere()) { win.loadURL(ORIGIN); return; }
  showLoading();
  if (!child) {
    const root = repoRoot();
    if (!root) {
      win.loadURL(page('qaHere klasörü bulunamadı', `<h1>{{T}}</h1><p>Uygulama, qaHere deposunun içindeki
      <code>desktop</code> klasöründen paketlenmeli ya da <code>QAHERE_HOME</code> ortam değişkeni depo klasörünü göstermeli.</p>`));
      return;
    }
    ownServer = true;
    startServer(root);
  }
  if (await waitReady()) win?.loadURL(ORIGIN);
  else if (child) showError('Sunucu 30 saniyede açılmadı.');
}

async function restartServer() {
  if (!ownServer && !child) {
    if (await isQahere()) {
      dialog.showMessageBox({ type: 'info', message: 'Sunucu bu uygulamanın dışında çalışıyor', detail: 'Terminalde npm start ile açılmış bir qaHere sunucusuna bağlısın. Yeniden başlatmak için orada durdurup tekrar başlat.' });
      return;
    }
  }
  quitting = true;
  await stopServer();
  quitting = false;
  child = null;
  await openApp();
}

// Kapatırken üretim sürüyorsa sor: sunucu bu uygulamaya bağlıysa üretim de durur.
async function confirmQuit() {
  if (!ownServer || !child) return true;
  try {
    const r = await fetch(`${ORIGIN}/api/jobs/active`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    if (!j.jobId) return true;
    const { response } = await dialog.showMessageBox({
      type: 'warning', buttons: ['Çık', 'Vazgeç'], defaultId: 1, cancelId: 1,
      message: `${j.key} için rehber üretiliyor`, detail: 'Çıkarsan üretim yarıda kalır.',
    });
    return response === 0;
  } catch { return true; }
}

// ---- İndirmeler: PDF doğrudan İndirilenler'e, bitince Finder'da gösterilir ----
function handleDownloads() {
  session.defaultSession.on('will-download', (_e, item) => {
    const dir = app.getPath('downloads');
    const { name, ext } = path.parse(item.getFilename());
    let target = path.join(dir, `${name}${ext}`);
    for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${name} (${i})${ext}`);
    item.setSavePath(target);
    item.once('done', (_ev, state) => {
      if (state !== 'completed') return;
      if (process.platform === 'darwin') app.dock?.downloadFinished(target);
      shell.showItemInFolder(target);
    });
  });
}

// ---- Menü ----
function buildMenu() {
  const mac = process.platform === 'darwin';
  const run = (js) => () => win?.webContents.executeJavaScript(js).catch(() => {});
  const template = [
    ...(mac ? [{
      label: 'qaHere',
      submenu: [
        { role: 'about', label: 'qaHere hakkında' },
        { type: 'separator' },
        { label: 'Ayarlar…', accelerator: 'Cmd+,', click: run("document.getElementById('settingsBtn')?.click()") },
        { type: 'separator' },
        { role: 'hide', label: 'qaHere\'yi gizle' },
        { role: 'hideOthers', label: 'Diğerlerini gizle' },
        { role: 'unhide', label: 'Tümünü göster' },
        { type: 'separator' },
        { role: 'quit', label: 'qaHere\'den çık' },
      ],
    }] : []),
    {
      label: 'Düzen',
      submenu: [
        { role: 'undo', label: 'Geri al' }, { role: 'redo', label: 'Yinele' }, { type: 'separator' },
        { role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' },
        { role: 'selectAll', label: 'Tümünü seç' },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'reload', label: 'Yenile' },
        { role: 'toggleDevTools', label: 'Geliştirici araçları' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Gerçek boyut' }, { role: 'zoomIn', label: 'Yakınlaştır' }, { role: 'zoomOut', label: 'Uzaklaştır' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tam ekran' },
      ],
    },
    {
      label: 'Sunucu',
      submenu: [
        { label: 'Tarayıcıda aç', click: () => shell.openExternal(ORIGIN) },
        { label: 'Sunucuyu yeniden başlat', click: () => restartServer() },
        { type: 'separator' },
        { label: 'Günlüğü göster', click: () => { if (logFile && fs.existsSync(logFile)) shell.openPath(logFile); } },
        { label: 'qaHere klasörünü göster', click: () => { const r = repoRoot(); if (r) shell.openPath(r); } },
      ],
    },
    {
      label: 'Pencere',
      submenu: [
        { role: 'minimize', label: 'Küçült' }, { role: 'zoom', label: 'Büyüt' },
        ...(mac ? [{ type: 'separator' }, { role: 'front', label: 'Tümünü öne getir' }] : [{ role: 'close', label: 'Kapat' }]),
      ],
    },
    { label: 'Yardım', role: 'help', submenu: [{ label: 'qaHere GitHub sayfası', click: () => shell.openExternal(REPO_URL) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Yaşam döngüsü ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return openApp();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    adoptLoginPath();
    app.setAboutPanelOptions({ applicationName: 'qaHere', applicationVersion: app.getVersion(), website: REPO_URL });
    buildMenu();
    handleDownloads();
    openApp();
    app.on('activate', () => { if (!win) openApp(); });
  });

  // macOS'ta pencere kapanınca uygulama (ve sunucu) Dock'ta açık kalır; diğerlerinde çıkılır.
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  let confirmed = false;
  app.on('before-quit', async (e) => {
    if (confirmed) return;
    e.preventDefault();
    if (!(await confirmQuit())) return;
    confirmed = true;
    quitting = true;
    await stopServer();
    app.quit();
  });
}
