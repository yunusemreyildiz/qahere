// TestMu AI (eski adı LambdaTest) gerçek cihaz bulutu. Kimlik: Ayarlar'daki kullanıcı adı + erişim anahtarı (HTTP Basic).
// API adresleri yeniden adlandırmadan sonra da lambdatest.com alan adında çalışır.
import { getSettings } from './config.js';
import { releaseDownload } from './firebase.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
export const API = {
  mobile: 'https://mobile-api.lambdatest.com/mobile-automation/api/v1',
  automation: 'https://api.lambdatest.com/automation/api/v1',
  apps: 'https://manual-api.lambdatest.com/app',
  hub: 'https://mobile-hub.lambdatest.com/wd/hub',
};

export function creds(override) {
  const t = override?.username ? override : getSettings().testmu;
  if (!t.username || !t.accessKey) throw err('Önce Ayarlar → TestMu bölümünde kullanıcı adı ve erişim anahtarını gir.');
  return t;
}
const auth = (c) => `Basic ${Buffer.from(`${c.username}:${c.accessKey}`).toString('base64')}`;

export async function tm(url, { method = 'GET', body, headers = {}, c, timeout = 30_000 } = {}) {
  const r = await fetch(url, { method, body, headers: { Authorization: auth(c || creds()), ...headers }, signal: AbortSignal.timeout(timeout) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (r.status === 401) throw err('TestMu kullanıcı adını ya da erişim anahtarını kabul etmedi.', 401);
  if (!r.ok) throw err(`TestMu ${r.status}: ${data.message || data.raw || ''}`.trim(), 502);
  return data;
}

/** Bağlantı sınaması: kimlik + (varsa) eşzamanlı oturum hakkı. Girilen ama kaydedilmemiş anahtarla da çalışır. */
export async function testConnection(input = {}) {
  const saved = getSettings().testmu;
  const c = { username: String(input.username || saved.username || '').trim(), accessKey: String(input.accessKey || '').trim() || saved.accessKey };
  if (!c.username || !c.accessKey) throw err('Kullanıcı adı ve erişim anahtarı gerekli.');
  await tm(`${API.mobile}/builds?limit=1`, { c });
  let concurrency = null;
  try {
    const d = await tm(`${API.automation}/org/concurrency`, { c });
    concurrency = d.data || d;
  } catch { /* hesap türüne göre olmayabilir */ }
  return { ok: true, username: c.username, concurrency };
}

/**
 * Firebase App Distribution'daki sürümü TestMu'ya yükler (TestMu dosyayı Firebase'in indirme adresinden kendisi çeker).
 * Aynı paket + sürüm + build zaten yüklüyse yeniden yüklemez. Döner: { app: 'lt://APP…', version, build, reused }.
 */
export async function uploadFromFirebase(platform, releaseName) {
  const rel = await releaseDownload(releaseName);
  const pkg = getSettings().run[platform]?.appId || '';
  const have = await tm(`${API.apps}/data?type=${platform}&level=user`).catch(() => ({ data: [] }));
  const hit = (have.data || []).find((a) => (!pkg || (a.package || a.bundleId) === pkg) && a.version === rel.version && String(a.build_number) === String(rel.build));
  if (hit) return { app: `lt://${hit.app_id}`, version: rel.version, build: rel.build, reused: true };
  const form = new FormData();
  form.set('url', rel.url);
  form.set('name', `qaHere ${rel.version} (${rel.build})`);
  const d = await tm(`${API.apps}/upload/realDevice`, { method: 'POST', body: form, timeout: 10 * 60_000 });
  if (!d.app_id && !d.app_url) throw err(`TestMu yüklemeyi kabul etmedi: ${d.message || JSON.stringify(d).slice(0, 200)}`, 502);
  return { app: d.app_url || `lt://${d.app_id}`, version: rel.version, build: rel.build, reused: false };
}

/** Hesaptaki son otomasyon oturumları (qaHere'den ve başka yerden başlatılanlar), yeniden eskiye. */
export async function recentSessions(limit = 15) {
  const d = await tm(`${API.mobile}/sessions?limit=${Math.min(Math.max(Number(limit) || 15, 1), 50)}`);
  return (d.data || []).map((s) => ({
    id: s.test_id, name: s.name || '', build: s.build_name || '', status: s.status_ind || '', platform: s.platform || '',
    device: s.device || '', os: s.version || '', duration: Number(s.duration) || 0, at: s.create_timestamp || '',
    video: /^https:\/\//.test(s.video_url || '') ? s.video_url : '',
    url: s.test_id ? `https://appautomation.lambdatest.com/test?testID=${encodeURIComponent(s.test_id)}&mobile=true` : '',
  }));
}
