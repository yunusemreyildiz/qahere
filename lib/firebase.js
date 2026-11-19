// Firebase App Distribution'dan Android sürümünü indirip emülatöre kurar: testler doğru sürümde koşsun.
// Kimlik: kullanıcının Firebase CLI girişi ("firebase login"). CLI'ın sakladığı yenileme belirteci kısa ömürlü erişim
// belirtecine çevrilir; qaHere hiçbir parola ya da belirteç saklamaz, yalnızca okur ve indirir.
// Uygulama, Ayarlar → Simülatörde koşu'daki Android paket adından Firebase projelerinde aranır (bir kez, ayarlara yazılır).
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSettings, saveSettings } from './config.js';

// Firebase CLI'ın herkese açık OAuth istemcisi (firebase-tools kaynağında yer alır; gizli değildir).
const CLI_CLIENT = { id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com', secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' };
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const err = (message, status = 400) => Object.assign(new Error(message), { status });

let cached = null; // { token, until }
async function accessToken() {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  let cfg;
  try { cfg = JSON.parse(await fs.readFile(CONFIG, 'utf8')); } catch { throw err('Firebase\'e giriş yapılmamış. Terminalde bir kez "firebase login" çalıştır.'); }
  const refresh = cfg.tokens?.refresh_token;
  if (!refresh) throw err('Firebase\'e giriş yapılmamış. Terminalde bir kez "firebase login" çalıştır.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: CLI_CLIENT.id, client_secret: CLI_CLIENT.secret }),
    signal: AbortSignal.timeout(20_000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw err(`Firebase girişi yenilenemedi (${d.error || r.status}). Terminalde "firebase login --reauth" çalıştır.`);
  cached = { token: d.access_token, until: Date.now() + (d.expires_in || 3000) * 1000 };
  return cached.token;
}

async function gapi(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(30_000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw err(d.error?.message ? `Firebase: ${d.error.message}` : `Firebase ${r.status} döndü.`, r.status === 403 ? 403 : 502);
  return d;
}

export async function firebaseUser() {
  try { const cfg = JSON.parse(await fs.readFile(CONFIG, 'utf8')); return cfg.user?.email ? { loggedIn: true, email: cfg.user.email } : { loggedIn: Boolean(cfg.tokens?.refresh_token) }; } catch { return { loggedIn: false }; }
}

/** Paket adına göre Firebase Android uygulamasını bulur (projeleri gezer); bulunca ayarlara yazar. */
export async function findAndroidApp() {
  const pkg = getSettings().run.android.appId;
  if (!pkg) throw err('Önce Ayarlar → Simülatörde koşu bölümünde Android paket adını gir.');
  const saved = getSettings().firebase?.android;
  if (saved?.appId && saved.packageName === pkg) return saved;
  const projects = [];
  let page = '';
  do {
    const d = await gapi(`https://firebase.googleapis.com/v1beta1/projects?pageSize=100${page ? `&pageToken=${page}` : ''}`);
    projects.push(...(d.results || []));
    page = d.nextPageToken || '';
  } while (page && projects.length < 300);
  for (const p of projects) {
    const d = await gapi(`https://firebase.googleapis.com/v1beta1/projects/${p.projectId}/androidApps?pageSize=100`).catch(() => ({}));
    const app = (d.apps || []).find((a) => a.packageName === pkg);
    if (app) {
      const found = { appId: app.appId, packageName: pkg, projectId: p.projectId, projectNumber: p.projectNumber, name: app.displayName || pkg };
      saveSettings({ firebase: { android: found } });
      return found;
    }
  }
  throw err(`Firebase projelerinde "${pkg}" paket adlı Android uygulaması bulunamadı (${projects.length} proje tarandı). Paket adını ya da Firebase'deki erişimini kontrol et.`, 404);
}

/** App Distribution'daki son sürümler (yeniden eskiye). */
export async function listReleases(limit = 30) {
  const app = await findAndroidApp();
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
