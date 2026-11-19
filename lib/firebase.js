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
