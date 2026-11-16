// Ayarlar: arayüzden kaydedilenler data/settings.json'da durur (git'e girmez).
// .env değişkenleri yalnızca başlangıç değeri/yedek olarak okunur. Depoda hiçbir kuruma ait değer yoktur.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = process.env.QA_REHBER_DATA_DIR ? path.resolve(process.env.QA_REHBER_DATA_DIR) : path.join(root, 'data');
const file = path.join(dataDir, 'settings.json');

export const SOURCES = ['slack', 'notion', 'confluence', 'docs', 'proxyman'];
export const SOURCE_LABELS = { slack: 'Slack', notion: 'Notion', confluence: 'Confluence', docs: 'Claude Docs', proxyman: 'Proxyman' };
export const MODELS = ['sonnet', 'opus', 'haiku'];
export const DEFAULT_ACCENT = '#0071e3';

let cache = null;
function stored() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = {}; }
  return cache;
}

/** "sirket.atlassian.net/browse/X-1" gibi girdileri "https://sirket.atlassian.net" yapar; geçersizse ''. */
export function normalizeBaseUrl(input) {
  let v = String(input || '').trim();
  if (!v) return '';
  if (!/^[a-z]+:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || !u.hostname.includes('.')) return '';
    return u.origin;
  } catch { return ''; }
}

const projectList = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z][A-Z0-9_]{0,19}$/.test(s)).slice(0, 30);
// Hata kaydı ayarları (yalnızca data/settings.json'da). Platform anahtarları: ios, android, both (iki platform birden).
export const BUG_PLATFORMS = ['ios', 'android', 'both'];
const BUG_NAMES = { ios: 'iOS', android: 'Android', both: 'Mobil' };
const cut = (v, n) => String(v ?? '').trim().slice(0, n);
const perPlatform = (o, fn) => Object.fromEntries(BUG_PLATFORMS.map((k) => [k, fn(o?.[k], k)]));
const fieldsOf = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  try { return JSON.stringify(v).length <= 4000 ? JSON.parse(JSON.stringify(v)) : {}; } catch { return {}; }
};
export function bugSettingsOf(b = {}) {
  return {
    project: projectList([b.project || ''])[0] || '',
    issueType: cut(b.issueType, 60) || 'Bug',
    titleFormat: cut(b.titleFormat, 120) || '{platform} - {konu}',
    names: perPlatform(b.names, (v, k) => cut(v, 30) || BUG_NAMES[k]),
    assignees: perPlatform(b.assignees, (v) => (v && v.id ? { id: cut(v.id, 128), name: cut(v.name, 80) } : null)),
    fields: perPlatform(b.fields, fieldsOf),
    linkType: cut(b.linkType, 60) || 'Relates',
    sprintBoard: /^\d{1,9}$/.test(String(b.sprintBoard || '')) ? String(b.sprintBoard) : '',
    sprintFor: (Array.isArray(b.sprintFor) ? b.sprintFor : []).filter((k) => BUG_PLATFORMS.includes(k)),
  };
}

const accentOf = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');

export function getSettings() {
  const s = stored();
  const env = process.env;
  const fromFile = typeof s.jiraBaseUrl === 'string';
  return {
    workspace: s.workspace ?? env.WORKSPACE_NAME ?? '',
    jiraBaseUrl: fromFile ? s.jiraBaseUrl : normalizeBaseUrl(env.JIRA_BASE_URL),
    jiraEmail: s.jiraEmail || env.JIRA_EMAIL || '',
    // Ortamdaki token yalnızca adres de ortamdan geliyorsa kullanılır; arayüzden girilen adrese başka bir token gitmez.
    jiraApiToken: fromFile ? (s.jiraApiToken || '') : (env.JIRA_API_TOKEN || ''),
    projects: s.projects ? projectList(s.projects) : projectList(env.JIRA_PROJECTS),
    sources: { slack: true, notion: true, confluence: false, docs: false, proxyman: false, ...(s.sources || {}) },
    model: MODELS.includes(s.model) ? s.model : (MODELS.includes(env.CLAUDE_MODEL) ? env.CLAUDE_MODEL : 'sonnet'),
    accent: accentOf(s.accent) || accentOf(env.ACCENT_COLOR) || DEFAULT_ACCENT,
    setupDone: s.setupDone ?? Boolean(normalizeBaseUrl(env.JIRA_BASE_URL)),
    bug: bugSettingsOf(s.bug),
  };
}

/** Arayüze giden hali: token asla dönmez. */
export function publicSettings() {
  const { jiraApiToken, ...rest } = getSettings();
  return { ...rest, hasToken: Boolean(jiraApiToken), jiraConfigured: Boolean(rest.jiraBaseUrl && rest.jiraEmail && jiraApiToken) };
}

export function enabledSources() {
  const s = getSettings().sources;
  return SOURCES.filter((k) => s[k]);
}

export function saveSettings(patch = {}) {
  const cur = getSettings();
  const next = { ...stored() };
  if ('workspace' in patch) next.workspace = String(patch.workspace || '').trim().slice(0, 60);
  if ('jiraBaseUrl' in patch) {
    const url = normalizeBaseUrl(patch.jiraBaseUrl);
    if (patch.jiraBaseUrl && !url) throw Object.assign(new Error('Jira adresi geçersiz. Örnek: sirketin.atlassian.net'), { status: 400 });
    // Adres değişirse eski token yeni adrese gönderilmez; yeniden girilmesi gerekir.
    if (url !== cur.jiraBaseUrl) next.jiraApiToken = '';
    else if (!('jiraApiToken' in next)) next.jiraApiToken = cur.jiraApiToken;
    if (!('jiraEmail' in next)) next.jiraEmail = cur.jiraEmail;
    next.jiraBaseUrl = url;
  }
  if ('jiraEmail' in patch) next.jiraEmail = String(patch.jiraEmail || '').trim().slice(0, 200);
  if (patch.jiraApiToken) next.jiraApiToken = String(patch.jiraApiToken).trim();
  if (patch.clearToken) next.jiraApiToken = '';
  if ('projects' in patch) next.projects = projectList(patch.projects);
  if (patch.sources && typeof patch.sources === 'object') {
    next.sources = { ...cur.sources };
    for (const k of SOURCES) if (k in patch.sources) next.sources[k] = Boolean(patch.sources[k]);
  }
  if ('model' in patch && MODELS.includes(patch.model)) next.model = patch.model;
  if ('accent' in patch) next.accent = accentOf(patch.accent) || DEFAULT_ACCENT;
  if ('setupDone' in patch) next.setupDone = Boolean(patch.setupDone);
  if (patch.bug && typeof patch.bug === 'object') next.bug = bugSettingsOf(patch.bug);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  cache = next;
  return publicSettings();
}
