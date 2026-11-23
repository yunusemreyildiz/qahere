// Kontrol maddesini TestMu (LambdaTest) gerçek cihazında koşturma. Hesapta HyperExecute olmadığı için Maestro orada
// doğrudan koşamaz: qaHere'nin sakladığı Maestro akışı (aynı dosya) burada Appium (W3C WebDriver) komutlarına çevrilir.
// Desteklenen komutlar runner.js'teki akış yazma talimatıyla aynıdır. Claude kullanılmaz; koşu yalnızca HTTP'dir.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { getSettings } from './config.js';
import { API, creds, tm } from './testmu.js';
import { readFlow } from './runner.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runs = new Map();

// ---- Maestro akışı → adımlar ------------------------------------------------------------------

async function loadSteps(yaml, appId, depth = 0) {
  if (depth > 3) throw err('runFlow çok iç içe.');
  const docs = YAML.parseAllDocuments(String(yaml).replace(/\$\{APP_ID\}/g, appId)).map((d) => d.toJSON());
  const steps = docs.find(Array.isArray) || [];
  const out = [];
  for (const s of steps) {
    const [cmd, arg] = typeof s === 'string' ? [s, null] : Object.entries(s || {})[0] || [];
    if (cmd === 'runFlow') {
      const file = typeof arg === 'string' ? arg : arg?.file;
      if (!file || !path.isAbsolute(file)) throw err(`runFlow için tam dosya yolu gerekli: ${file}`);
      out.push(...(await loadSteps(await fs.readFile(file, 'utf8'), appId, depth + 1)));
    } else if (cmd) out.push({ cmd, arg });
  }
  return out;
}

/** Maestro seçici → Appium arama stratejileri (sırayla denenir). */
function locators(sel, platform) {
  const s = typeof sel === 'string' ? { text: sel } : sel || {};
  const q = (v) => String(v).replace(/"/g, '\\"');
  if (s.id) {
    return platform === 'android'
      ? [['xpath', `//*[@resource-id="${q(s.id)}" or substring-after(@resource-id, ":id/")="${q(s.id)}" or @content-desc="${q(s.id)}"]`]]
      : [['accessibility id', String(s.id)], ['-ios predicate string', `name == "${q(s.id)}"`]];
  }
  const t = s.text ?? '';
  return platform === 'android'
    ? [['xpath', `//*[@text="${q(t)}" or @content-desc="${q(t)}"]`], ['xpath', `//*[contains(@text, "${q(t)}") or contains(@content-desc, "${q(t)}")]`]]
    : [['-ios predicate string', `label == "${q(t)}" OR name == "${q(t)}" OR value == "${q(t)}"`], ['-ios predicate string', `label CONTAINS "${q(t)}" OR name CONTAINS "${q(t)}"`]];
}
const describe = (sel) => (typeof sel === 'string' ? `"${sel}"` : sel?.id ? `id ${sel.id}` : JSON.stringify(sel));

// ---- WebDriver --------------------------------------------------------------------------------

function driver(c) {
  const authz = `Basic ${Buffer.from(`${c.username}:${c.accessKey}`).toString('base64')}`;
  let sid = '';
  const call = async (method, p, body, timeout = 60_000) => {
    const r = await fetch(`${API.hub}${sid ? `/session/${sid}` : ''}${p}`, {
      method, headers: { Authorization: authz, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.value?.message?.split('\n')[0] || `WebDriver ${r.status}`), { wd: d.value?.error, status: r.status });
    return d.value;
  };
  return {
    get id() { return sid; },
    async start(caps) {
      const v = await call('POST', '/session', { capabilities: { alwaysMatch: caps } }, 8 * 60_000);
      sid = v.sessionId; return v;
    },
    async find(sel, platform) {
      for (const [using, value] of locators(sel, platform)) {
        try { const els = await call('POST', '/elements', { using, value }); if (els?.length) return Object.values(els[0])[0]; } catch { /* sonraki strateji */ }
      }
      return null;
    },
    async waitFor(sel, platform, ms = 10_000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { const e = await this.find(sel, platform); if (e) return e; await sleep(700); }
      return null;
    },
    click: (e) => call('POST', `/element/${e}/click`, {}),
    type: async (text) => { const a = await call('GET', '/element/active'); await call('POST', `/element/${Object.values(a)[0]}/value`, { text: String(text) }); },
    back: () => call('POST', '/back', {}),
    rect: () => call('GET', '/window/rect'),
    actions: (a) => call('POST', '/actions', { actions: a }),
    exec: (script, args = []) => call('POST', '/execute/sync', { script, args }),
    screenshot: () => call('GET', '/screenshot'),
    quit: () => call('DELETE', '', null, 30_000).catch(() => {}),
  };
}

async function swipe(d, direction) {
  const { width, height } = await d.rect();
  const x = Math.round(width / 2);
  const [y1, y2] = direction === 'UP' ? [height * 0.3, height * 0.75] : [height * 0.75, height * 0.3];
  await d.actions([{ type: 'pointer', id: 'f', parameters: { pointerType: 'touch' }, actions: [
    { type: 'pointerMove', duration: 0, x, y: Math.round(y1) }, { type: 'pointerDown', button: 0 },
    { type: 'pointerMove', duration: 450, x, y: Math.round(y2) }, { type: 'pointerUp', button: 0 }] }]);
}

async function step(d, s, platform, log) {
  const { cmd, arg } = s;
  switch (cmd) {
    case 'launchApp': return; // oturum uygulamayı açarak başlar
    case 'waitForAnimationToEnd': await sleep(1200); return;
    case 'back':
      if (platform === 'ios') { log('iOS\'ta geri tuşu yok; adım atlandı.'); return; }
      await d.back(); return;
    case 'tapOn': {
      const e = await d.waitFor(arg, platform);
      if (!e) throw err(`Öğe bulunamadı: ${describe(arg)}`);
      await d.click(e); return;
    }
    case 'inputText': await d.type(arg); return;
    case 'assertVisible': if (!(await d.waitFor(arg, platform, 10_000))) throw err(`Görünmüyor: ${describe(arg)}`); return;
    case 'assertNotVisible': {
      const end = Date.now() + 5000;
      while (Date.now() < end) { if (!(await d.find(arg, platform))) return; await sleep(700); }
      throw err(`Görünmemesi gerekirken görünüyor: ${describe(arg)}`);
    }
    case 'extendedWaitUntil': {
      const ms = Number(arg?.timeout) || 10_000;
      if (arg?.visible && !(await d.waitFor(arg.visible, platform, ms))) throw err(`${ms / 1000} sn içinde görünmedi: ${describe(arg.visible)}`);
      if (arg?.notVisible) { const end = Date.now() + ms; while (Date.now() < end && (await d.find(arg.notVisible, platform))) await sleep(700); }
      return;
    }
    case 'scrollUntilVisible': {
      const target = arg?.element || arg;
      for (let i = 0; i < 10; i++) { if (await d.find(target, platform)) return; await swipe(d, String(arg?.direction || 'DOWN').toUpperCase()); await sleep(500); }
      throw err(`Kaydırarak bulunamadı: ${describe(target)}`);
    }
    default: throw err(`Bu komut TestMu koşusunda desteklenmiyor: ${cmd}`);
  }
}

// ---- Koşu ---------------------------------------------------------------------------------------

export const activeCloudRuns = () => [...runs.values()].filter((r) => r.status === 'running');

/**
 * @param {{ key, id, c, platform, device: { deviceName, platformVersion }, app: string }} o  app: lt://APP… kimliği
 */
export async function startCloudRun({ key, id, c, platform, device, app }) {
  const cr = creds();
  if (!/^lt:\/\/APP[0-9A-Za-z]+$/.test(String(app || ''))) throw err('Önce TestMu\'da koşulacak uygulama sürümünü seç.');
  if (!device?.deviceName) throw err('Bir gerçek cihaz seç.');
  const yaml = await readFlow(key, id, c, platform);
  if (!yaml.trim()) throw err('Bu madde için akış yok. Önce akışı yazdır ya da yaz.');
  const appId = getSettings().run[platform]?.appId || '';
  const steps = await loadSteps(yaml, appId);
  const conc = await tm(`${API.automation}/org/concurrency`).then((d) => d.data).catch(() => null);
  if (conc && conc.running >= conc.max_concurrency) throw err(`TestMu'da boş cihaz hakkı yok (${conc.running}/${conc.max_concurrency} kullanımda). Biraz sonra dene.`, 409);

  const runId = crypto.randomBytes(6).toString('hex');
  const job = { id: runId, key, guideId: id, c: Number(c), platform, target: 'testmu', device: { name: `${device.deviceName} · ${platform === 'ios' ? 'iOS' : 'Android'} ${device.platformVersion}` },
    status: 'running', log: [], message: '', image: null, video: '', sessionUrl: '', startedAt: Date.now(), endedAt: null };
  runs.set(runId, job);
  const log = (l) => { job.log.push(String(l).slice(0, 400)); if (job.log.length > 400) job.log.splice(0, job.log.length - 400); };

  (async () => {
    const d = driver(cr);
    let failed = null;
    try {
      log(`TestMu'da cihaz ayrılıyor: ${job.device.name} (bir iki dakika sürebilir)…`);
      await d.start({
        platformName: platform === 'ios' ? 'iOS' : 'Android',
        'lt:options': {
          deviceName: device.deviceName, platformVersion: String(device.platformVersion), app, isRealMobile: true, w3c: true,
          build: `qaHere ${key}`, project: key, name: `${key} · madde ${c} · ${platform}`,
          video: true, devicelog: true, autoGrantPermissions: true, autoAcceptAlerts: platform === 'ios', idleTimeout: 120,
        },
      });
      log(`Oturum açıldı (${d.id}). ${steps.length} adım koşuluyor.`);
      for (const [i, s] of steps.entries()) {
        if (job.cancelled) throw err('Koşu durduruldu.');
        log(`${i + 1}. ${s.cmd}${s.arg != null ? ` ${typeof s.arg === 'string' ? s.arg : JSON.stringify(s.arg)}` : ''}`);
        await step(d, s, platform, log);
      }
      log('Tüm adımlar geçti.');
    } catch (e) {
      failed = e;
      log(`HATA: ${e.message}`);
    }
    if (d.id) {
      if (failed && !job.cancelled) {
        try { job.image = { name: `${platform}-testmu.png`, type: 'image/png', data: await d.screenshot() }; } catch { /* ekran yok */ }
      }
      await d.exec(`lambda-status=${failed ? 'failed' : 'passed'}`).catch(() => {});
      await d.quit();
      try {
        const v = await tm(`${API.mobile}/sessions/${d.id}/video`);
        job.video = v.url || '';
        if (v.test_execution_link) job.sessionUrl = `https://appautomation.lambdatest.com/test${v.test_execution_link}`;
      } catch { /* video sonra hazır olur */ }
    }
    job.message = failed ? failed.message : '';
    job.endedAt = Date.now();
    job.status = job.cancelled ? 'cancelled' : failed ? (d.id ? 'fail' : 'error') : 'pass';
    setTimeout(() => runs.delete(runId), 30 * 60_000).unref();
  })();
  return publicCloudRun(job);
}

export function publicCloudRun(job, { from = 0 } = {}) {
  return job ? { ...job, log: job.log.slice(from), logTotal: job.log.length } : null;
}
export const getCloudRun = (id) => runs.get(String(id)) || null;
export function cancelCloudRun(id) {
  const job = getCloudRun(id);
  if (!job || job.status !== 'running') return false;
  job.cancelled = true;
  return true;
}

// ---- Cihazlar ve uygulamalar --------------------------------------------------------------------

let deviceCache = null;
const tablet = (d) => (/iPad|Tab\b|Tab S|Fold|Flip/i.test(d.deviceName) ? 1 : 0);
export async function listDevices(platform) {
  if (!deviceCache || Date.now() - deviceCache.at > 60 * 60_000) deviceCache = { at: Date.now(), list: await tm(`${API.mobile}/list?region=us`) };
  return (Array.isArray(deviceCache.list) ? deviceCache.list : []).filter((d) => d.platformName === platform)
    .map((d) => ({ deviceName: d.deviceName, platformVersion: String(d.platformVersion) }))
    // Telefonlar önce (tablet ve katlanabilirler sonda), sonra yeni işletim sistemi.
    .sort((a, b) => tablet(a) - tablet(b) || Number(b.platformVersion) - Number(a.platformVersion) || a.deviceName.localeCompare(b.deviceName));
}

/** TestMu'ya yüklenmiş sürümler (yalnız ayardaki uygulama kimliğine ait olanlar), yeniden eskiye. */
export async function listApps(platform) {
  const pkg = getSettings().run[platform]?.appId || '';
  const d = await tm(`${API.apps}/data?type=${platform}&level=user`);
  return (d.data || []).filter((a) => !pkg || (a.package || a.bundleId) === pkg)
    .map((a) => ({ app: `lt://${a.app_id}`, version: a.version || '', build: a.build_number || '', at: a.updated_at || '' }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
