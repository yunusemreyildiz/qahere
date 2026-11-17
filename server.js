import 'dotenv/config';
import express from 'express';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { jiraConfigured, jiraBaseUrl, listEpics, searchIssues, getIssueTree, parseIssueKey, testConnection, listIssueTypes, listLinkTypes, searchUsers, listIssues, myself, listBoards } from './lib/jira.js';
import { draftBug, fileBug, draftMockBody } from './lib/bug.js';
import { proxymanStatus, listFlows, flowText, createMock, createMockFromFlow, setMockEnabled, deleteMock } from './lib/proxyman.js';
import { getSettings, publicSettings, saveSettings, enabledSources } from './lib/config.js';
import { generateGuide } from './lib/generate.js';
import { saveGuide, listGuides, deleteGuide, guidePaths, dataDir, setResults, guideHtml, addBug, updateMeta } from './lib/store.js';
import { findBrowser, renderPdf } from './lib/pdf.js';
import { checkUpdate, applyUpdate, RESTART_CODE } from './lib/update.js';
import { askGuide, clearChat, markBugbotFiled } from './lib/ask.js';
import { notifySlackSelf, slackSelfMessage } from './lib/notify.js';
import { parseMcpList, inspectConnector } from './lib/connectors.js';
import { screenshot, devices } from './lib/device.js';
import { readFlow, saveFlow, draftFlow, startRun, getRun, publicRun, cancelRun, activeRun } from './lib/runner.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4310;
const projects = () => getSettings().projects;
const claudeBin = () => process.env.CLAUDE_BIN || 'claude';

// ---- Sağlık denetimi ------------------------------------------------------------

const run = (bin, args, timeout = 15_000) => new Promise((resolve) => {
  execFile(bin, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`, code: err?.code }));
});

async function quickHealth() {
  const v = await run(claudeBin(), ['--version']);
  let jira = { configured: jiraConfigured(), ok: false, detail: 'Tanımlı değil (isteğe bağlı)' };
  if (jira.configured) {
    try { await testConnection({ baseUrl: jiraBaseUrl() }); jira = { configured: true, ok: true, detail: jiraBaseUrl() }; }
    catch (e) { jira = { configured: true, ok: false, detail: e.message }; }
  }
  return {
    claude: { ok: v.ok, detail: v.ok ? v.out.trim().split('\n')[0] : 'Bulunamadı. Claude Code kurulu mu?' },
    jira,
    pdf: { ok: Boolean(findBrowser()), detail: findBrowser() ? path.basename(findBrowser()) : 'Chrome/Edge bulunamadı (tarayıcıdan yazdırabilirsin)' },
    model: getSettings().model,
  };
}

/** Yavaş (10–30 sn): Claude Code'un bağlantı listesini okur. */
async function connectorHealth() {
  const r = await run(claudeBin(), ['mcp', 'list'], 90_000);
  const find = (re) => {
    const line = r.out.split('\n').find((l) => re.test(l));
    if (!line) return { ok: false, detail: 'Bağlantı yok' };
    if (/✔|✓|connected/i.test(line) && !/needs auth/i.test(line)) return { ok: true, detail: 'Bağlı' };
    return { ok: false, detail: /auth/i.test(line) ? 'Giriş gerekiyor' : 'Bağlanamadı' };
  };
  return {
    ran: r.ok || r.out.length > 0,
    slack: find(/slack/i),
    notion: find(/notion/i),
    atlassian: find(/atlassian(?! rovo)|jira/i),
    confluence: find(/atlassian(?! rovo)|confluence/i),
    docs: find(/claude docs/i),
    figma: find(/figma/i),
    proxyman: find(/proxyman/i),
  };
}

if (process.argv.includes('--doctor')) {
  const mark = (x) => (x.ok ? '✔' : '✘');
  const h = await quickHealth();
  console.log(`${mark(h.claude)} Claude Code   ${h.claude.detail}`);
  console.log(`${h.jira.configured ? mark(h.jira) : '–'} Jira token    ${h.jira.detail}`);
  console.log(`${mark(h.pdf)} PDF           ${h.pdf.detail}`);
  if (h.claude.ok) {
    console.log('  Bağlantılar denetleniyor (yarım dakika sürebilir)…');
    const c = await connectorHealth();
    console.log(`${mark(c.slack)} Slack         ${c.slack.detail}`);
    console.log(`${mark(c.notion)} Notion        ${c.notion.detail}`);
    console.log(`${mark(c.atlassian)} Atlassian     ${c.atlassian.detail}${h.jira.ok ? ' (token olduğu için şart değil)' : ''}`);
  }
  process.exit(0);
}

// ---- Uygulama -----------------------------------------------------------------

const app = express();

// Yalnızca bu bilgisayardaki tarayıcıdan gelen istekler kabul edilir: başka bir sitenin bu sunucuya
// istek atıp (DNS rebinding / CSRF) ayarları değiştirmesini ya da token kullandırmasını engeller.
const LOCAL_HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`];
app.use((req, res, next) => {
  if (!LOCAL_HOSTS.includes(String(req.headers.host || '').toLowerCase())) return res.status(403).json({ error: 'Bu adres üzerinden erişim kapalı.' });
  const origin = req.headers.origin;
  if (origin && !['GET', 'HEAD'].includes(req.method)) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* geçersiz origin */ }
    if (!LOCAL_HOSTS.includes(host)) return res.status(403).json({ error: 'Bu kaynaktan gelen istek reddedildi.' });
  }
  next();
});
// Hata kaydı ekran görüntüleri taşıdığı için yalnızca o uçta sınır büyük.
const jsonSmall = express.json({ limit: '100kb' });
const jsonLarge = express.json({ limit: '40mb' });
app.use((req, res, next) => (req.path === '/api/bugs' ? jsonLarge : jsonSmall)(req, res, next));
app.use(express.static(path.join(root, 'public')));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get('/api/health', wrap(async (_req, res) => res.json(await quickHealth())));
// Diğer Claude bağlantıları: listele (claude mcp list) ve bir bağlantının okuma araçlarını çıkar (ToolSearch).
app.get('/api/connectors', wrap(async (_req, res) => {
  const r = await run(claudeBin(), ['mcp', 'list'], 90_000);
  const saved = getSettings().connectors || {};
  res.json({ connectors: parseMcpList(r.out).map((c) => ({ ...c, saved: saved[c.name] || null })) });
}));
app.post('/api/connectors/inspect', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Bağlantı adı gerekli.' });
  res.json(await inspectConnector(name));
}));
app.get('/api/health/connectors', wrap(async (_req, res) => res.json(await connectorHealth())));

app.get('/api/config', (_req, res) => res.json(publicSettings()));
app.put('/api/settings', (req, res) => res.json(saveSettings(req.body || {})));
app.post('/api/jira/test', wrap(async (req, res) => res.json(await testConnection(req.body || {}))));

app.get('/api/epics', wrap(async (req, res) => {
  const project = req.query.project || projects()[0];
  res.json({ epics: project ? await listEpics(project) : [] });
}));

app.get('/api/list', wrap(async (req, res) => {
  const kind = req.query.kind === 'bug' ? 'bug' : 'epic';
  const scope = ['team', 'mine', 'all'].includes(req.query.scope) ? req.query.scope : 'all';
  const project = req.query.project || projects()[0];
  res.json({ issues: await listIssues({ kind, scope, project, projects: projects() }) });
}));
app.get('/api/me', wrap(async (_req, res) => res.json(await myself())));
app.get('/api/jira/boards', wrap(async (req, res) => {
  const keys = String(req.query.projects || '').split(',').filter(Boolean);
  res.json({ boards: await listBoards(keys.length ? keys : projects(), req.query.q) });
}));

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ issues: [] });
  res.json({ issues: await searchIssues(q, projects()) });
}));

app.get('/api/issues/:key', wrap(async (req, res) => {
  const key = parseIssueKey(req.params.key);
  if (!key) return res.status(400).json({ error: 'Geçersiz issue anahtarı.' });
  const guides = await listGuides(key);
  if (!jiraConfigured()) return res.json({ issue: { key, summary: '', url: '' }, children: [], guides, limited: true });
  res.json({ ...(await getIssueTree(key)), guides });
}));

// ---- Üretim işleri ---------------------------------------------------------------

const jobs = new Map(); // id -> { key, events[], listeners:Set, status, child, guide, error }

function emit(job, ev) {
  const e = { ...ev, at: Date.now() };
  job.events.push(e);
  for (const l of job.listeners) l(e);
}

// ---- Güncelleme ----------------------------------------------------------------

app.get('/api/update', wrap(async (req, res) => res.json(await checkUpdate({ force: req.query.force === '1' }))));
app.post('/api/update', wrap(async (_req, res) => {
  if ([...jobs.values()].some((j) => j.status === 'running') || activeRun()) {
    return res.status(409).json({ error: 'Şu anda bir rehber hazırlanıyor ya da test koşuyor. Bitince ya da durdurunca güncelle.' });
  }
  const r = await applyUpdate();
  res.json(r);
  if (r.updated && r.restart === 'auto') setTimeout(() => process.exit(RESTART_CODE), 300);
}));

app.post('/api/guides', wrap(async (req, res) => {
  const key = parseIssueKey(req.body?.key);
  if (!key) return res.status(400).json({ error: 'Geçerli bir issue anahtarı gerekli (örn. PROJ-123).' });
  const running = [...jobs.entries()].find(([, j]) => j.status === 'running');
  if (running) {
    return res.status(409).json({ error: `Şu an ${running[1].key} için bir rehber üretiliyor. Bitmesini bekle ya da iptal et.`, jobId: running[0], key: running[1].key });
  }
  const notes = String(req.body?.notes || '').trim();
  const id = crypto.randomBytes(6).toString('hex');
  const job = { key, events: [], listeners: new Set(), status: 'running', child: null, cancelled: false, startedAt: Date.now() };
  jobs.set(id, job);
  res.status(202).json({ jobId: id, key });

  // Depo dışında çalışır: Claude Code üst klasörlerdeki CLAUDE.md'yi talimata eklemesin (token ve dikkat).
  const jobDir = path.join(os.tmpdir(), 'qahere-jobs', id);
  try {
    const g = await generateGuide({ key, notes, jobDir, onEvent: (ev) => emit(job, ev) });
    job.child = g.child;
    if (job.cancelled) g.child.kill('SIGTERM');
    const out = await g.done;
    const guide = await saveGuide({ key, ...out, tree: g.tree, notes, model: getSettings().model });
    job.status = 'done';
    job.guide = guide;
    emit(job, { type: 'done', guide });
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
    emit(job, { type: 'error', message: e.message });
  } finally {
    fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    setTimeout(() => jobs.delete(id), 30 * 60_000).unref();
  }
}));

app.get('/api/jobs/active', (_req, res) => {
  const r = [...jobs.entries()].find(([, j]) => j.status === 'running');
  res.json(r ? { jobId: r[0], key: r[1].key } : {});
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'İş bulunamadı.' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  send({ type: 'start', key: job.key, startedAt: job.startedAt });
  job.events.forEach(send);
  if (job.status !== 'running') return res.end();
  const l = (e) => { send(e); if (e.type === 'done' || e.type === 'error') res.end(); };
  job.listeners.add(l);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => { clearInterval(ping); job.listeners.delete(l); });
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'running') return res.status(404).json({ error: 'Çalışan iş bulunamadı.' });
  job.cancelled = true;
  job.child?.kill('SIGTERM');
  res.json({ ok: true });
});

// ---- Arşiv ----------------------------------------------------------------------

app.get('/api/guides', wrap(async (req, res) => res.json({ guides: await listGuides(req.query.key ? parseIssueKey(req.query.key) : undefined) })));

app.delete('/api/guides/:key/:id', wrap(async (req, res) => {
  await deleteGuide(req.params.key, req.params.id);
  res.json({ ok: true });
}));

// Rehbere sor: yanıt satır satır JSON olarak akar (step / delta / reset / done / error).
const asking = new Set();
app.post('/api/guides/:key/:id/:mode(ask|bugbot)', wrap(async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 2000);
  if (!question) return res.status(400).json({ error: 'Bir soru yaz.' });
  const mode = req.params.mode;
  const k = `${req.params.key}/${req.params.id}/${mode}`;
  if (asking.has(k)) return res.status(409).json({ error: 'Bu rehbere sorulan önceki soru hâlâ yanıtlanıyor.' });
  asking.add(k);
  let run;
  try {
    // Bugbot yanıtının sonundaki gizli taslak satırı ekrana akmaz.
    let held = '';
    const onEvent = (e) => {
      if (mode === 'bugbot' && e.type === 'delta') {
        held += e.text;
        const cut = held.indexOf('<!--');
        if (cut === -1) { const safe = held.length > 4 ? held.slice(0, -4) : ''; if (safe) res.write(`${JSON.stringify({ type: 'delta', text: safe })}\n`); held = held.slice(safe.length); }
        else { if (cut > 0) res.write(`${JSON.stringify({ type: 'delta', text: held.slice(0, cut) })}\n`); held = held.slice(cut); }
        return;
      }
      if (e.type === 'reset') held = '';
      res.write(`${JSON.stringify(e)}\n`);
    };
    const platform = ['ios', 'android', 'both'].includes(req.body?.platform) ? req.body.platform : undefined;
    run = await askGuide({ key: req.params.key, id: req.params.id, question, deep: Boolean(req.body?.deep), mode, platform, onEvent });
  } catch (e) { asking.delete(k); throw e; }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.flushHeaders();
  // Pencere kapanır ya da kullanıcı durdurursa Claude da durur.
  res.on('close', () => { if (!res.writableEnded) { run.child.kill('SIGTERM'); asking.delete(k); } });
  try {
    const { entry } = await run.done;
    res.end(`${JSON.stringify({ type: 'done', entry })}\n`);
  } catch (e) {
    if (!res.writableEnded) res.end(`${JSON.stringify({ type: 'error', message: e.message })}\n`);
  } finally { asking.delete(k); }
}));
app.delete('/api/guides/:key/:id/:mode(chat|bugbot)', wrap(async (req, res) => {
  await clearChat(req.params.key, req.params.id, req.params.mode === 'bugbot' ? 'bugbot' : 'ask');
  res.json({ ok: true });
}));
app.post('/api/guides/:key/:id/bugbot/filed', wrap(async (req, res) => {
  const { key, id } = req.params;
  const at = String(req.body?.at || '');
  const bug = req.body?.bug;
  const notify = Boolean(req.body?.notify) && enabledSources().includes('slack');
  const ok = await markBugbotFiled(key, id, at, bug, notify ? { slack: 'sending' } : {});
  res.json({ ok, slack: ok && notify ? 'sending' : null });
  if (!ok || !notify) return;
  // Kullanıcı önizlemede "Slack'ten bana bildir"i onayladı: mesajı qaHere hazırlar, Claude yalnızca kullanıcının kendisine iletir.
  const r = await notifySlackSelf(slackSelfMessage({ bug, storyKey: parseIssueKey(key), summary: String(req.body?.summary || '') }));
  await markBugbotFiled(key, id, at, bug, { slack: r.ok ? 'sent' : `error: ${r.error}` }).catch(() => {});
  if (!r.ok) console.warn('Slack bildirimi gönderilemedi:', r.error);
}));

// Kontrol maddelerinin platform sonuçları. PDF bir sonraki indirmede bunlarla yeniden üretilir.
app.put('/api/guides/:key/:id/results', wrap(async (req, res) => {
  const p = guidePaths(req.params.key, req.params.id);
  if (!fs.existsSync(p.meta)) return res.status(404).json({ error: 'Rehber bulunamadı.' });
  const { results, platforms } = req.body || {};
  if (results != null && (typeof results !== 'object' || Array.isArray(results))) return res.status(400).json({ error: 'results bir nesne olmalı.' });
  if (platforms != null && !Array.isArray(platforms)) return res.status(400).json({ error: 'platforms bir dizi olmalı.' });
  const rec = await setResults(req.params.key, req.params.id, { results, platforms }, Number(req.body.rev));
  res.json({ checks: rec.checks, failed: rec.failed, checkTotal: rec.checkTotal, platforms: rec.platforms });
}));

// ---- Hata kaydı ----------------------------------------------------------------

app.get('/api/jira/issuetypes', wrap(async (req, res) => res.json({ types: await listIssueTypes(req.query.project) })));
app.get('/api/jira/linktypes', wrap(async (_req, res) => res.json({ types: await listLinkTypes() })));
app.get('/api/jira/users', wrap(async (req, res) => res.json({ users: await searchUsers(req.query.q, req.query.project) })));

app.post('/api/bugs/draft', wrap(async (req, res) => res.json(await draftBug(req.body || {}))));

// Kullanıcının önizleyip onayladığı kaydı açar ve rehberdeki maddeye bağlar.
app.post('/api/bugs', wrap(async (req, res) => {
  if (!jiraConfigured()) return res.status(400).json({ error: 'Hata kaydı açmak için Ayarlar\'dan Jira token\'ını gir.' });
  const b = req.body || {};
  const storyKey = parseIssueKey(b.storyKey);
  const bug = await fileBug({ storyKey, platform: b.platform, summary: b.summary, description: b.description, images: Array.isArray(b.images) ? b.images : [], flows: Array.isArray(b.flows) ? b.flows : [] });
  if (storyKey && b.guideId != null && b.c != null) {
    const p = guidePaths(storyKey, String(b.guideId));
    if (fs.existsSync(p.meta)) await addBug(storyKey, String(b.guideId), b.c, bug).catch(() => {});
  }
  res.json(bug);
}));

// ---- Proxyman (qaHere doğrudan konuşur; Claude'a araç verilmez) -------------------------

app.get('/api/proxyman/status', wrap(async (_req, res) => res.json(await proxymanStatus())));
app.get('/api/proxyman/flows', wrap(async (req, res) => res.json({ flows: await listFlows({ q: req.query.q, limit: req.query.limit }) })));
app.get('/api/proxyman/flows/:id', wrap(async (req, res) => res.json({ text: await flowText(req.params.id) })));
app.post('/api/proxyman/mock-draft', wrap(async (req, res) => res.json(await draftMockBody(req.body || {}))));

const guideOf = (b) => {
  const key = parseIssueKey(b?.key);
  const id = String(b?.guideId || '');
  if (!key || !id || !fs.existsSync(guidePaths(key, id).meta)) throw Object.assign(new Error('Rehber bulunamadı.'), { status: 404 });
  return { key, id };
};

// Maddeye mock kurar: yakalanan yanıttan ya da verilen gövdeden. Kural rehberde kayıtlı tutulur ki kapatılabilsin.
app.post('/api/proxyman/mocks', wrap(async (req, res) => {
  const b = req.body || {};
  const { key, id } = guideOf(b);
  const c = Number(b.c);
  const name = `qaHere · ${key}${Number.isInteger(c) ? ` · madde ${c + 1}` : ''}`;
  const rule = b.from === 'flow'
    ? { ...(await createMockFromFlow({ name, flowId: b.flowId })), url: String(b.url || '').slice(0, 2000), method: b.method || 'ANY', status: null }
    : await createMock({ name, url: b.url, method: b.method, status: b.status, body: b.body });
  const mock = { id: rule.id, c: Number.isInteger(c) ? c : null, name, url: rule.url, method: rule.method, status: rule.status, enabled: true, at: new Date().toISOString() };
  const rec = await updateMeta(key, id, (r) => { r.mocks = [...(Array.isArray(r.mocks) ? r.mocks : []), mock]; });
  res.json({ mock, mocks: rec.mocks });
}));

app.put('/api/proxyman/mocks/:rid', wrap(async (req, res) => {
  const { key, id } = guideOf(req.body);
  const enabled = Boolean(req.body.enabled);
  await setMockEnabled(req.params.rid, enabled);
  const rec = await updateMeta(key, id, (r) => { r.mocks = (r.mocks || []).map((m) => (m.id === req.params.rid ? { ...m, enabled } : m)); });
  res.json({ mocks: rec.mocks });
}));

app.delete('/api/proxyman/mocks/:rid', wrap(async (req, res) => {
  const { key, id } = guideOf(req.query);
  // Proxyman'de zaten silinmişse de rehberden kaldırılır.
  await deleteMock(req.params.rid).catch((e) => { if (!/not found|bulunamad/i.test(e.message)) throw e; });
  const rec = await updateMeta(key, id, (r) => { r.mocks = (r.mocks || []).filter((m) => m.id !== req.params.rid); });
  res.json({ mocks: rec.mocks });
}));

// ---- Simülatörde koşu (Maestro) ------------------------------------------------------------

app.get('/api/devices', wrap(async (_req, res) => res.json(await devices())));
const flowArgs = (o) => { const g = guideOf(o); return { key: g.key, id: g.id, c: Number(o.c), platform: o.platform }; };
app.get('/api/flows', wrap(async (req, res) => { const a = flowArgs(req.query); res.json({ yaml: await readFlow(a.key, a.id, a.c, a.platform) }); }));
app.put('/api/flows', wrap(async (req, res) => { const a = flowArgs(req.body); res.json(await saveFlow(a.key, a.id, a.c, a.platform, req.body.yaml)); }));
app.post('/api/flows/draft', wrap(async (req, res) => {
  const a = flowArgs(req.body);
  res.json(await draftFlow({ ...a, item: req.body.item, section: req.body.section }));
}));
app.post('/api/runs', wrap(async (req, res) => res.json(await startRun(flowArgs(req.body)))));
app.get('/api/runs/:id', (req, res) => {
  const job = getRun(req.params.id);
  if (!job) return res.status(404).json({ error: 'Koşu bulunamadı.' });
  res.json(publicRun(job, { from: Number(req.query.from) || 0 }));
});
app.post('/api/runs/:id/cancel', (req, res) => res.json({ ok: cancelRun(req.params.id) }));

// Açık simülatörden ya da emülatörden ekran görüntüsü (yerel komutlar; dışarıya bir şey gitmez).
app.post('/api/screenshot', wrap(async (req, res) => res.json(await screenshot(req.body?.platform))));

app.get('/guides/:key/:id.html', wrap(async (req, res) => {
  const p = guidePaths(req.params.key, req.params.id);
  if (!fs.existsSync(p.html)) return res.status(404).send('Rehber bulunamadı.');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox allow-popups allow-popups-to-escape-sandbox");
  res.set('Cache-Control', 'no-store');
  res.type('html').send(await guideHtml(req.params.key, req.params.id));
}));

app.get('/guides/:key/:id.pdf', wrap(async (req, res) => {
  const p = guidePaths(req.params.key, req.params.id);
  if (!fs.existsSync(p.html)) return res.status(404).json({ error: 'Rehber bulunamadı.' });
  if (!fs.existsSync(p.pdf)) {
    // İşaretler uygulanmış geçici bir kopyadan basılır.
    const tmp = p.html.replace(/\.html$/, '.print.html');
    await fsp.writeFile(tmp, await guideHtml(req.params.key, req.params.id));
    try { await renderPdf(tmp, p.pdf); } finally { fsp.rm(tmp, { force: true }).catch(() => {}); }
  }
  res.download(p.pdf, `${path.basename(p.dir)}-QA-Rehberi.pdf`);
}));

app.use((err, _req, res, _next) => {
  res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500).json({ error: err.message || 'Beklenmeyen hata.' });
});

// Yalnızca bu bilgisayardan erişilir: araç senin Jira token'ını ve Claude oturumunu kullanır.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`qaHere hazır → http://localhost:${PORT}`);
  if (!getSettings().setupDone) console.log('İlk açılış: tarayıcıdaki kurulum adımlarını izle.');
});
