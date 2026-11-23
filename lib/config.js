// Ayarlar: arayüzden kaydedilenler data/settings.json'da durur (git'e girmez).
// .env değişkenleri yalnızca başlangıç değeri/yedek olarak okunur. Depoda hiçbir kuruma ait değer yoktur.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = process.env.QA_REHBER_DATA_DIR ? path.resolve(process.env.QA_REHBER_DATA_DIR) : path.join(root, 'data');
const file = path.join(dataDir, 'settings.json');

export const SOURCES = ['slack', 'notion', 'confluence', 'figma', 'docs', 'proxyman'];
export const SOURCE_LABELS = { slack: 'Slack', notion: 'Notion', confluence: 'Confluence', figma: 'Figma', docs: 'Claude Docs', proxyman: 'Proxyman' };
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

// Simülatörde koşu (Maestro): uygulama kimliği ve isteğe bağlı ön akış (ör. giriş) dosyası. Yalnızca yerel.
const runPlatformOf = (v = {}) => ({
  appId: /^[A-Za-z][\w.-]{1,150}$/.test(String(v.appId || '').trim()) ? String(v.appId).trim() : '',
  setupFlow: cut(v.setupFlow, 500),
});
export const runSettingsOf = (r = {}) => ({ ios: runPlatformOf(r.ios), android: runPlatformOf(r.android) });

// Kullanıcının kendisi: rolü, test ettiği platformlar ve takımı (Jira panoları). Liste süzgeci ve rehber talimatı için.
export const ROLES = { qa: 'QA (test)', dev: 'Geliştirici', product: 'Ürün / analist', other: 'Diğer' };
export function profileOf(p = {}) {
  const platforms = (Array.isArray(p.platforms) ? p.platforms : []).filter((k) => ['ios', 'android'].includes(k));
  const boards = (Array.isArray(p.boards) ? p.boards : [])
    .filter((b) => b && /^\d{1,9}$/.test(String(b.id)))
    .map((b) => ({ id: String(b.id), name: cut(b.name, 80) })).slice(0, 10);
  return { role: p.role in ROLES ? p.role : '', platforms: [...new Set(platforms)], boards };
}

const firebaseAppOf = (a) => (a && /^\d+:\d+:(android|ios):[a-f0-9]+$/.test(String(a.appId || ''))
  ? { appId: a.appId, packageName: cut(a.packageName, 150), projectId: cut(a.projectId, 100), projectNumber: /^\d+$/.test(String(a.projectNumber)) ? String(a.projectNumber) : '', name: cut(a.name, 100) }
  : null);

// Kullanıcının diğer Claude bağlantıları: yalnızca onayladığı okuma araçları (lib/connectors.js sınıflandırır).
const connPrefix = (name) => `mcp__${String(name).replace(/[^A-Za-z0-9]/g, '_')}__`;
export function connectorsOf(c = {}) {
  const out = {};
  for (const [name, v] of Object.entries(c && typeof c === 'object' ? c : {}).slice(0, 20)) {
    const n = cut(name, 80);
    if (!n || !v || typeof v !== 'object') continue;
    out[n] = {
      enabled: Boolean(v.enabled),
      prefix: connPrefix(n),
      tools: (Array.isArray(v.tools) ? v.tools : []).filter((t) => /^[A-Za-z0-9_\-]{1,80}$/.test(t)).slice(0, 80),
      skipped: (Array.isArray(v.skipped) ? v.skipped : []).filter((t) => /^[A-Za-z0-9_\-]{1,80}$/.test(t)).slice(0, 120),
    };
  }
  return out;
}

// Toplantılar: Claude Desktop'taki iki zamanlanmış görev (Claude'u toplantıya ekleme ve not çıkarma) bu ayarı okur.
// overrides: takvim etkinlik kimliği → 'add' (girsin) | 'skip' (girmesin); yoksa kural karar verir.
export const MEETING_DEFAULTS = {
  include: ['Desk-Check', 'Desk Check', 'Grooming', 'Estimation', 'Refinement', 'E2E', 'Demo', 'Test', 'Review'],
  exclude: ['Daily', 'Standup', '1:1', 'Birebir', 'Retro', 'Lunch', 'Öğle'],
};
const words = (v, def) => {
  if (v == null) return [...def];
  return [...new Set((Array.isArray(v) ? v : String(v).split(',')).map((s) => cut(s, 40)).filter(Boolean))].slice(0, 30);
};
export function meetingsOf(m = {}) {
  const overrides = {};
  for (const [id, v] of Object.entries(m.overrides && typeof m.overrides === 'object' ? m.overrides : {}).slice(-200)) {
    if (/^[A-Za-z0-9_@.-]{1,200}$/.test(id) && ['add', 'skip'].includes(v)) overrides[id] = v;
  }
  return { enabled: m.enabled !== false, autoAdd: m.autoAdd === true, include: words(m.include, MEETING_DEFAULTS.include), exclude: words(m.exclude, MEETING_DEFAULTS.exclude), overrides };
}

// Kokpit: kullanıcının denediği deeplink'ler ve ayakta olması gereken adresler (yalnızca GET).
const linkList = (v, re) => (Array.isArray(v) ? v : []).map((x) => ({ name: cut(x?.name, 60), url: cut(x?.url, 500) }))
  .filter((x) => re.test(x.url)).slice(0, 30);
export const cockpitOf = (c = {}) => ({
  deeplinks: linkList(c.deeplinks, /^[a-z][a-z0-9+.-]{1,30}:\/\/\S+$/i),
  endpoints: linkList(c.endpoints, /^https?:\/\/[^\s/]+\S*$/i),
});

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
    sources: { slack: true, notion: true, confluence: false, figma: true, docs: false, proxyman: false, ...(s.sources || {}) },
    model: MODELS.includes(s.model) ? s.model : (MODELS.includes(env.CLAUDE_MODEL) ? env.CLAUDE_MODEL : 'sonnet'),
    accent: accentOf(s.accent) || accentOf(env.ACCENT_COLOR) || DEFAULT_ACCENT,
    setupDone: s.setupDone ?? Boolean(normalizeBaseUrl(env.JIRA_BASE_URL)),
    bug: bugSettingsOf(s.bug),
    run: runSettingsOf(s.run),
    // Firebase App Distribution'daki Android uygulaması (paket adından bulunur; yalnızca kimlikler, belirteç yok).
    firebase: { android: firebaseAppOf(s.firebase?.android), ios: firebaseAppOf(s.firebase?.ios) },
    // Rehber açılınca otomatik güncelleme denetimi aralığı (saat); 0 = kapalı.
    syncEvery: [0, 6, 24, 72].includes(s.syncEvery) ? s.syncEvery : 24,
    profile: profileOf(s.profile),
    meetings: meetingsOf(s.meetings),
    cockpit: cockpitOf(s.cockpit),
    connectors: connectorsOf(s.connectors),
    // Bugbot Slack bildirimi için kullanıcının kendi Slack kimliği (profil aracının sonucundan okunur).
    slackUserId: /^U[A-Z0-9]{6,}$/.test(String(s.slackUserId || '')) ? s.slackUserId : '',
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
  if ('syncEvery' in patch && [0, 6, 24, 72].includes(Number(patch.syncEvery))) next.syncEvery = Number(patch.syncEvery);
  if (patch.bug && typeof patch.bug === 'object') next.bug = bugSettingsOf(patch.bug);
  if (patch.run && typeof patch.run === 'object') next.run = runSettingsOf(patch.run);
  if (patch.firebase && typeof patch.firebase === 'object') next.firebase = { android: firebaseAppOf(patch.firebase.android), ios: firebaseAppOf(patch.firebase.ios) };
  if (patch.profile && typeof patch.profile === 'object') next.profile = profileOf(patch.profile);
  if (patch.meetings && typeof patch.meetings === 'object') next.meetings = meetingsOf({ ...cur.meetings, ...patch.meetings });
  if (patch.cockpit && typeof patch.cockpit === 'object') next.cockpit = cockpitOf(patch.cockpit);
  if (patch.connectors && typeof patch.connectors === 'object') next.connectors = connectorsOf(patch.connectors);
  if ('slackUserId' in patch) next.slackUserId = /^U[A-Z0-9]{6,}$/.test(String(patch.slackUserId || '')) ? patch.slackUserId : '';
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  cache = next;
  return publicSettings();
}
