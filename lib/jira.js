// Jira REST istemcisi: yalnızca okuma. Liste/arama ve rehber için ön veri toplama.

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

async function jiraFetch(pathAndQuery, c = creds()) {
  if (!(c.baseUrl && c.email && c.token)) {
    const err = new Error('Jira bağlantısı tanımlı değil. Ayarlar\'dan Jira adresini, e-postanı ve API token\'ını gir.');
    err.status = 400;
    throw err;
  }
  const auth = Buffer.from(`${c.email}:${c.token}`).toString('base64');
  let res;
  try {
    res = await fetch(`${c.baseUrl}${pathAndQuery}`, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }, redirect: 'error' });
  } catch {
    const err = new Error('Jira adresine ulaşılamadı. Adresi ve internet bağlantını kontrol et.');
    err.status = 502;
    throw err;
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* html hata sayfası */ }
  if (!res.ok) {
    const msg = data.errorMessages?.join(' ') || data.message || `Jira isteği başarısız (${res.status}).`;
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

export function parseIssueKey(input) {
  const m = String(input || '').toUpperCase().match(/[A-Z][A-Z0-9]+-\d+/);
  return m ? m[0] : null;
}

export async function listEpics(project) {
  const p = String(project || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!p) return [];
  const issues = await search(`project = "${p}" AND issuetype in (Epic, Epik) ORDER BY updated DESC`, { max: 60 })
    .catch(async (e) => {
      // Tür adı farklıysa hiyerarşi seviyesiyle dene
      if (e.status === 400) return search(`project = "${p}" AND hierarchyLevel = 1 ORDER BY updated DESC`, { max: 60 });
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
