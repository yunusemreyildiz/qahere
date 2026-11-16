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

// ---- Kontrol sonuçları --------------------------------------------------------------
// Her madde platform başına sonuç taşır: results = { "<n>": { ios: 'pass'|'fail'|'na', android: … } }.
// Bir madde, rehberin tüm platformlarında "geçti" ya da "uygulanmaz" olunca biter (üstü çizilir).
// "checks" bitmiş maddelerin listesidir; ilerleme ve eski kayıtlarla uyum için tutulur.
export const PLATFORMS = ['ios', 'android'];
const OUTCOMES = new Set(['pass', 'fail', 'na']);
const PLATFORM_LABEL = { ios: 'iOS', android: 'Android' };
const OUTCOME_LABEL = { pass: 'geçti', fail: 'kaldı', na: 'uygulanmaz' };

/** İş başlığı "iOS - …" ya da "Android - …" ("AND - …") ise yalnızca o platform; yoksa ikisi. */
export function inferPlatforms(text = '') {
  const t = String(text).trim();
  if (/^\[?\s*ios\b/i.test(t)) return ['ios'];
  if (/^\[?\s*(android|and)\b/i.test(t)) return ['android'];
  return [...PLATFORMS];
}

const isDone = (r, platforms) => Boolean(r) && platforms.every((p) => r[p] === 'pass' || r[p] === 'na');
const isFail = (r, platforms) => Boolean(r) && platforms.some((p) => r[p] === 'fail');

/** Eski kayıtları yeni biçime çevirir: eski "checks" işaretleri tüm platformlarda geçti sayılır. */
export function normalizeRecord(rec) {
  if (!rec || typeof rec !== 'object') return rec;
  const platforms = Array.isArray(rec.platforms) && rec.platforms.length
    ? rec.platforms.filter((p) => PLATFORMS.includes(p))
    : inferPlatforms(rec.issueSummary || rec.title);
  let results = rec.results && typeof rec.results === 'object' ? rec.results : null;
  if (!results) {
    results = {};
    for (const i of rec.checks || []) results[i] = Object.fromEntries(PLATFORMS.map((p) => [p, 'pass']));
  }
  const done = [], failed = [];
  for (const [i, r] of Object.entries(results)) {
    if (isDone(r, platforms)) done.push(Number(i));
    if (isFail(r, platforms)) failed.push(Number(i));
  }
  const bugs = rec.bugs && typeof rec.bugs === 'object' ? rec.bugs : {};
  return { ...rec, platforms, results, bugs, checks: done.sort((a, b) => a - b), failed: failed.sort((a, b) => a - b) };
}

/** Sonuçları sunulan sayfaya ve PDF'e işler: data-done / data-fail / data-<platform>, madde sonunda kısa etiket. */
export function applyResults(html, rec) {
  const { platforms, results, bugs } = normalizeRecord(rec || {});
  let out = html.replace(/<html\b([^>]*)>/i, (m, a) => (/data-platforms=/.test(a) ? m : `<html${a} data-platforms="${platforms.join(' ')}">`));
  return out.replace(/<li data-c="(\d+)"([^>]*)>([\s\S]*?)<\/li>/g, (m, i, attrs, inner) => {
    const r = results[i] || {};
    const bl = (bugs[i] || []).filter((b) => /^[A-Z][A-Z0-9]+-\d+$/.test(b.key) && /^https:\/\//.test(b.url));
    if (!results[i] && !bl.length) return m;
    let a = `<li data-c="${i}"${attrs}`;
    if (isDone(r, platforms)) a += ' data-done';
    if (isFail(r, platforms)) a += ' data-fail';
    const marks = [];
    for (const p of platforms) {
      if (!OUTCOMES.has(r[p])) continue;
      a += ` data-${p}="${r[p]}"`;
      marks.push(`<b class="${r[p]}">${PLATFORM_LABEL[p]}: ${OUTCOME_LABEL[r[p]]}</b>`);
    }
    for (const b of bl) marks.push(`<a class="bugref" href="${escapeHtml(b.url)}" title="Hata kaydı">${b.key}</a>`);
    return `${a}>${inner}${marks.length ? ` <span class="pf">${marks.join(' ')}</span>` : ''}</li>`;
  });
}

export async function readGuideMeta(key, id) {
  return normalizeRecord(JSON.parse(await fs.readFile(guidePaths(key, id).meta, 'utf8')));
}

// Aynı rehbere gelen yazmalar sırayla işlenir; eski sürüm (rev) yenisinin üstüne yazılmaz.
const locks = new Map();
export function setResults(key, id, input, rev) {
  const k = `${safeKey(key)}/${safeId(id)}`;
  const run = (locks.get(k) || Promise.resolve()).then(() => writeResults(key, id, input, rev));
  locks.set(k, run.catch(() => {}));
  return run;
}

async function writeResults(key, id, { results, platforms }, rev) {
  const p = guidePaths(key, id);
  const rec = await readGuideMeta(key, id);
  if (Number.isFinite(rev) && rec.checksRev && rev <= rec.checksRev) return rec;
  if (Number.isFinite(rev)) rec.checksRev = rev;
  const total = rec.checkTotal ?? 0;
  if (Array.isArray(platforms)) {
    const pl = PLATFORMS.filter((x) => platforms.includes(x));
    if (pl.length) rec.platforms = pl;
  }
  if (results && typeof results === 'object') {
    const clean = {};
    for (const [i, r] of Object.entries(results)) {
      const n = Number(i);
      if (!Number.isInteger(n) || n < 0 || n >= total || !r || typeof r !== 'object') continue;
      const entry = {};
      for (const pl of PLATFORMS) if (OUTCOMES.has(r[pl])) entry[pl] = r[pl];
      if (Object.keys(entry).length) clean[n] = entry;
    }
    rec.results = clean;
  }
  const next = normalizeRecord(rec);
  next.checksUpdatedAt = new Date().toISOString();
  const { failed, ...toSave } = next;
  await fs.writeFile(p.meta, JSON.stringify(toSave, null, 2));
  await fs.rm(p.pdf, { force: true }); // PDF sonuçlarla yeniden üretilsin
  return next;
}

// Rehber kaydedilirken o anki guide.css içine gömülür. Eski rehberler de yeni görünümü (ör. platform etiketleri)
// alsın diye sunarken gömülü stil güncel şablonla değiştirilir; rehberin vurgu rengi (:root{--brand}) korunur.
async function withCurrentCss(html) {
  const css = await fs.readFile(path.join(root, 'templates', 'guide.css'), 'utf8');
  const m = html.match(/<style>([\s\S]*?)\n:root\{--brand:[^}]*\}<\/style>/);
  return m ? html.replace(m[1], () => css) : html;
}

/** Maddeye açılan hata kaydını ekler. */
export function addBug(key, id, c, bug) {
  const k = `${safeKey(key)}/${safeId(id)}`;
  const run = (locks.get(k) || Promise.resolve()).then(async () => {
    const p = guidePaths(key, id);
    const rec = await readGuideMeta(key, id);
    const n = Number(c);
    if (!Number.isInteger(n) || n < 0 || n >= (rec.checkTotal ?? 0)) return rec;
    const list = rec.bugs[n] || [];
    if (!list.some((b) => b.key === bug.key)) list.push({ key: bug.key, url: bug.url, platform: bug.platform, at: new Date().toISOString() });
    rec.bugs = { ...rec.bugs, [n]: list };
    const { failed, ...toSave } = rec;
    await fs.writeFile(p.meta, JSON.stringify(toSave, null, 2));
    await fs.rm(p.pdf, { force: true });
    return rec;
  });
  locks.set(k, run.catch(() => {}));
  return run;
}

/** Sonuçları uygulanmış HTML. */
export async function guideHtml(key, id) {
  const p = guidePaths(key, id);
  const html = await fs.readFile(p.html, 'utf8');
  const rec = await readGuideMeta(key, id).catch(() => ({}));
  return applyResults(await withCurrentCss(html), rec);
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
    checkTotal, checks: [], results: {}, platforms: inferPlatforms(tree?.issue?.summary || title),
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
      try { out.push(normalizeRecord(JSON.parse(await fs.readFile(path.join(guidesDir, d, f), 'utf8')))); } catch { /* bozuk kayıt */ }
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteGuide(key, id) {
  const p = guidePaths(key, id);
  await Promise.all([p.html, p.pdf, p.meta].map((f) => fs.rm(f, { force: true })));
}
