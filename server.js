import 'dotenv/config';
import express from 'express';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { jiraConfigured, jiraBaseUrl, listEpics, searchIssues, getIssueTree, parseIssueKey, testConnection } from './lib/jira.js';
import { getSettings, publicSettings, saveSettings } from './lib/config.js';
import { generateGuide } from './lib/generate.js';
import { saveGuide, listGuides, deleteGuide, guidePaths, dataDir, setResults, guideHtml } from './lib/store.js';
import { findBrowser, renderPdf } from './lib/pdf.js';
import { checkUpdate, applyUpdate, RESTART_CODE } from './lib/update.js';

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
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(root, 'public')));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get('/api/health', wrap(async (_req, res) => res.json(await quickHealth())));
app.get('/api/health/connectors', wrap(async (_req, res) => res.json(await connectorHealth())));

app.get('/api/config', (_req, res) => res.json(publicSettings()));
app.put('/api/settings', (req, res) => res.json(saveSettings(req.body || {})));
app.post('/api/jira/test', wrap(async (req, res) => res.json(await testConnection(req.body || {}))));

app.get('/api/epics', wrap(async (req, res) => {
  const project = req.query.project || projects()[0];
  res.json({ epics: project ? await listEpics(project) : [] });
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
  if ([...jobs.values()].some((j) => j.status === 'running')) {
    return res.status(409).json({ error: 'Şu anda bir rehber hazırlanıyor. Bitince ya da iptal edince güncelle.' });
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

  const jobDir = path.join(dataDir, 'jobs', id);
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
