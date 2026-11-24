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

// ---- TestMu MCP sunucusu (Test Manager vb.): Claude'a eklemeden, qaHere'nin kayıtlı anahtarıyla doğrudan (Basic kimlik).
// Kullanıcının ayrıca "claude mcp add" ya da /mcp girişi yapması gerekmez.
const MCP_URL = 'https://mcp.lambdatest.com/mcp';
const sseJson = (text) => { const m = text.match(/^data: (.*)$/m); return JSON.parse(m ? m[1] : text); };
let mcpSession = null; // { who, sid, at } — art arda çağrılarda (aktarma) oturum yeniden açılmasın
export async function mcpCall(name, args = {}, c = creds()) {
  if (!c.username || !c.accessKey) throw err('TestMu kullanıcı adı ve erişim anahtarı ayarlı değil.');
  const H = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Basic ${Buffer.from(`${c.username}:${c.accessKey}`).toString('base64')}` };
  const post = (body, sid) => fetch(MCP_URL, { method: 'POST', headers: sid ? { ...H, 'mcp-session-id': sid } : H, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const who = `${c.username}:${c.accessKey}`;
  const open = async () => {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'qaHere', version: '1' } } });
    if (init.status === 401) throw err('TestMu kullanıcı adını ya da erişim anahtarını kabul etmedi.', 401);
    const sid = init.headers.get('mcp-session-id') || ''; await init.text();
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid).then((r) => r.text());
    mcpSession = { who, sid, at: Date.now() };
    return sid;
  };
  const fresh = !(mcpSession && mcpSession.who === who && Date.now() - mcpSession.at < 10 * 60_000);
  let sid = fresh ? await open() : mcpSession.sid;
  const call = () => post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, sid);
  let r = await call();
  // Oturum sunucuda düşmüşse bir kez yeniden aç.
  if (!fresh && (r.status === 404 || r.status === 400)) { await r.text(); sid = await open(); r = await call(); }
  mcpSession.at = Date.now();
  if (r.status === 401) throw err('TestMu kullanıcı adını ya da erişim anahtarını kabul etmedi.', 401);
  const d = sseJson(await r.text());
  if (d.error) throw err(`TestMu: ${d.error.message}`, 502);
  const text = (d.result?.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
  if (d.result?.isError) throw err(`TestMu: ${text.slice(0, 200)}`, 502);
  const block = text.match(/```json\s*([\s\S]*?)```/);
  try { return block ? JSON.parse(block[1]) : JSON.parse(text); } catch { return { text }; }
}

/** Test Manager'a erişim ve proje sayısı (yalnız okuma). */
export async function testManagerStatus() {
  const d = await mcpCall('tm_list_projects', {});
  const projects = (d.data || []).map((p) => ({ id: p.id || p.project_id, name: p.name || p.title || '' }));
  return { ok: true, total: d.pagination?.total ?? projects.length, projects: projects.slice(0, 10) };
}
