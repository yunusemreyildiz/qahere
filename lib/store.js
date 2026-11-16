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
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function guidePaths(key, id) {
  const dir = path.join(guidesDir, safeKey(key));
  return { dir, html: path.join(dir, `${safeId(id)}.html`), pdf: path.join(dir, `${safeId(id)}.pdf`), meta: path.join(dir, `${safeId(id)}.json`) };
}

export async function saveGuide({ key, body, meta, stats, tree, notes, model }) {
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
<div class="foot">Bu rehber ${escapeHtml(sourceText)} içeriğinden Claude ile otomatik derlendi (${escapeHtml(when)}). Kaynaklar o andaki durumu yansıtır; kritik maddeleri test etmeden önce ilgili kişiyle teyit et.</div>
</body></html>`;
  await fs.writeFile(p.html, html);
  const record = {
    id, key: safeKey(key), title, subtitle: sub, createdAt: now.toISOString(), model, notes: notes || '',
    issueSummary: tree?.issue?.summary || '', childCount: tree?.children?.length ?? null, stats,
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
