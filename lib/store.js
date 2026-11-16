// Üretilen rehberlerin diskteki arşivi: data/guides/<KEY>/<id>.html + <id>.json
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dataDir, getSettings, enabledSources, SOURCE_LABELS } from './config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export { dataDir };
const guidesDir = path.join(dataDir, 'guides');

const safeKey = (k) => String(k).toUpperCase().replace(/[^A-Z0-9-]/g, '');
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');
// Arayüzdeki maskotun (public/app.js MASCOT) aynısı; rehberin altına imza olarak konur.
const MASCOT = '<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="currentColor"><path d="M9.6 20.5Q5.6 17 5.4 10.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><ellipse cx="5.2" cy="7.4" rx="2.6" ry="3.2" transform="rotate(-12 5.2 7.4)"/><circle cx="7.7" cy="9" r="1.15"/></g><path d="M25 23q3 1.2 3.4 4.6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M11 9h9l6 6v13a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3z" fill="currentColor"/><circle cx="11.6" cy="23.6" r="1.4" fill="#fff" fill-opacity=".28"/><circle cx="22.8" cy="23.6" r="1.4" fill="#fff" fill-opacity=".28"/><path d="M20 9v4a2 2 0 0 0 2 2h4" fill="#fff" fill-opacity=".38"/><circle cx="14" cy="20" r="2.1" fill="#fff"/><circle cx="20.4" cy="20" r="2.1" fill="#fff"/><circle cx="13.4" cy="19.3" r="1" fill="#16191c"/><circle cx="19.8" cy="19.3" r="1" fill="#16191c"/><path d="M15.3 24.4q1.9 1.7 3.8 0" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>';

const escapeHtml =(s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function guidePaths(key, id) {
  const dir = path.join(guidesDir, safeKey(key));
  return { dir, html: path.join(dir, `${safeId(id)}.html`), pdf: path.join(dir, `${safeId(id)}.pdf`), meta: path.join(dir, `${safeId(id)}.json`) };
}

/**
 * Kontrol listesi maddelerine sıra numarası verir (<li data-c="n">). İşaretler bu numarayla saklanır.
 * İç içe liste beklenmez; olursa ilk </ul>'den sonrası numarasız kalır (işaretlenemez, bozulmaz).
 */
export function stampChecks(body) {
  let n = 0;
  const out = String(body).replace(/<ul\b[^>]*\bclass\s*=\s*"[^"]*\bchk\b[^"]*"[^>]*>[\s\S]*?<\/ul>/gi,
    (block) => block.replace(/<li(?=[\s>])(?![^>]*\bdata-c=)/gi, () => `<li data-c="${n++}"`));
  return { body: out, total: n };
}

/** İşaretli maddelere data-done ekler (sunulan sayfa ve PDF için). */
export function applyChecks(html, checks = []) {
  const set = new Set(checks.map(Number));
  return set.size ? html.replace(/<li data-c="(\d+)"/g, (m, i) => (set.has(Number(i)) ? `${m} data-done` : m)) : html;
}

export async function readGuideMeta(key, id) {
  return JSON.parse(await fs.readFile(guidePaths(key, id).meta, 'utf8'));
}

// Aynı rehbere gelen yazmalar sırayla işlenir; eski sürüm (rev) yenisinin üstüne yazılmaz.
const locks = new Map();
export function setChecks(key, id, checks, rev) {
  const k = `${safeKey(key)}/${safeId(id)}`;
  const run = (locks.get(k) || Promise.resolve()).then(() => writeChecks(key, id, checks, rev));
  locks.set(k, run.catch(() => {}));
  return run;
}

async function writeChecks(key, id, checks, rev) {
  const p = guidePaths(key, id);
  const rec = await readGuideMeta(key, id);
  if (Number.isFinite(rev) && rec.checksRev && rev <= rec.checksRev) return rec;
  if (Number.isFinite(rev)) rec.checksRev = rev;
  const total = rec.checkTotal ?? 0;
  rec.checks = [...new Set(checks.map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < total).sort((a, b) => a - b);
  rec.checksUpdatedAt = new Date().toISOString();
  await fs.writeFile(p.meta, JSON.stringify(rec, null, 2));
  await fs.rm(p.pdf, { force: true }); // PDF işaretlerle yeniden üretilsin
  return rec;
}

/** İşaretleri uygulanmış HTML. */
export async function guideHtml(key, id) {
  const p = guidePaths(key, id);
  const html = await fs.readFile(p.html, 'utf8');
  const rec = await readGuideMeta(key, id).catch(() => ({}));
  return applyChecks(html, rec.checks);
}

export async function saveGuide({ key, body: rawBody, meta, stats, tree, notes, model }) {
  const { body, total: checkTotal } = stampChecks(rawBody);
  const now = new Date();
  const id = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const p = guidePaths(key, id);
  await fs.mkdir(p.dir, { recursive: true });
  const css = await fs.readFile(path.join(root, 'templates', 'guide.css'), 'utf8');
  const title = meta.baslik || tree?.issue?.summary || key;
  const sub = meta.altbaslik || '';
  const when = now.toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'short' });
  const { accent, workspace } = getSettings();
  const names = ['Jira', ...enabledSources().map((k) => SOURCE_LABELS[k])];
  const sourceText = names.length > 1 ? `${names.slice(0, -1).join(', ')} ve ${names.at(-1)}` : names[0];
  const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<title>${escapeHtml(key)} – ${escapeHtml(title)} – QA Rehberi</title>
<style>${css}
:root{--brand:${accent}}</style></head><body>
<div class="cover">
  <div class="eyebrow">${workspace ? `${escapeHtml(workspace)} · ` : ''}QA Rehberi · ${escapeHtml(key)}${tree?.issue?.summary ? ` · ${escapeHtml(tree.issue.summary)}` : ''}</div>
  <h1>${escapeHtml(title)}</h1>
  ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}
  <div class="meta">Hazırlanma: ${escapeHtml(when)}${tree?.children?.length ? ` · ${tree.children.length} alt iş` : ''}</div>
</div>
${body}
<div class="foot">${MASCOT}<span>Bu rehber ${escapeHtml(sourceText)} içeriğinden qaHere ile Claude kullanılarak otomatik derlendi (${escapeHtml(when)}). Kaynaklar o andaki durumu yansıtır; kritik maddeleri test etmeden önce ilgili kişiyle teyit et.</span></div>
</body></html>`;
  await fs.writeFile(p.html, html);
  const record = {
    id, key: safeKey(key), title, subtitle: sub, createdAt: now.toISOString(), model, notes: notes || '',
    issueSummary: tree?.issue?.summary || '', childCount: tree?.children?.length ?? null, stats,
    checkTotal, checks: [],
  };
  await fs.writeFile(p.meta, JSON.stringify(record, null, 2));
  return record;
}

export async function listGuides(key) {
  const out = [];
  let dirs = [];
  try { dirs = key ? [safeKey(key)] : await fs.readdir(guidesDir); } catch { return out; }
  for (const d of dirs) {
    let files = [];
    try { files = await fs.readdir(path.join(guidesDir, d)); } catch { continue; }
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      try { out.push(JSON.parse(await fs.readFile(path.join(guidesDir, d, f), 'utf8'))); } catch { /* bozuk kayıt */ }
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteGuide(key, id) {
  const p = guidePaths(key, id);
  await Promise.all([p.html, p.pdf, p.meta].map((f) => fs.rm(f, { force: true })));
}
