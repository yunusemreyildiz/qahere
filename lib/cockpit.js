// Kokpit: test ortamının sağlık denetimi. Test edilen uygulama (cihaz, kurulu sürüm, çalışıyor mu, çökme, App Links),
// kullanıcının tanımladığı deeplink'ler ve adresler (yalnızca GET), qaHere'nin bağlı olduğu araçlar ve dikkat isteyenler.
// Hiçbir şey yazmaz; cihazda yalnızca kullanıcı isteyince uygulamayı ya da deeplink'i açar.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSettings } from './config.js';
import { devices, screenshot } from './device.js';
import { firebaseUser, listReleases } from './firebase.js';
import { maestroBin } from './runner.js';
import { proxymanStatus } from './proxyman.js';
import { listGuides } from './store.js';
import { meetingsOverview } from './meetings.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const sh = (bin, args, timeout = 15_000) => new Promise((resolve) => {
  execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (e, stdout, stderr) => resolve({ ok: !e, out: `${stdout || ''}${stderr || ''}`, missing: e?.code === 'ENOENT' }));
});
const adb = () => process.env.ADB || (process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb');
// adb shell argümanları cihazdaki kabukta birleştirilir: tek tırnakla korunur.
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Test edilen uygulama -------------------------------------------------------------------

async function androidApp(dev, pkg) {
  const out = { installed: null, running: false, crash: null, appLinks: [] };
  const [dump, pid, crash, links] = await Promise.all([
    sh(adb(), ['-s', dev.id, 'shell', 'dumpsys', 'package', pkg]),
    sh(adb(), ['-s', dev.id, 'shell', 'pidof', pkg]),
    sh(adb(), ['-s', dev.id, 'logcat', '-b', 'crash', '-d', '-v', 'time', '-t', '600']),
    sh(adb(), ['-s', dev.id, 'shell', 'pm', 'get-app-links', pkg]),
  ]);
  const version = dump.out.match(/versionName=(\S+)/)?.[1];
  const build = dump.out.match(/versionCode=(\d+)/)?.[1];
  if (version || build) out.installed = { version: version || '', build: build || '' };
  out.running = pid.ok && /\d/.test(pid.out);
  // "11-23 10:01:02.345 E/AndroidRuntime( 123): Process: com.x, PID: 123" → son çökme.
  const lines = crash.out.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(`Process: ${pkg},`)) {
      const at = lines[i].match(/^(\d\d-\d\d \d\d:\d\d:\d\d)/)?.[1] || '';
      const why = lines.slice(i + 1, i + 4).map((l) => l.replace(/^.*?:\s/, '')).find((l) => /Exception|Error/.test(l)) || '';
      out.crash = { at, detail: why.slice(0, 200) };
      break;
    }
  }
  // "Domain verification state:" altındaki "alan: durum" satırları. verified/approved dışı: Android bağlantıyı uygulamaya vermez.
  const states = links.out.split(/Domain verification state:/)[1] || '';
  for (const m of states.matchAll(/^\s+([a-z0-9.*-]+\.[a-z]{2,}):\s*(\w+)/gim)) {
    out.appLinks.push({ domain: m[1], state: m[2], ok: /^(verified|approved)$/i.test(m[2]) });
  }
  return out;
}

async function iosApp(dev, bundle) {
  const out = { installed: null, running: false, crash: null, appLinks: [] };
  const [info, list] = await Promise.all([
    sh('xcrun', ['simctl', 'appinfo', dev.id, bundle]),
    sh('xcrun', ['simctl', 'spawn', dev.id, 'launchctl', 'list'], 20_000),
  ]);
  let version = info.out.match(/CFBundleShortVersionString\s*=\s*"?([^";\n]+)/)?.[1];
  let build = info.out.match(/CFBundleVersion\s*=\s*"?([^";\n]+)/)?.[1];
  const bundlePath = info.out.match(/\bPath\s*=\s*"([^"]+\.app)"/)?.[1];
  if (bundlePath && !version) {
    const plist = path.join(bundlePath, 'Info.plist');
    const [v, b] = await Promise.all(['CFBundleShortVersionString', 'CFBundleVersion'].map((k) => sh('plutil', ['-extract', k, 'raw', plist])));
    if (v.ok) version = v.out.trim();
    if (b.ok) build = b.out.trim();
  }
  if (version || build) out.installed = { version: version || '', build: build || '' };
  out.running = list.out.includes(`UIKitApplication:${bundle}`);
  // Simülatördeki çökmeler macOS'un tanı raporlarına düşer (.ips, ilk satır JSON başlık).
  const dir = path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports');
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.ips'));
    const since = Date.now() - 3 * 86400_000;
    let last = null;
    for (const f of files) {
      const st = await fs.stat(path.join(dir, f)).catch(() => null);
      if (!st || st.mtimeMs < since || (last && st.mtimeMs < last.ms)) continue;
      const head = (await fs.readFile(path.join(dir, f), 'utf8').catch(() => '')).split('\n')[0];
      try { if (JSON.parse(head).bundleID === bundle) last = { ms: st.mtimeMs, at: st.mtime.toISOString(), detail: f }; } catch { /* başlık değil */ }
    }
    if (last) out.crash = { at: last.at, detail: last.detail };
  } catch { /* klasör yok */ }
  return out;
}

const latestCache = {};
async function latestRelease(platform) {
  const hit = latestCache[platform];
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  let value;
  try {
    if (!(await firebaseUser()).loggedIn) value = { error: 'Firebase girişi yok' };
    else { const r = (await listReleases(1, platform)).releases[0]; value = r ? { version: r.version, build: r.build, createdAt: r.createdAt } : { error: 'Sürüm yok' }; }
  } catch (e) { value = { error: e.message }; }
  latestCache[platform] = { at: Date.now(), value };
  return value;
}

export async function appStatus() {
  const run = getSettings().run;
  const devs = await devices();
  const one = async (platform) => {
    const appId = run[platform]?.appId || '';
    const dev = devs[platform];
    const base = { appId, device: dev, latest: appId ? await latestRelease(platform) : null };
    if (!appId || !dev) return { ...base, installed: null, running: false, crash: null, appLinks: [] };
    return { ...base, ...(platform === 'android' ? await androidApp(dev, appId) : await iosApp(dev, appId)) };
  };
  const [android, ios] = await Promise.all([one('android'), one('ios')]);
  return { android, ios };
}

export async function launchApp(platform) {
  const appId = getSettings().run[platform]?.appId;
  const dev = (await devices())[platform];
  if (!appId) throw err('Önce Ayarlar → Simülatörde koşu bölümünde uygulama kimliğini gir.');
  if (!dev) throw err(platform === 'ios' ? 'Açık bir iOS simülatörü yok.' : 'Bağlı bir Android cihazı yok.');
  const r = platform === 'android'
    ? await sh(adb(), ['-s', dev.id, 'shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'])
    : await sh('xcrun', ['simctl', 'launch', dev.id, appId]);
  if (!r.ok || /No activities found|aborted|error/i.test(r.out)) throw err(`Uygulama açılamadı: ${r.out.trim().slice(-200)}`, 500);
  return { ok: true };
}

// ---- Deeplink ve adresler -------------------------------------------------------------------

/** Tanımlı deeplink'i cihazda açar; hangi ekranın açıldığını ve ekran görüntüsünü döner. */
export async function openDeeplink(index, platform) {
  const link = getSettings().cockpit.deeplinks[Number(index)];
  if (!link) throw err('Deeplink bulunamadı.', 404);
  const dev = (await devices())[platform];
  if (!dev) throw err(platform === 'ios' ? 'Açık bir iOS simülatörü yok.' : 'Bağlı bir Android cihazı yok.');
  const appId = getSettings().run[platform]?.appId || '';
  let result;
  if (platform === 'android') {
    const r = await sh(adb(), ['-s', dev.id, 'shell', `am start -W -a android.intent.action.VIEW -d ${q(link.url)}`], 30_000);
    const activity = r.out.match(/Activity:\s*(\S+)/)?.[1] || '';
    if (/unable to resolve Intent|Error:/i.test(r.out)) result = { ok: false, detail: 'Bu bağlantıyı açan uygulama yok.' };
    else if (appId && activity && !activity.startsWith(`${appId}/`)) result = { ok: false, warn: true, detail: `Uygulama yerine ${activity.split('/')[0]} açtı.`, activity };
    else result = { ok: /Status:\s*ok/i.test(r.out) || Boolean(activity), detail: activity ? `Açılan ekran: ${activity.split('/').pop()}` : r.out.trim().slice(-160), activity };
  } else {
    const r = await sh('xcrun', ['simctl', 'openurl', dev.id, link.url], 30_000);
    result = r.ok ? { ok: true, detail: 'Simülatör bağlantıyı açtı; doğru ekran mı, görüntüye bak.' } : { ok: false, detail: r.out.trim().slice(-200) || 'Açılamadı.' };
  }
  await sleep(1800);
  const shot = await screenshot(platform, dev.id).catch(() => null);
  return { ...result, url: link.url, at: new Date().toISOString(), shot: shot ? `data:image/png;base64,${shot.data}` : null };
}

export async function checkEndpoint(index) {
  const ep = getSettings().cockpit.endpoints[Number(index)];
  if (!ep) throw err('Adres bulunamadı.', 404);
  const t0 = Date.now();
  try {
    const r = await fetch(ep.url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'qaHere-cockpit' } });
    await r.arrayBuffer().catch(() => null);
    return { ok: r.status < 400, status: r.status, ms: Date.now() - t0, at: new Date().toISOString() };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, detail: e.name === 'TimeoutError' ? '10 sn içinde yanıt yok' : e.cause?.code || e.message, at: new Date().toISOString() };
  }
}

/** https deeplink alan adlarında Android assetlinks.json ve iOS apple-app-site-association uygulamayı tanıyor mu. */
export async function checkAssociations() {
  const { cockpit, run } = getSettings();
  const domains = [...new Set(cockpit.deeplinks.map((d) => { try { const u = new URL(d.url); return u.protocol === 'https:' ? u.host : ''; } catch { return ''; } }).filter(Boolean))].slice(0, 8);
  const get = async (url) => {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': 'qaHere-cockpit' } }); return r.ok ? await r.text() : `HTTP ${r.status}`; } catch (e) { return `HATA ${e.cause?.code || e.message}`; }
  };
  return Promise.all(domains.map(async (host) => {
    const [al, aasa] = await Promise.all([get(`https://${host}/.well-known/assetlinks.json`), get(`https://${host}/.well-known/apple-app-site-association`)]);
    const verdict = (text, id) => (!id ? { ok: null, detail: 'Uygulama kimliği girilmedi' }
      : /^(HTTP|HATA) /.test(text) ? { ok: false, detail: `Dosya okunamadı (${text})` }
        : text.includes(id) ? { ok: true, detail: 'Uygulama tanımlı' } : { ok: false, detail: 'Dosyada bu uygulama yok' });
    return { host, android: verdict(al, run.android?.appId), ios: verdict(aasa, run.ios?.appId) };
  }));
}

// ---- qaHere ve araçlar ------------------------------------------------------------------------

export async function toolsStatus() {
  const tasksDir = path.join(os.homedir(), '.claude', 'scheduled-tasks');
  const has = async (id) => fs.access(path.join(tasksDir, id, 'SKILL.md')).then(() => true, () => false);
  const [a, x, m, fb, px, meet, tNotes, tJoin] = await Promise.all([
    sh(adb(), ['version']), sh('xcrun', ['simctl', 'help']), sh(maestroBin(), ['--version'], 20_000),
    firebaseUser(), proxymanStatus(), meetingsOverview(), has('qahere-toplanti-notlari'), has('qahere-toplantiya-claude-ekle'),
  ]);
  let fbHealth = { ok: fb.loggedIn, detail: fb.loggedIn ? (fb.email ? `Giriş: ${fb.email}` : 'Giriş yapılmış') : 'Giriş yok: terminalde firebase login' };
  const plat = ['android', 'ios'].find((p) => getSettings().run[p]?.appId);
  if (fb.loggedIn && plat) {
    const l = await latestRelease(plat);
    if (l.error && /giriş|login|reauth/i.test(l.error)) fbHealth = { ok: false, detail: l.error };
  }
  const ago = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 3600_000) : null);
  const task = (exists, at, name) => {
    if (!exists) return { ok: false, detail: `${name} görevi kurulu değil` };
    const hrs = ago(at);
    if (hrs == null) return { ok: false, warn: true, detail: 'Henüz hiç çalışmadı' };
    return { ok: hrs <= 30, warn: hrs > 30, detail: `Son çalışma ${hrs < 1 ? 'az önce' : `${hrs} saat önce`}`, at };
  };
  return {
    adb: { ok: a.ok, detail: a.ok ? a.out.split('\n')[0].replace('Android Debug Bridge version ', 'adb ') : 'adb bulunamadı (Android SDK platform-tools)' },
    xcode: { ok: x.ok, detail: x.ok ? 'Xcode simülatör araçları hazır' : 'xcrun simctl yok (Xcode kurulu mu?)' },
    maestro: { ok: m.ok, detail: m.ok ? `Maestro ${m.out.trim().split('\n').pop()}` : 'Maestro bulunamadı' },
    firebase: fbHealth,
    proxyman: { ok: px.ok, warn: px.ok && !px.recording, detail: px.detail },
    meetingNotes: task(tNotes, meet.notesRunAt, 'Toplantı notu'),
    meetingJoin: task(tJoin, meet.joinRunAt, 'Toplantıya Claude ekleme'),
    meetingsEnabled: getSettings().meetings.enabled,
  };
}

// ---- Dikkat isteyenler --------------------------------------------------------------------

export async function attention() {
  const guides = await listGuides();
  const latest = new Map();
  for (const g of guides) if (!latest.has(g.key)) latest.set(g.key, g); // listGuides yeniden eskiye sıralı
  const items = [];
  for (const g of latest.values()) {
    const name = g.issueSummary || g.title || g.key;
    const total = g.checkTotal || 0;
    const bugCount = Object.values(g.bugs || {}).flat().length;
    if (g.failed?.length) items.push({ level: 'bad', key: g.key, id: g.id, text: `${g.failed.length} madde kaldı`, sub: name, extra: bugCount ? `${bugCount} hata kaydı açıldı` : 'Hata kaydı açılmadı' });
    if (g.pending?.count) items.push({ level: 'warn', key: g.key, id: g.id, text: `Rehbere ${g.pending.count} güncelleme bekliyor`, sub: name });
    if (total && g.checks.length < total && !g.failed?.length) items.push({ level: 'info', key: g.key, id: g.id, text: `${total - g.checks.length}/${total} madde bitmedi`, sub: name });
  }
  const meet = await meetingsOverview();
  const soon = meet.upcoming.filter((m) => { const t = Date.parse(m.start); return t > Date.now() && t - Date.now() < 36 * 3600_000; });
  return { items, meetings: soon };
}
