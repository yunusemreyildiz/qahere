// Rehberin kontrol listesini TestMu Test Manager'a aktarır: her madde bir test senaryosu (test case), istenirse
// işaretlenen sonuçlar platform başına bir test koşusu (test run) olarak işlenir. Yazmayı qaHere yapar (kullanıcı
// önizlemeyi onaylayınca); Claude yok. Aynı rehber yeniden aktarılınca kopya açılmaz: madde → senaryo eşleşmesi
// rehber kaydında (`testManager`) tutulur, yalnız yeni maddeler eklenir, metni değişenler güncellenir.
import fs from 'node:fs/promises';
import { mcpCall } from './testmu.js';
import { guidePaths, readGuideMeta, updateMeta, PLATFORMS } from './store.js';
import { plain } from './ask.js';

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const strip = (h) => plain(String(h)).replace(/\s+/g, ' ').trim();
const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;
const KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;
const STATUS = { pass: 'Passed', fail: 'Failed', na: 'Skipped' };
const PNAME = { ios: 'iOS', android: 'Android' };

/** Kontrol maddeleri: numara, iş/alt başlık, metin, geçersiz mi, hangi bölümde (h2). */
function allItems(html) {
  const out = [];
  let group = '';
  let section = '';
  for (const m of html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>|<h3\b[^>]*>([\s\S]*?)<\/h3>|<li\b([^>]*\bdata-c="(\d+)"[^>]*)>([\s\S]*?)<\/li>/gi)) {
    if (m[1] != null) { section = strip(m[1]); group = ''; continue; }
    if (m[2] != null) { group = strip(m[2]); continue; }
    const text = strip(m[5].replace(/<span class="(?:tag|pf)"[\s\S]*?<\/span>/g, ''));
    if (text) out.push({ c: Number(m[4]), section, group, text, obsolete: /\bdata-obsolete\b/.test(m[3]) });
  }
  return out;
}

/** Senaryo olacak maddeler yalnız "Test kontrol listesi" bölümünden; ortam / test hazırlığı maddeleri ön koşul olur. */
export function checklist(html) {
  const all = allItems(html);
  const isList = (x) => /kontrol listesi|checklist/i.test(x.section);
  const items = all.some(isList) ? all.filter(isList) : all;
  const prep = all.filter((x) => /hazırlı|setup|preparation/i.test(x.section) && !x.obsolete);
  let preconditions = prep.map((x) => `- ${x.text}`).join('\n');
  if (preconditions.length > 2000) preconditions = `${preconditions.slice(0, 1990)}\n…`;
  return Object.assign(items, { preconditions });
}

/** Yanıttan kimlik: önce bilinen alanlar, yoksa metindeki ilk ULID. */
function pickId(d, fields, not = []) {
  for (const o of [d, d?.data, Array.isArray(d?.data) ? d.data[0] : null, d?.result]) {
    if (!o || typeof o !== 'object') continue;
    for (const f of [...fields, 'id']) if ((typeof o[f] === 'string' || typeof o[f] === 'number') && o[f] && !not.includes(String(o[f]))) return String(o[f]);
  }
  // Yanıt yalnız metinse: üst kayıtların (proje, klasör) kimliği dışındaki ilk ULID.
  const m = [...JSON.stringify(d).matchAll(new RegExp(ULID.source, 'g'))].map((x) => x[0]).find((x) => !not.includes(x));
  return m || '';
}

const titleOf = (it) => (it.text.length > 240 ? `${it.text.slice(0, 237)}…` : it.text);

export async function listProjects() {
  const d = await mcpCall('tm_list_projects', { limit: 100 });
  return (d.data || []).map((p) => ({ id: p.id || p.project_id, name: p.name || p.title || '' })).filter((p) => p.id);
}

/** Önizleme: kaç senaryo açılacak / güncellenecek, hangi sonuçlar işlenecek. Hiçbir şey yazmaz. */
export async function exportPreview(key, id) {
  const rec = await readGuideMeta(key, id);
  const items = checklist(await fs.readFile(guidePaths(key, id).html, 'utf8'));
  const tm = rec.testManager || { cases: {} };
  const live = items.filter((x) => !x.obsolete);
  const plan = {
    create: live.filter((x) => !tm.cases?.[x.c]).length,
    update: live.filter((x) => tm.cases?.[x.c] && tm.cases[x.c].t !== titleOf(x)).length,
    archive: items.filter((x) => x.obsolete && tm.cases?.[x.c] && !tm.cases[x.c].archived).length,
    results: Object.fromEntries((rec.platforms || PLATFORMS).map((p) => [p, live.filter((x) => STATUS[rec.results?.[x.c]?.[p]]).length])),
  };
  return { total: live.length, plan, sample: live.slice(0, 5).map((x) => ({ group: x.group, title: titleOf(x) })), previous: rec.testManager ? { projectId: tm.projectId, projectName: tm.projectName, exportedAt: tm.exportedAt, runs: tm.runs || [] } : null };
}

/**
 * Aktarır. `project`: { id } mevcut proje ya da { name } yeni proje. `withResults`: işaretli sonuçları platform başına
 * yeni bir test koşusu olarak işler. onEvent({type:'step', message}).
 */
export async function exportGuide({ key, id, project, withResults = false, onEvent = () => {} }) {
  const rec = await readGuideMeta(key, id);
  const items = checklist(await fs.readFile(guidePaths(key, id).html, 'utf8'));
  if (!items.length) throw err('Rehberde kontrol maddesi yok.');
  const prev = rec.testManager || {};
  const cases = { ...(prev.cases || {}) };
  const warnings = [];
  const step = (message) => onEvent({ type: 'step', message });

  // 1) Proje
  let projectId = project?.id || '';
  let projectName = project?.name || '';
  if (!projectId) {
    if (!projectName.trim()) throw err('Proje seç ya da yeni proje adı yaz.');
    step(`"${projectName}" projesi açılıyor`);
    projectId = pickId(await mcpCall('tm_create_project', { name: projectName.trim().slice(0, 120), description: 'qaHere rehberlerinden aktarılan test senaryoları', tags: ['qaHere'] }), ['project_id']);
    if (!projectId) throw err('TestMu projeyi açtı ama kimliğini döndürmedi.', 502);
  } else if (!projectName) projectName = (await listProjects().catch(() => [])).find((p) => p.id === projectId)?.name || '';
  // Başka projeye aktarılıyorsa eski eşleşme geçerli değil.
  if (prev.projectId && prev.projectId !== projectId) for (const k of Object.keys(cases)) delete cases[k];

  // 2) Klasör: rehber başına bir tane
  let folderId = prev.projectId === projectId ? prev.folderId : '';
  if (!folderId) {
    const name = `${key} · ${(rec.issueSummary || rec.title || '').slice(0, 80)}`.trim();
    step(`"${name}" klasörü açılıyor`);
    folderId = pickId(await mcpCall('tm_create_folder', { project_id: projectId, name, description: `qaHere rehberi ${key}` }), ['folder_id'], [projectId]);
  }

  // 3) Senaryolar
  let jiraLinks = true;
  const live = items.filter((x) => !x.obsolete);
  let n = 0;
  for (const it of live) {
    n += 1;
    const title = titleOf(it);
    const key2 = (it.group.match(KEY) || [key])[0];
    const description = [it.group && `Bölüm: ${it.group}`, it.text.length > 240 ? it.text : '', `qaHere rehberi ${key}, madde ${it.c}`].filter(Boolean).join('\n');
    const known = cases[it.c];
    if (known && known.t === title) continue;
    if (known) {
      step(`Senaryo güncelleniyor (${n}/${live.length})`);
      await mcpCall('tm_update_test_case', { case_id: known.id, project_id: projectId, title, description });
      cases[it.c] = { ...known, t: title };
      continue;
    }
    step(`Senaryo açılıyor (${n}/${live.length})`);
    const caseId = pickId(await mcpCall('tm_create_test_case', {
      project_id: projectId, ...(folderId ? { folder_id: folderId } : {}), title, description,
      type: 'Functional', automation_status: 'Not Automated', ...(items.preconditions ? { preconditions: items.preconditions } : {}), tags: [...new Set([key, key2, 'qaHere'])],
    }), ['case_id', 'test_case_id'], [projectId, folderId]);
    if (!caseId) { warnings.push(`Madde ${it.c} için senaryo kimliği alınamadı.`); continue; }
    cases[it.c] = { id: caseId, t: title };
    if (jiraLinks) {
      try { await mcpCall('tm_link_jira_issue', { entity_type: 'test_case', entity_id: caseId, issue_id: key2 }); }
      catch (e) { jiraLinks = false; warnings.push(`Jira bağlantısı kurulamadı (TestMu'da Jira entegrasyonu açık olmayabilir): ${e.message.replace(/^TestMu: /, '').slice(0, 160)}`); }
    }
  }
  // Geçersiz sayılan maddelerin senaryoları arşivlenir (silme yok).
  for (const it of items.filter((x) => x.obsolete && cases[x.c] && !cases[x.c].archived)) {
    try { await mcpCall('tm_update_test_case', { case_id: cases[it.c].id, project_id: projectId, status: 'Archived' }); cases[it.c] = { ...cases[it.c], archived: true }; }
    catch (e) { warnings.push(`Madde ${it.c} arşivlenemedi: ${e.message.slice(0, 120)}`); }
  }

  // 4) Sonuçlar: platform başına bir test koşusu
  const runs = [...(prev.projectId === projectId ? prev.runs || [] : [])];
  if (withResults) {
    for (const p of rec.platforms || PLATFORMS) {
      const results = live.filter((it) => cases[it.c] && STATUS[rec.results?.[it.c]?.[p]])
        .map((it) => ({ test_case_id: cases[it.c].id, status: STATUS[rec.results[it.c][p]], ...(rec.results[it.c][p] === 'fail' && rec.bugs?.[it.c]?.length ? { remarks: `Hata: ${rec.bugs[it.c].map((b) => b.key).join(', ')}` } : {}) }));
      if (!results.length) continue;
      const title = `${key} · ${PNAME[p]} · ${new Date().toLocaleDateString('tr-TR')}`;
      step(`${PNAME[p]} test koşusu açılıyor (${results.length} sonuç)`);
      const runId = pickId(await mcpCall('tm_create_test_run', { project_id: projectId, title, objective: `qaHere rehberi ${key}: ${PNAME[p]} sonuçları`, test_case_ids: live.filter((it) => cases[it.c]).map((it) => cases[it.c].id), tags: [key, p, 'qaHere'] }), ['run_id', 'test_run_id'], [projectId, folderId, ...Object.values(cases).map((x) => x.id)]);
      if (!runId) { warnings.push(`${PNAME[p]} koşusunun kimliği alınamadı; sonuçlar işlenmedi.`); continue; }
      for (let i = 0; i < results.length; i += 500) await mcpCall('tm_record_test_results', { run_id: runId, results: results.slice(i, i + 500) });
      runs.push({ platform: p, id: runId, title, count: results.length, at: new Date().toISOString() });
    }
  }

  const testManager = { projectId, projectName, folderId, cases, runs, exportedAt: new Date().toISOString() };
  await updateMeta(key, id, (r) => { r.testManager = testManager; });
  return { projectId, projectName, cases: Object.keys(cases).length, runs: runs.slice(prev.runs?.length && prev.projectId === projectId ? prev.runs.length : 0), warnings };
}
