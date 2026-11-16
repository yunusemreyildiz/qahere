// Jira REST istemcisi. Liste/arama ve rehber için ön veri okuma; ayrıca kullanıcının önizleyip onayladığı
// hata kaydını açma (issue, ek, bağlantı, sprint). Yazan uçlar yalnızca arayüzdeki onay düğmesinden çağrılır.

import { getSettings, normalizeBaseUrl } from './config.js';

const FIELDS = 'summary,status,assignee,reporter,issuetype,priority,parent,updated,created,labels,fixVersions';

function creds() {
  const s = getSettings();
  return { baseUrl: s.jiraBaseUrl, email: s.jiraEmail, token: s.jiraApiToken };
}

export function jiraConfigured() {
  const c = creds();
  return Boolean(c.baseUrl && c.email && c.token);
}

export function jiraBaseUrl() {
  return creds().baseUrl;
}

async function jiraFetch(pathAndQuery, c = creds(), { method = 'GET', json, form } = {}) {
  if (!(c.baseUrl && c.email && c.token)) {
    const err = new Error('Jira bağlantısı tanımlı değil. Ayarlar\'dan Jira adresini, e-postanı ve API token\'ını gir.');
    err.status = 400;
    throw err;
  }
  const auth = Buffer.from(`${c.email}:${c.token}`).toString('base64');
  let res;
  try {
    const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };
    let body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) { headers['X-Atlassian-Token'] = 'no-check'; body = form; }
    res = await fetch(`${c.baseUrl}${pathAndQuery}`, { method, headers, body, redirect: 'error' });
  } catch {
    const err = new Error('Jira adresine ulaşılamadı. Adresi ve internet bağlantını kontrol et.');
    err.status = 502;
    throw err;
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* html hata sayfası */ }
  if (!res.ok) {
    const fieldErrors = data.errors && typeof data.errors === 'object' ? Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
    const msg = [data.errorMessages?.join(' '), fieldErrors].filter(Boolean).join(' ') || data.message || `Jira isteği başarısız (${res.status}).`;
    const err = new Error(res.status === 401 ? 'Jira kimlik doğrulaması başarısız. E-posta ve API token\'ı kontrol et.' : msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Girilen bilgilerle Jira'ya bağlanmayı dener; kullanıcı adını ve görülebilen projeleri döner. */
export async function testConnection({ baseUrl, email, token } = {}) {
  const cur = creds();
  const url = normalizeBaseUrl(baseUrl) || '';
  if (!url) throw Object.assign(new Error('Jira adresi geçersiz. Örnek: sirketin.atlassian.net'), { status: 400 });
  const c = {
    baseUrl: url,
    email: String(email || '').trim() || cur.email,
    // Kayıtlı token yalnızca aynı adres için yeniden kullanılır.
    token: String(token || '').trim() || (url === cur.baseUrl ? cur.token : ''),
  };
  if (!c.email || !c.token) throw Object.assign(new Error('E-posta ve API token gerekli.'), { status: 400 });
  const me = await jiraFetch('/rest/api/3/myself', c);
  const pr = await jiraFetch('/rest/api/3/project/search?maxResults=100&orderBy=name', c).catch(() => ({ values: [] }));
  return { ok: true, baseUrl: url, user: me.displayName || '', projects: (pr.values || []).map((p) => ({ key: p.key, name: p.name })) };
}

function slim(issue) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    summary: f.summary || '',
    status: f.status?.name || '',
    statusCategory: f.status?.statusCategory?.key || '',
    type: f.issuetype?.name || '',
    isEpic: f.issuetype?.hierarchyLevel === 1 || /epi[ck]/i.test(f.issuetype?.name || ''),
    isBug: isBugType(f.issuetype?.name),
    assignee: f.assignee?.displayName || '',
    reporter: f.reporter?.displayName || '',
    priority: f.priority?.name || '',
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary || '' } : null,
    updated: f.updated || null,
    url: `${jiraBaseUrl()}/browse/${issue.key}`,
  };
}

async function search(jql, { max = 50, fields = FIELDS } = {}) {
  const q = new URLSearchParams({ jql, fields, maxResults: String(max) });
  const data = await jiraFetch(`/rest/api/3/search/jql?${q}`);
  return data.issues || [];
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const projectKey = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9_]/g, '');

export function parseIssueKey(input) {
  const m = String(input || '').toUpperCase().match(/[A-Z][A-Z0-9]+-\d+/);
  return m ? m[0] : null;
}

export async function listEpics(project) {
  return listIssues({ kind: 'epic', scope: 'all', project });
}

// ---- Liste süzgeçleri: iş türü (epic / hata) ve kapsam (takımım / benim / tümü) ----------------

const cached = new Map(); // anahtar -> { at, value }
async function memo(key, ms, fn) {
  const c = cached.get(key);
  if (c && Date.now() - c.at < ms) return c.value;
  const value = await fn();
  cached.set(key, { at: Date.now(), value });
  return value;
}

/** Bu Jira'daki hata türlerinin adları (Bug, Defect, Hata …) ve ayarlardaki hata kaydı türü. */
export async function bugTypeNames() {
  return memo(`bugtypes:${jiraBaseUrl()}`, 10 * 60_000, async () => {
    const all = await jiraFetch('/rest/api/3/issuetype');
    const extra = String(getSettings().bug?.issueType || '').toLowerCase();
    const names = (Array.isArray(all) ? all : []).filter((t) => !t.subtask)
      .map((t) => t.name).filter((n) => /bug|defect|hata/i.test(n) || n.toLowerCase() === extra);
    return [...new Set(names)];
  });
}

export const isBugType = (name) => /bug|defect|hata/i.test(String(name || '')) || String(name || '').toLowerCase() === String(getSettings().bug?.issueType || '').toLowerCase();

/** Kişinin kendisi (token sahibinin Jira hesabı). E-posta dönmez. */
export async function myself() {
  return memo(`me:${jiraBaseUrl()}:${creds().email}`, 30 * 60_000, async () => {
    const me = await jiraFetch('/rest/api/3/myself');
    return { id: me.accountId, name: me.displayName || '' };
  });
}

/** Projelerdeki panolar (takım seçimi için); name verilirse tüm Jira'da adla aranır. */
export async function listBoards(projectKeys = [], name = '') {
  const n = String(name || '').trim().slice(0, 60);
  const keys = n ? [''] : projectKeys.map(projectKey).filter(Boolean).slice(0, 10);
  const lists = await Promise.all((keys.length ? keys : ['']).map(async (k) => {
    const q = new URLSearchParams({ maxResults: '50' });
    if (k) q.set('projectKeyOrId', k);
    if (n) q.set('name', n);
    const d = await jiraFetch(`/rest/agile/1.0/board?${q}`).catch(() => ({ values: [] }));
    return (d.values || []).map((b) => ({ id: String(b.id), name: b.name, type: b.type, project: b.location?.projectKey || k }));
  }));
  const seen = new Set();
  return lists.flat().filter((b) => !seen.has(b.id) && seen.add(b.id));
}

/** Panonun iş süzgeci (JQL'de "filter = id" olarak kullanılır). */
const boardFilter = (id) => memo(`board:${jiraBaseUrl()}:${id}`, 60 * 60_000, async () => {
  const d = await jiraFetch(`/rest/agile/1.0/board/${encodeURIComponent(id)}/configuration`);
  return d.filter?.id ? String(d.filter.id) : '';
});

/**
 * kind: 'epic' | 'bug'; scope: 'team' (seçili panolar) | 'mine' (atanan ya da raporlayan ben) | 'all' (proje).
 * Hatalarda yalnızca kapanmamış olanlar gelir.
 */
export async function listIssues({ kind = 'epic', scope = 'all', project, projects = [] } = {}) {
  const p = projectKey(project);
  let where;
  if (scope === 'team') {
    const boards = getSettings().profile?.boards || [];
    if (!boards.length) throw Object.assign(new Error('Takımın seçilmedi. Ayarlar → Sen kimsin bölümünden panonu seç.'), { status: 400 });
    const filters = (await Promise.all(boards.map((b) => boardFilter(b.id).catch(() => '')))).filter(Boolean);
    if (!filters.length) throw Object.assign(new Error('Seçili panoların süzgeci okunamadı. Panoya erişimin olduğundan emin ol.'), { status: 400 });
    where = `(${filters.map((f) => `filter = ${f}`).join(' OR ')})`;
  } else if (scope === 'mine') {
    const ps = (p ? [p] : projects.map(projectKey)).filter(Boolean);
    where = `${ps.length ? `project in (${ps.map((k) => `"${k}"`).join(',')}) AND ` : ''}(assignee = currentUser() OR reporter = currentUser())`;
  } else {
    if (!p) return [];
    where = `project = "${p}"`;
  }
  if (kind === 'bug') {
    const types = await bugTypeNames();
    if (!types.length) return [];
    const jql = `${where} AND issuetype in (${types.map((t) => `"${esc(t)}"`).join(',')}) AND statusCategory != Done ORDER BY updated DESC`;
    return (await search(jql, { max: 80 })).map(slim);
  }
  const issues = await search(`${where} AND issuetype in (Epic, Epik) ORDER BY updated DESC`, { max: 60 })
    .catch(async (e) => {
      // Tür adı farklıysa hiyerarşi seviyesiyle dene
      if (e.status === 400) return search(`${where} AND hierarchyLevel = 1 ORDER BY updated DESC`, { max: 60 });
      throw e;
    });
  return issues.map(slim);
}

export async function searchIssues(text, projects = []) {
  const key = parseIssueKey(text);
  if (key && KEY_RE.test(key)) {
    const one = await search(`key = "${key}"`, { max: 1 });
    if (one.length) return one.map(slim);
  }
  const scope = projects.length ? `project in (${projects.map((p) => `"${esc(p)}"`).join(',')}) AND ` : '';
  const issues = await search(`${scope}summary ~ "${esc(text)}" ORDER BY updated DESC`, { max: 30 });
  return issues.map(slim);
}

export async function getIssueTree(key) {
  const k = parseIssueKey(key);
  if (!k) { const e = new Error('Geçersiz issue anahtarı.'); e.status = 400; throw e; }
  const [self] = await search(`key = "${k}"`, { max: 1 });
  if (!self) { const e = new Error(`${k} bulunamadı ya da erişimin yok.`); e.status = 404; throw e; }
  const children = await search(`parent = "${k}" ORDER BY key ASC`, { max: 100 });
  return { issue: slim(self), children: children.map(slim) };
}

// ---- Rehber için tam içerik (açıklama + yorumlar + linkler) -------------------

function adfToText(n) {
  if (!n) return '';
  if (typeof n === 'string') return n;
  if (n.type === 'text') {
    let t = n.text || '';
    for (const m of n.marks || []) if (m.type === 'link' && m.attrs?.href && m.attrs.href !== t) t += ` <${m.attrs.href}>`;
    return t;
  }
  if (n.type === 'inlineCard' || n.type === 'blockCard' || n.type === 'embedCard') return ` <${n.attrs?.url || ''}> `;
  if (n.type === 'mention') return n.attrs?.text || '@?';
  if (n.type === 'emoji') return n.attrs?.text || '';
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'media' || n.type === 'mediaInline') return '[ek dosya]';
  const inner = (n.content || []).map(adfToText).join('');
  switch (n.type) {
    case 'paragraph': return `${inner}\n`;
    case 'heading': return `\n${'#'.repeat(n.attrs?.level || 2)} ${inner}\n`;
    case 'listItem': return `- ${inner.trim()}\n`;
    case 'tableRow': return `| ${(n.content || []).map((c) => adfToText(c).trim().replace(/\n+/g, ' ')).join(' | ')} |\n`;
    case 'codeBlock': return `\n\`\`\`\n${inner}\n\`\`\`\n`;
    case 'blockquote': return inner.split('\n').map((l) => (l ? `> ${l}` : l)).join('\n');
    default: return inner;
  }
}

async function fullIssue(key) {
  const fields = `${FIELDS},description,comment,issuelinks,attachment,components,customfield_10020`;
  const d = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`);
  const f = d.fields || {};
  const sprint = Array.isArray(f.customfield_10020) ? f.customfield_10020.map((s) => s?.name).filter(Boolean).pop() : '';
  return {
    ...slim(d),
    sprint: sprint || '',
    components: (f.components || []).map((c) => c.name),
    fixVersions: (f.fixVersions || []).map((v) => v.name),
    description: adfToText(f.description).replace(/\n{3,}/g, '\n\n').trim(),
    comments: (f.comment?.comments || []).map((c) => ({
      author: c.author?.displayName || '',
      created: (c.created || '').slice(0, 10),
      body: adfToText(c.body).trim(),
    })),
    links: (f.issuelinks || []).map((l) => {
      const o = l.outwardIssue || l.inwardIssue;
      return o ? `${l.outwardIssue ? l.type?.outward : l.type?.inward}: ${o.key} ${o.fields?.summary || ''} [${o.fields?.status?.name || ''}]` : '';
    }).filter(Boolean),
    attachments: (f.attachment || []).map((a) => a.filename),
  };
}

/** Epic (ya da tek issue) ve alt işlerinin tam içeriğini tek metin olarak döner. */
export async function collectForGuide(key, onProgress = () => {}) {
  const { issue, children } = await getIssueTree(key);
  const keys = [issue.key, ...children.map((c) => c.key)];
  const out = [];
  // Jira'yı yormamak için 4'erli gruplar
  for (let i = 0; i < keys.length; i += 4) {
    const batch = keys.slice(i, i + 4);
    onProgress(`Jira okunuyor: ${batch.join(', ')}`);
    out.push(...await Promise.all(batch.map(fullIssue)));
  }
  const text = out.map((it) => [
    `### ${it.key} — ${it.summary}`,
    `Tür: ${it.type} | Durum: ${it.status} | Atanan: ${it.assignee || '-'} | Raporlayan: ${it.reporter || '-'} | Öncelik: ${it.priority || '-'}`
      + ` | Sprint: ${it.sprint || '-'} | Bileşen: ${it.components.join(', ') || '-'} | Sürüm: ${it.fixVersions.join(', ') || '-'}`,
    `URL: ${it.url}`,
    it.links.length ? `Bağlı işler:\n${it.links.map((l) => `- ${l}`).join('\n')}` : '',
    it.attachments.length ? `Ekler: ${it.attachments.join(', ')}` : '',
    `Açıklama:\n${it.description || '(boş)'}`,
    it.comments.length
      ? `Yorumlar (${it.comments.length}):\n${it.comments.map((c) => `- ${c.author} (${c.created}): ${c.body}`).join('\n')}`
      : 'Yorum yok.',
  ].filter(Boolean).join('\n')).join('\n\n---\n\n');
  return { issue, children, text };
}

// ---- Hata kaydı ------------------------------------------------------------------------


export async function listIssueTypes(project) {
  const p = projectKey(project);
  if (!p) return [];
  const d = await jiraFetch(`/rest/api/3/issue/createmeta/${encodeURIComponent(p)}/issuetypes?maxResults=100`);
  return (d.issueTypes || d.values || []).filter((t) => !t.subtask).map((t) => ({ id: t.id, name: t.name }));
}

export async function listLinkTypes() {
  const d = await jiraFetch('/rest/api/3/issueLinkType');
  return (d.issueLinkTypes || []).map((t) => ({ name: t.name, inward: t.inward, outward: t.outward }));
}

/** Projeye atanabilen kişiler (ad ve hesap kimliği; e-posta dönmez). */
export async function searchUsers(query, project) {
  const q = new URLSearchParams({ query: String(query || '').slice(0, 80), maxResults: '20' });
  if (projectKey(project)) q.set('project', projectKey(project));
  const d = await jiraFetch(`/rest/api/3/user/assignable/search?${q}`);
  return (Array.isArray(d) ? d : []).filter((u) => u.accountType !== 'app').map((u) => ({ id: u.accountId, name: u.displayName }));
}

export async function createIssue(fields) {
  const d = await jiraFetch('/rest/api/3/issue', creds(), { method: 'POST', json: { fields } });
  return { key: d.key, url: `${jiraBaseUrl()}/browse/${d.key}` };
}

/** files: [{ name, type, data: Buffer }] */
export async function addAttachments(key, files) {
  if (!files.length) return [];
  const form = new FormData();
  for (const f of files) form.append('file', new Blob([f.data], { type: f.type }), f.name);
  const d = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/attachments`, creds(), { method: 'POST', form });
  return (Array.isArray(d) ? d : []).map((a) => a.filename);
}

export async function linkIssues(typeName, fromKey, toKey) {
  await jiraFetch('/rest/api/3/issueLink', creds(), { method: 'POST', json: { type: { name: typeName }, inwardIssue: { key: fromKey }, outwardIssue: { key: toKey } } });
}

export async function addToActiveSprint(boardId, key) {
  const d = await jiraFetch(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint?state=active`);
  const sprint = (d.values || [])[0];
  if (!sprint) throw Object.assign(new Error('Panoda aktif sprint yok.'), { status: 404 });
  await jiraFetch(`/rest/agile/1.0/sprint/${sprint.id}/issue`, creds(), { method: 'POST', json: { issues: [key] } });
  return sprint.name;
}
