// Firebase App Distribution'dan Android sürümünü indirip emülatöre kurar: testler doğru sürümde koşsun.
// Kimlik: kullanıcının Firebase CLI girişi ("firebase login"). CLI'ın sakladığı yenileme belirteci kısa ömürlü erişim
// belirtecine çevrilir; qaHere hiçbir parola ya da belirteç saklamaz, yalnızca okur ve indirir.
// Uygulama, Ayarlar → Simülatörde koşu'daki Android paket adından Firebase projelerinde aranır (bir kez, ayarlara yazılır).
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSettings, saveSettings } from './config.js';

// Firebase CLI'ın herkese açık OAuth istemcisi (firebase-tools kaynağında yer alır; gizli değildir).
const CLI_CLIENT = { id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com', secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' };
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const err = (message, status = 400) => Object.assign(new Error(message), { status });

export const LOGIN_NEEDED = 'Firebase\'e giriş yapılmamış. "Firebase\'e giriş yap" ile bağlan.';
export const LOGIN_EXPIRED = 'Firebase girişinin süresi dolmuş. "Firebase\'e giriş yap" ile yenile.';

let cached = null; // { token, until }
async function accessToken() {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  let cfg;
  try { cfg = JSON.parse(await fs.readFile(CONFIG, 'utf8')); } catch { throw err(LOGIN_NEEDED); }
  const refresh = cfg.tokens?.refresh_token;
  if (!refresh) throw err(LOGIN_NEEDED);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: CLI_CLIENT.id, client_secret: CLI_CLIENT.secret }),
    signal: AbortSignal.timeout(20_000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw err(d.error === 'invalid_grant' ? LOGIN_EXPIRED : `Firebase girişi yenilenemedi (${d.error || r.status}). "Firebase'e giriş yap" ile yeniden bağlan.`);
  cached = { token: d.access_token, until: Date.now() + (d.expires_in || 3000) * 1000 };
  return cached.token;
}

async function gapi(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(30_000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw err(d.error?.message ? `Firebase: ${d.error.message}` : `Firebase ${r.status} döndü.`, r.status === 403 ? 403 : 502);
  return d;
}

/** Sürümün kısa ömürlü indirme adresi (TestMu gibi bir servis dosyayı doğrudan buradan çekebilir). */
export async function releaseDownload(releaseName) {
  if (!/^projects\/[^/]+\/apps\/[^/]+\/releases\/[^/]+$/.test(String(releaseName))) throw err('Geçersiz sürüm.');
  const rel = await gapi(`https://firebaseappdistribution.googleapis.com/v1/${releaseName}`);
  if (!rel.binaryDownloadUri) throw err('Bu sürümün indirme adresi alınamadı.');
  return { url: rel.binaryDownloadUri, version: rel.displayVersion || '', build: rel.buildVersion || '' };
}

// ---- Uygulamadan giriş: "firebase login --reauth" Google onay sayfasını tarayıcıda açar, onaydan sonra kendisi biter.
// CLI, terminal yoksa (ya da bir yapay zekâ aracının ortamını görürse) kod yapıştırmalı akışa geçer; bu yüzden
// sahte terminalle (script) ve sade bir ortamla çalıştırılır. Parola ya da belirteç qaHere'den geçmez.
let login = null; // { child, status: 'waiting'|'ok'|'error', url, message, at }
const pubLogin = () => (login ? { status: login.status, url: login.url, message: login.message } : { status: 'idle' });
export function loginState() { return pubLogin(); }

export function startLogin() {
  if (login?.status === 'waiting') return pubLogin();
  if (process.platform === 'win32') throw err('Windows\'ta giriş şimdilik terminalden: firebase login --reauth');
  const env = { PATH: process.env.PATH || '', HOME: os.homedir(), USER: process.env.USER || '', LANG: process.env.LANG || 'en_US.UTF-8', TMPDIR: os.tmpdir(), TERM: 'xterm-256color' };
  const args = process.platform === 'darwin' ? ['-q', '/dev/null', 'firebase', 'login', '--reauth'] : ['-qec', 'firebase login --reauth', '/dev/null'];
  // stdin bir soket/boru olursa script tcgetattr hatası verir: boş bırakılır. Ayrı süreç grubu: iptalde CLI de kapanır.
  const child = spawn('script', args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, cwd: os.tmpdir() }); // CLI firebase-debug.log'u çalışma klasörüne yazar: depoya değil
  const kill = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } };
  const cur = { child, kill, status: 'waiting', url: '', message: 'Tarayıcıda Google onay sayfası açılıyor…', at: Date.now() };
  login = cur;
  let out = '';
  const onData = (b) => {
    out += b.toString();
    const clean = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const m = clean.match(/https:\/\/accounts\.google\.com\/[^\s"'<>]+/);
    if (m && !cur.url) { cur.url = m[0]; cur.message = 'Tarayıcıda Google hesabınla izin ver. Onaylayınca burası kendiliğinden güncellenir.'; }
    if (/command not found|not found: firebase|No such file/i.test(clean)) { cur.status = 'error'; cur.message = 'Firebase CLI kurulu değil. Kurmak için: npm install -g firebase-tools'; }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const timer = setTimeout(() => { if (cur.status === 'waiting') { cur.status = 'error'; cur.message = 'Giriş 5 dakika içinde tamamlanmadı. Yeniden dene.'; kill(); } }, 5 * 60_000);
  child.on('error', (e) => { cur.status = 'error'; cur.message = e.message; });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (cur.status !== 'waiting') return;
    const clean = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    if (code === 0 && /Success!/.test(clean)) {
      cached = null;
      const who = clean.match(/Logged in as (\S+)/);
      cur.status = 'ok'; cur.message = who ? `Giriş yapıldı: ${who[1]}` : 'Giriş yapıldı.';
    } else {
      cur.status = 'error';
      cur.message = /not found/i.test(clean) ? 'Firebase CLI kurulu değil. Kurmak için: npm install -g firebase-tools'
        : `Giriş tamamlanmadı${(clean.match(/Error:[^\n]+/) || [''])[0] ? ` (${clean.match(/Error:[^\n]+/)[0].trim()})` : ''}. Yeniden dene.`;
    }
  });
  return pubLogin();
}

export function cancelLogin() {
  if (login?.status === 'waiting') { login.kill(); login.status = 'error'; login.message = 'Giriş iptal edildi.'; }
  return pubLogin();
}

export async function firebaseUser() {
  try { const cfg = JSON.parse(await fs.readFile(CONFIG, 'utf8')); return cfg.user?.email ? { loggedIn: true, email: cfg.user.email } : { loggedIn: Boolean(cfg.tokens?.refresh_token) }; } catch { return { loggedIn: false }; }
}

const PLAT = {
  android: { list: 'androidApps', idField: 'packageName', label: 'Android paket adı' },
  ios: { list: 'iosApps', idField: 'bundleId', label: 'iOS bundle id' },
};

/** Paket adına / bundle id'ye göre Firebase uygulamasını bulur (projeleri gezer); bulunca ayarlara yazar. */
export async function findApp(platform = 'android') {
  const P = PLAT[platform];
  const id = getSettings().run[platform]?.appId;
  if (!id) throw err(`Önce Ayarlar → Simülatörde koşu bölümünde ${P.label} gir.`);
  const saved = getSettings().firebase?.[platform];
  if (saved?.appId && saved.packageName === id) return saved;
  const projects = [];
  let page = '';
  do {
    const d = await gapi(`https://firebase.googleapis.com/v1beta1/projects?pageSize=100${page ? `&pageToken=${page}` : ''}`);
    projects.push(...(d.results || []));
    page = d.nextPageToken || '';
  } while (page && projects.length < 300);
  for (const p of projects) {
    const d = await gapi(`https://firebase.googleapis.com/v1beta1/projects/${p.projectId}/${P.list}?pageSize=100`).catch(() => ({}));
    const app = (d.apps || []).find((a) => a[P.idField] === id);
    if (app) {
      const found = { appId: app.appId, packageName: id, projectId: p.projectId, projectNumber: p.projectNumber, name: app.displayName || id };
      saveSettings({ firebase: { ...getSettings().firebase, [platform]: found } });
      return found;
    }
  }
  throw err(`Firebase projelerinde "${id}" kimlikli ${platform === 'ios' ? 'iOS' : 'Android'} uygulaması bulunamadı (${projects.length} proje tarandı).`, 404);
}
export const findAndroidApp = () => findApp('android');

/** App Distribution'daki son sürümler (yeniden eskiye). */
export async function listReleases(limit = 30, platform = 'android') {
  const app = await findApp(platform);
  const num = app.projectNumber || app.appId.split(':')[1];
  const d = await gapi(`https://firebaseappdistribution.googleapis.com/v1/projects/${num}/apps/${app.appId}/releases?pageSize=${limit}`);
  return {
    app,
    releases: (d.releases || []).map((r) => ({
      name: r.name, version: r.displayVersion || '', build: r.buildVersion || '', createdAt: r.createTime || '',
      notes: (r.releaseNotes?.text || '').slice(0, 6000), consoleUrl: r.firebaseConsoleUri || '',
    })),
  };
}

/**
 * İş anahtarları → her platformda işin ilk geldiği ve en son geçtiği sürüm. Sürüm notlarında anahtar aranır.
 * Platform ayarlı değilse ya da Firebase'de bulunamazsa o platform atlanır. 10 dakika saklanır.
 */
const buildCache = new Map();
export async function buildsForKeys(keys) {
  const want = [...new Set((keys || []).filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k)))].slice(0, 60);
  const out = { android: {}, ios: {}, platforms: [] };
  if (!want.length || !(await firebaseUser()).loggedIn) return out;
  for (const platform of ['android', 'ios']) {
    if (!getSettings().run[platform]?.appId) continue;
    let rels;
    const hit = buildCache.get(platform);
    if (hit && Date.now() - hit.at < 10 * 60_000) rels = hit.rels;
    else {
      try { rels = (await listReleases(50, platform)).releases; } catch { continue; }
      buildCache.set(platform, { at: Date.now(), rels });
    }
    out.platforms.push(platform);
    for (const k of want) {
      const re = new RegExp(`\\b${k.replace(/-/g, '\\-')}\\b`);
      const hits = rels.filter((r) => re.test(r.notes));
      if (!hits.length) continue;
      const first = hits.reduce((a, r) => (Number(r.build) < Number(a.build) ? r : a));
      const pick = (r) => ({ version: r.version, build: r.build, createdAt: r.createdAt });
      out[platform][k] = { first: pick(first), latest: pick(hits[0]), count: hits.length };
    }
  }
  return out;
}

const sh = (bin, args, timeout = 120_000) => new Promise((resolve) => {
  execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (e, stdout, stderr) => resolve({ ok: !e, out: `${stdout || ''}${stderr || ''}` }));
});
const adb = () => process.env.ADB || (process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb');

/** Cihazda kurulu sürüm: { version, build } ya da null. */
export async function installedVersion(deviceId) {
  const pkg = getSettings().run.android.appId;
  if (!pkg || !deviceId) return null;
  const r = await sh(adb(), ['-s', deviceId, 'shell', 'dumpsys', 'package', pkg], 20_000);
  const version = r.out.match(/versionName=(\S+)/)?.[1];
  const build = r.out.match(/versionCode=(\d+)/)?.[1];
  return version || build ? { version: version || '', build: build || '' } : null;
}

/**
 * Seçilen sürümü indirip cihaza kurar. İmza farkı yüzünden güncellenemezse (farklı kanal/imza) kullanıcı onayıyla
 * önce kaldırıp kurar: uygulamanın cihazdaki verisi silinir.
 */
export async function installRelease({ releaseName, deviceId, allowUninstall = false, onStep = () => {} }) {
  const app = await findAndroidApp();
  if (!String(releaseName).startsWith(`projects/`)) throw err('Geçersiz sürüm.');
  onStep('Sürüm bilgisi alınıyor');
  const rel = await gapi(`https://firebaseappdistribution.googleapis.com/v1/${releaseName}`);
  if (!rel.binaryDownloadUri) throw err('Bu sürümün indirme adresi alınamadı.');
  const file = path.join(os.tmpdir(), `qahere-${app.packageName}-${rel.buildVersion || 'surum'}-${Date.now()}.apk`);
  onStep(`${rel.displayVersion} (${rel.buildVersion}) indiriliyor`);
  const res = await fetch(rel.binaryDownloadUri, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok) throw err(`APK indirilemedi (${res.status}).`, 502);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  try {
    onStep('Emülatöre kuruluyor');
    let r = await sh(adb(), ['-s', deviceId, 'install', '-r', '-t', '-d', file], 5 * 60_000);
    if (!r.ok || /Failure/.test(r.out)) {
      const reason = r.out.match(/Failure \[([^\]]+)\]/)?.[1] || r.out.trim().slice(-300);
      if (/UPDATE_INCOMPATIBLE|SIGNATURES|VERSION_DOWNGRADE/.test(reason) && allowUninstall) {
        onStep('İmza farklı; eski sürüm kaldırılıp kuruluyor');
        await sh(adb(), ['-s', deviceId, 'uninstall', app.packageName], 60_000);
        r = await sh(adb(), ['-s', deviceId, 'install', '-t', file], 5 * 60_000);
        if (!r.ok || /Failure/.test(r.out)) throw err(`Kurulamadı: ${r.out.match(/Failure \[([^\]]+)\]/)?.[1] || r.out.trim().slice(-300)}`, 500);
      } else if (/UPDATE_INCOMPATIBLE|SIGNATURES/.test(reason)) {
        throw Object.assign(err('Cihazdaki uygulama farklı bir imzayla kurulmuş (ör. başka kanal). Kurmak için önce kaldırmak gerekiyor; bu, uygulamanın cihazdaki verisini (giriş, ayarlar) siler.', 409), { needsUninstall: true });
      } else throw err(`Kurulamadı: ${reason}`, 500);
    }
  } finally { fs.rm(file, { force: true }).catch(() => {}); }
  return { version: rel.displayVersion, build: rel.buildVersion, installed: await installedVersion(deviceId) };
}
