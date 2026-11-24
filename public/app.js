// qaHere arayüzü. Bağımlılık yok; dışarıdan gelen her metin textContent ile yazılır.
const $ = (s) => document.querySelector(s);

// Masaüstü uygulamasında (desktop/main.js kullanıcı ajanına "qaHereDesktop" ekler) üst çubuk pencerenin başlığı olur.
const isDesktop = /\bqaHereDesktop\b/.test(navigator.userAgent);
if (isDesktop) {
  document.documentElement.classList.add('desktop');
  if (/Macintosh/.test(navigator.userAgent)) document.documentElement.classList.add('mac');
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

// Sabit, güvenilir simgeler (kullanıcı verisi içermez).
const ICONS = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
};
function icon(name, size = 18) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span.firstChild;
}

// Maskot: "burada!" diye elini kaldıran rehber sayfası. Gövde vurgu rengini (currentColor) alır.
const MASCOT = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <g class="arm" fill="currentColor"><path d="M9.6 20.5Q5.6 17 5.4 10.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="5.2" cy="7.4" rx="2.6" ry="3.2" transform="rotate(-12 5.2 7.4)"/><circle cx="7.7" cy="9" r="1.15"/></g>
  <path d="M25 23q3 1.2 3.4 4.6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <path d="M11 9h9l6 6v13a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3z" fill="currentColor"/>
  <circle cx="11.6" cy="23.6" r="1.4" fill="#fff" fill-opacity=".28"/><circle cx="22.8" cy="23.6" r="1.4" fill="#fff" fill-opacity=".28"/>
  <path d="M20 9v4a2 2 0 0 0 2 2h4" fill="#fff" fill-opacity=".38"/>
  <circle cx="14" cy="20" r="2.1" fill="#fff"/><circle cx="20.4" cy="20" r="2.1" fill="#fff"/>
  <circle cx="13.4" cy="19.3" r="1" fill="#16191c"/><circle cx="19.8" cy="19.3" r="1" fill="#16191c"/>
  <path d="M15.3 24.4q1.9 1.7 3.8 0" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;
function mascot(cls) {
  const span = h('span', { class: cls });
  span.innerHTML = MASCOT;
  return span;
}
function setFavicon(color) {
  let link = document.querySelector('link[rel=icon]');
  if (!link) { link = h('link', { rel: 'icon', type: 'image/svg+xml' }); document.head.append(link); }
  link.href = `data:image/svg+xml,${encodeURIComponent(MASCOT.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" style="color:${color}" `))}`;
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `İstek başarısız (${res.status})`), { data, status: res.status });
  return data;
}
const send = (url, method, body) => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

const fmtDate = (iso) => new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const state = { config: null, tab: 'epics', current: null, es: null, health: null };

const ACCENTS = ['#0071e3', '#5856d6', '#8944ab', '#d30f45', '#c93400', '#248a3d', '#6e6e73'];
const SOURCES = [
  { key: 'slack', name: 'Slack', desc: 'Kanallardaki ve thread\'lerdeki ilgili yazışmalar' },
  { key: 'notion', name: 'Notion', desc: 'İşlerde bağlantısı verilen sayfalar' },
  { key: 'confluence', name: 'Confluence', desc: 'Analiz, teknik tasarım ve kontrat sayfaları' },
  { key: 'figma', name: 'Figma', desc: 'İşlerde bağlantısı verilen tasarım ekranları: metinler, durumlar, akış' },
  { key: 'docs', name: 'Claude Docs', desc: 'İşlerde bağlantısı verilen claude.ai doküman ve artifact\'leri' },
  { key: 'proxyman', name: 'Proxyman', desc: 'Yakalanan gerçek istek ve yanıtlar (kontratla karşılaştırma). Açıp "Bağlantıları denetle"ye bas; Claude Code\'da yoksa "Claude\'a ekle" ile qaHere ekler.' },
];
const MODELS = [
  { key: 'sonnet', name: 'Sonnet', desc: 'Dengeli. Önerilen.' },
  { key: 'opus', name: 'Opus', desc: 'Daha derin, kullanım hakkından daha çok düşer.' },
  { key: 'haiku', name: 'Haiku', desc: 'En hızlı ve en hafif; çelişki analizi yüzeysel kalabilir.' },
];

function applyConfig(cfg) {
  state.config = cfg;
  document.documentElement.style.setProperty('--accent', cfg.accent);
  if (/^#[0-9a-f]{3,8}$/i.test(cfg.accent)) setFavicon(cfg.accent);
  $('#ws').textContent = cfg.workspace || '';
  document.title = cfg.workspace ? `qaHere · ${cfg.workspace}` : 'qaHere';
  const sel = $('#project');
  const prev = sel.value;
  sel.replaceChildren(...cfg.projects.map((p) => h('option', { value: p }, p)));
  if (cfg.projects.includes(prev)) sel.value = prev;
}

// ---- Durum ------------------------------------------------------------------------

async function loadHealth() {
  const dot = $('#cockpitBtn .dot');
  try {
    const hl = await api('/api/health');
    state.health = hl;
    const bad = !hl.claude.ok || (hl.jira.configured && !hl.jira.ok);
    const warn = !hl.jira.configured || !hl.pdf.ok;
    dot.className = `dot ${bad ? 'bad' : warn ? 'warn' : 'ok'}`;
    $('#statusText').textContent = !hl.claude.ok ? 'Claude Code yok' : hl.jira.configured && !hl.jira.ok ? 'Jira hatası' : '';
  } catch {
    dot.className = 'dot bad';
    $('#statusText').textContent = 'Sunucuya ulaşılamıyor';
  }
  return state.health;
}

function openSheet(title, body, actions = []) {
  const dlg = $('#sheet');
  $('#sheetBody').replaceChildren(
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('div', { class: 'bar-actions' }, ...actions)),
    h('div', { class: 'sheet-body' }, body));
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}
const closeSheet = () => $('#sheet').close();
$('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) closeSheet(); });

/** Bağlı olmayan kaynak için terminalsiz çözüm: Proxyman'i qaHere ekler; claude.ai bağlantıları claude.ai'de bağlanır. */
function connectorFix(key, x, onDone) {
  if (!x || x.ok) return null;
  if (key === 'proxyman') {
    const b = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
      b.disabled = true; b.textContent = 'Ekleniyor…';
      try { await send('/api/connectors/proxyman/add', 'POST', {}); b.textContent = 'Eklendi'; onDone?.(); }
      catch (e) { b.textContent = 'Yeniden dene'; b.disabled = false; b.title = e.message; alert(e.message); }
    } }, 'Claude\'a ekle');
    return b;
  }
  return h('a', { class: 'btn plain sm', href: 'https://claude.ai/settings/connectors', target: '_blank', rel: 'noopener', title: 'claude.ai → Ayarlar → Bağlayıcılar: uygulamayı bağla ya da yeniden giriş yap, sonra burada yeniden denetle' }, x.detail === 'Giriş gerekiyor' ? 'claude.ai\'de giriş yap' : 'claude.ai\'de bağla');
}

function statusRow(name, x, fix) {
  return h('div', { class: 'row' },
    h('span', { class: `dot ${x ? (x.ok ? 'ok' : 'bad') : ''}` }),
    h('div', { class: 'grow' }, h('b', {}, name)),
    h('div', { class: 'val' }, x?.detail || '—'), fix || null);
}

function showStatus(extra) {
  const hl = state.health || {};
  const btn = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Denetleniyor…';
    try { showStatus(await api('/api/health/connectors')); }
    catch (e) { btn.disabled = false; btn.textContent = e.message; }
  } }, 'Bağlantıları denetle');
  const on = SOURCES.filter((s) => state.config.sources[s.key]);
  const upd = state.update;
  const updBtn = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
    updBtn.disabled = true; updBtn.textContent = 'Denetleniyor…';
    try {
      state.update = await api('/api/update?force=1');
      if (state.update.behind) showUpdate(state.update); else showStatus(extra);
    } catch (e) { updBtn.disabled = false; updBtn.textContent = e.message; }
  } }, 'Yeni sürümü denetle');
  const updText = !upd ? '—' : !upd.git ? 'git ile kurulmadı; güncellemeyi elle yap' : upd.error ? upd.error
    : upd.behind ? `${upd.version} · yeni sürüm var` : `${upd.version || '—'} · güncel`;
  openSheet('Durum', h('div', {},
    h('div', { class: 'group' },
      statusRow('Claude Code', hl.claude), statusRow('Jira', hl.jira && { ...hl.jira, ok: hl.jira.ok }), statusRow('PDF', hl.pdf),
      upd?.enabled === false ? null : h('div', { class: 'row' },
        h('span', { class: `dot ${upd ? (upd.behind || upd.error ? 'bad' : 'ok') : ''}` }),
        h('div', { class: 'grow' }, h('b', {}, 'qaHere sürümü')),
        h('div', { class: 'val' }, updText), upd?.git === false ? null : updBtn)),
    h('div', { class: 'group-title' }, 'Kaynak bağlantıları'),
    h('div', { class: 'group' },
      ...(extra ? [...on.map((s) => statusRow(s.name, extra[s.key], connectorFix(s.key, extra[s.key]))), statusRow('Atlassian', extra.atlassian)]
        : [h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', {}, 'Bağlantılar Claude Code üzerinden denetlenir. Yarım dakika sürebilir.')), btn)])),
    extra ? h('div', { class: 'group-foot' }, 'Bir kaynak bağlı değilse yanındaki düğmeyle bağla: claude.ai bağlantıları claude.ai → Ayarlar → Bağlayıcılar\'da açılır, Proxyman\'i qaHere ekler. Atlassian bağlantısı yalnızca Jira token\'ı girilmediyse gerekir.') : null,
  ), [h('button', { class: 'btn sm', type: 'button', onclick: closeSheet }, 'Bitti')]);
}
$('#cockpitBtn').addEventListener('click', () => showCockpit());
$('#homeBtn').addEventListener('click', () => showWelcome());
$('#navHome').addEventListener('click', () => showWelcome());
$('#cloudBtn').addEventListener('click', () => showCloud());
$('#homeBtn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showWelcome(); } });

// ---- Ayar bölümleri (kurulum ve Ayarlar sayfası ortak kullanır) ------------------------

function draftFrom(cfg) {
  return { workspace: cfg.workspace, jiraBaseUrl: cfg.jiraBaseUrl, jiraEmail: cfg.jiraEmail, jiraApiToken: '', hasToken: cfg.hasToken,
    projects: [...cfg.projects], sources: { ...cfg.sources }, model: cfg.model, accent: cfg.accent,
    bug: JSON.parse(JSON.stringify(cfg.bug || {})), run: JSON.parse(JSON.stringify(cfg.run || { ios: {}, android: {} })),
    profile: JSON.parse(JSON.stringify(cfg.profile || { role: '', platforms: [], boards: [] })),
    connectors: JSON.parse(JSON.stringify(cfg.connectors || {})), syncEvery: cfg.syncEvery ?? 24,
    testmu: { username: cfg.testmu?.username || '', accessKey: '', hasKey: Boolean(cfg.testmu?.hasKey) },
    meetings: { enabled: cfg.meetings?.enabled !== false, autoAdd: cfg.meetings?.autoAdd === true, include: [...(cfg.meetings?.include || [])], exclude: [...(cfg.meetings?.exclude || [])] } };
}

async function saveDraft(d, extra = {}) {
  const body = { workspace: d.workspace, jiraBaseUrl: d.jiraBaseUrl, jiraEmail: d.jiraEmail, projects: d.projects, sources: d.sources, model: d.model, accent: d.accent, bug: d.bug, run: d.run, profile: d.profile, connectors: d.connectors, syncEvery: d.syncEvery, meetings: d.meetings,
    testmu: { username: d.testmu.username, ...(d.testmu.accessKey ? { accessKey: d.testmu.accessKey } : {}) }, ...extra };
  if (d.jiraApiToken) body.jiraApiToken = d.jiraApiToken;
  applyConfig(await send('/api/settings', 'PUT', body));
}

function inputRow(label, attrs, d, key) {
  const input = h('input', { class: 'bare', autocomplete: 'off', spellcheck: 'false', ...attrs, value: d[key] || '', oninput: () => { d[key] = input.value.trim(); } });
  return h('label', { class: 'row' }, h('span', { class: 'lab' }, label), h('div', { class: 'grow' }, input));
}

function jiraSection(d) {
  const result = h('div', { class: 'result' });
  const chips = h('div', { class: 'chips' });
  const projInput = h('input', { class: 'bare', placeholder: 'Örn. APP, WEB', autocomplete: 'off', spellcheck: 'false', value: d.projects.join(', '),
    oninput: () => { d.projects = projInput.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean); paint(); } });
  let known = [];
  const paint = () => chips.replaceChildren(...known.map((p) => h('button', { type: 'button', class: `chip${d.projects.includes(p.key) ? ' on' : ''}`, title: p.name,
    onclick: () => { d.projects = d.projects.includes(p.key) ? d.projects.filter((k) => k !== p.key) : [...d.projects, p.key]; projInput.value = d.projects.join(', '); paint(); } }, p.key, h('small', {}, p.name.slice(0, 22)))));
  const chipRow = h('div', { class: 'row stack', hidden: true }, h('div', { class: 'hint' }, 'Listede görmek istediğin projeleri seç.'), chips);
  const test = h('button', { class: 'btn plain sm', type: 'button', onclick: run }, 'Bağlantıyı sına');
  async function run() {
    result.className = 'result wait'; result.textContent = 'Bağlanılıyor…'; test.disabled = true;
    try {
      const r = await send('/api/jira/test', 'POST', { baseUrl: d.jiraBaseUrl, email: d.jiraEmail, token: d.jiraApiToken });
      d.jiraBaseUrl = r.baseUrl; d.jiraOk = true; d.jiraUser = r.user; known = r.projects;
      result.className = 'result ok'; result.replaceChildren(icon('check', 15), `Bağlandı${r.user ? ` · ${r.user}` : ''}`);
      chipRow.hidden = !known.length; paint();
    } catch (e) { d.jiraOk = false; result.className = 'result bad'; result.textContent = e.message; }
    test.disabled = false;
  }
  if (d.hasToken && d.jiraBaseUrl) queueMicrotask(run);
  return h('div', {},
    h('div', { class: 'group' },
      inputRow('Jira adresi', { placeholder: 'sirketin.atlassian.net', inputmode: 'url' }, d, 'jiraBaseUrl'),
      inputRow('E-posta', { placeholder: 'ad@sirketin.com', type: 'email' }, d, 'jiraEmail'),
      inputRow('API token', { placeholder: d.hasToken ? 'Kayıtlı. Değiştirmek için yenisini yapıştır' : 'Token\'ı yapıştır', type: 'password' }, d, 'jiraApiToken'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, result), test)),
    h('div', { class: 'group-foot' }, 'Token\'ı ',
      h('a', { href: 'https://id.atlassian.com/manage-profile/security/api-tokens', target: '_blank', rel: 'noopener' }, 'Atlassian hesap sayfasından'),
      ' oluşturursun. Yalnızca bu bilgisayarda saklanır ve yalnızca girdiğin Jira adresine gönderilir.'),
    h('div', { class: 'group-title' }, 'Projeler'),
    h('div', { class: 'group' },
      h('label', { class: 'row' }, h('span', { class: 'lab' }, 'Anahtarlar'), h('div', { class: 'grow' }, projInput)),
      chipRow),
  );
}

function sourcesSection(d) {
  const marks = {};
  const fixes = {};
  const btn = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Denetleniyor…';
    try {
      const r = await api('/api/health/connectors');
      for (const s of SOURCES) { marks[s.key].textContent = r[s.key]?.detail || ''; marks[s.key].style.color = r[s.key]?.ok ? 'var(--ok)' : 'var(--warn)'; fixes[s.key].replaceChildren(d.sources[s.key] ? connectorFix(s.key, r[s.key], () => btn.click()) || '' : ''); }
      btn.textContent = 'Yeniden denetle';
    } catch (e) { btn.textContent = 'Denetlenemedi'; }
    btn.disabled = false;
  } }, 'Bağlantıları denetle');
  return h('div', {},
    h('div', { class: 'group' }, ...SOURCES.map((s) => {
      marks[s.key] = h('span', {}, '');
      fixes[s.key] = h('span', { class: 'fix' });
      const sw = h('input', { type: 'checkbox', class: 'switch', 'aria-label': s.name, onchange: () => { d.sources[s.key] = sw.checked; } });
      sw.checked = Boolean(d.sources[s.key]);
      return h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, s.name), h('span', {}, s.desc), marks[s.key]), fixes[s.key], sw);
    })),
    h('div', { class: 'group-foot' }, 'Bu kaynaklara Claude hesabındaki bağlantılarla ulaşılır. Açmak için claude.ai → Ayarlar → Bağlayıcılar bölümünden ilgili uygulamayı bağla. Araç yalnızca senin görebildiğin içeriği okur; hiçbir yere yazmaz.'),
    h('div', { class: 'group' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', {}, 'Seçtiklerinin Claude Code\'da bağlı olup olmadığını gör. Yarım dakika sürebilir.')), btn)),
    otherConnectors(d),
    syncEverySection(d),
  );
}

const SYNC_EVERY = [[0, 'Kapalı'], [6, '6 saat'], [24, '1 gün'], [72, '3 gün']];
function syncEverySection(d) {
  const seg = h('div', { class: 'seg mini' });
  const paint = () => seg.replaceChildren(...SYNC_EVERY.map(([v, n]) => h('button', { type: 'button', class: d.syncEvery === v ? 'active' : '', onclick: () => { d.syncEvery = v; paint(); } }, n)));
  paint();
  return h('div', {}, h('div', { class: 'group-title' }, 'Rehberleri güncel tut'),
    h('div', { class: 'group' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, 'Rehber açılınca yeni yazılanlara bak'),
      h('span', {}, 'Son denetimden bu kadar süre geçtiyse Jira ve Slack arka planda taranır; bulunanlar "Güncelleme var" olarak bekler, sen onaylamadan rehbere eklenmez. Her denetim kullanım hakkından düşer.')), seg)));
}

/**
 * Claude hesabındaki diğer bağlantılar (Google Sheets, Linear, Miro…): kullanıcı açtığında qaHere bağlantının araçlarını
 * listeler, yalnızca okuma araçlarını açar ve hangilerinin açılıp hangilerinin kapalı kaldığını gösterir.
 */
function otherConnectors(d) {
  d.connectors ||= {};
  const box = h('div', { class: 'group' });
  const short = (n) => n.replace(/^claude\.ai\s+/i, '');
  const paintSaved = () => {
    const names = Object.keys(d.connectors);
    if (!names.length) return box.replaceChildren(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', {}, 'Claude hesabındaki diğer bağlantıları (Google Sheets, Drive, Linear, Miro…) da rehbere ve sohbetlere açabilirsin. Yalnızca okuma araçları açılır.')), load));
    box.replaceChildren(...names.map((n) => row({ name: n, connected: true, saved: d.connectors[n] })), h('div', { class: 'row' }, h('div', { class: 'grow' }), load));
  };
  const row = (c) => {
    const saved = d.connectors[c.name] || c.saved;
    const note = h('span', {}, saved ? summary(saved) : c.needsAuth ? 'claude.ai → Ayarlar → Bağlayıcılar\'dan giriş yap' : c.connected ? '' : 'Bağlı değil');
    const sw = h('input', { type: 'checkbox', class: 'switch', 'aria-label': short(c.name), disabled: !c.connected && !saved });
    sw.checked = Boolean(saved?.enabled);
    sw.onchange = async () => {
      if (!sw.checked) { if (d.connectors[c.name]) d.connectors[c.name].enabled = false; note.textContent = d.connectors[c.name] ? summary(d.connectors[c.name]) : ''; return; }
      if (d.connectors[c.name]?.tools?.length) { d.connectors[c.name].enabled = true; note.textContent = summary(d.connectors[c.name]); return; }
      sw.disabled = true; note.textContent = 'Araçları listeleniyor… (yarım dakika sürebilir)';
      try {
        const r = await send('/api/connectors/inspect', 'POST', { name: c.name });
        d.connectors[c.name] = { enabled: r.read.length > 0, tools: r.read, skipped: r.skipped };
        if (r.read.length) return el.replaceWith(row({ ...c, saved: d.connectors[c.name] })); // araç listesiyle yeniden çiz
        sw.checked = false;
        note.textContent = 'Okuma aracı bulunamadı; açılmadı.';
      } catch (e) { sw.checked = false; note.textContent = e.message; }
      sw.disabled = false;
    };
    const details = saved?.tools?.length ? h('details', { class: 'conn-tools' }, h('summary', {}, 'Araçlar'),
      h('p', {}, h('b', {}, 'Açık (okuma): '), saved.tools.join(', ')),
      saved.skipped?.length ? h('p', {}, h('b', {}, 'Kapalı (yazma): '), saved.skipped.join(', ')) : null) : null;
    const el = h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, short(c.name)), note, details), sw);
    return el;
  };
  const summary = (s) => `${s.tools.length} okuma aracı ${s.enabled ? 'açık' : 'kapalı'}; ${s.skipped?.length || 0} yazma aracı her zaman kapalı`;
  const load = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
    load.disabled = true; load.textContent = 'Bağlantıların getiriliyor…';
    try {
      const { connectors } = await api('/api/connectors');
      const rows = connectors.sort((a, b) => (b.connected - a.connected) || a.name.localeCompare(b.name)).map(row);
      box.replaceChildren(...(rows.length ? rows : [h('div', { class: 'row' }, h('span', {}, 'Claude hesabında başka bağlantı yok.'))]));
    } catch (e) { load.disabled = false; load.textContent = e.message; }
  } }, 'Bağlantılarımı getir');
  paintSaved();
  return h('div', {}, h('div', { class: 'group-title' }, 'Diğer Claude bağlantıların'), box,
    h('div', { class: 'group-foot' }, 'Açtığın bağlantıya rehber üretirken ve Rehbere sor / Bugbot\'ta konuyla ilgiliyse bakılır. Adı ve açıklaması okuma işi anlatan araçlar açılır; yazan, gönderen ya da silen araçlar her zaman kapalıdır.'));
}

function lookSection(d) {
  const sw = h('div', { class: 'swatches' });
  const paint = () => {
    const custom = h('span', { class: `swatch custom${ACCENTS.includes(d.accent) ? '' : ' on'}`, title: 'Özel renk' },
      h('input', { type: 'color', value: d.accent, 'aria-label': 'Özel renk', oninput: (e) => { d.accent = e.target.value; document.documentElement.style.setProperty('--accent', d.accent); }, onchange: paint }));
    sw.replaceChildren(...ACCENTS.map((c) => h('button', { type: 'button', class: `swatch${d.accent === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': `Renk ${c}`,
      onclick: () => { d.accent = c; document.documentElement.style.setProperty('--accent', c); paint(); } })), custom);
  };
  paint();
  const models = h('div', { class: 'seg' });
  const mdesc = h('span', {});
  const paintM = () => {
    models.replaceChildren(...MODELS.map((m) => h('button', { type: 'button', class: d.model === m.key ? 'active' : '', onclick: () => { d.model = m.key; paintM(); } }, m.name)));
    mdesc.textContent = MODELS.find((m) => m.key === d.model)?.desc || '';
  };
  paintM();
  return h('div', {},
    h('div', { class: 'group' },
      inputRow('Çalışma alanı', { placeholder: 'Şirket ya da ekip adı (isteğe bağlı)', maxlength: '60' }, d, 'workspace'),
      h('div', { class: 'row' }, h('span', { class: 'lab' }, 'Vurgu rengi'), h('div', { class: 'grow' }, sw))),
    h('div', { class: 'group-foot' }, 'Ad ve renk, arayüzde ve üretilen rehberlerin kapağında görünür.'),
    h('div', { class: 'group-title' }, 'Model'),
    h('div', { class: 'group' }, h('div', { class: 'row stack' }, models, h('div', { class: 'grow' }, mdesc))),
  );
}

const ROLES = [{ key: 'qa', name: 'QA' }, { key: 'dev', name: 'Geliştirici' }, { key: 'product', name: 'Ürün / analist' }, { key: 'other', name: 'Diğer' }];
const PLATFORM_NAMES = { ios: 'iOS', android: 'Android' };

function profileSection(d) {
  const p = d.profile;
  const who = h('span', {}, d.jiraUser || '');
  if (!d.jiraUser) {
    if (state.config.jiraConfigured) api('/api/me').then((m) => { who.textContent = m.name; }).catch(() => { who.textContent = 'Okunamadı'; });
    else who.textContent = 'Jira bağlanınca görünür';
  }
  const roles = h('div', { class: 'seg' });
  const paintR = () => roles.replaceChildren(...ROLES.map((r) => h('button', { type: 'button', class: p.role === r.key ? 'active' : '', onclick: () => { p.role = p.role === r.key ? '' : r.key; paintR(); } }, r.name)));
  paintR();
  const plats = h('div', { class: 'chips' });
  const paintP = () => plats.replaceChildren(...Object.entries(PLATFORM_NAMES).map(([k, n]) => h('button', { type: 'button', class: `chip${p.platforms.includes(k) ? ' on' : ''}`,
    onclick: () => { p.platforms = p.platforms.includes(k) ? p.platforms.filter((x) => x !== k) : [...p.platforms, k]; paintP(); } }, n)));
  paintP();

  // Takım: projelerdeki Jira panoları; çoklu seçim, adla süzülür.
  let boards = [];
  const chosen = h('div', { class: 'chips' });
  const found = h('div', { class: 'chips' });
  const bnote = h('div', { class: 'hint' }, 'Panolar yükleniyor…');
  let remote = null; // adla tüm Jira'da arama sonucu
  let timer;
  const filter = h('input', { class: 'bare', placeholder: 'Pano adıyla ara', autocomplete: 'off', spellcheck: 'false', oninput: () => {
    remote = null; paintB();
    clearTimeout(timer);
    const q = filter.value.trim();
    if (q.length < 2 || !state.config.jiraConfigured) return;
    timer = setTimeout(async () => {
      try { const r = (await api(`/api/jira/boards?q=${encodeURIComponent(q)}`)).boards; if (filter.value.trim() === q) { remote = r; paintB(); } } catch { /* yerel liste kalır */ }
    }, 350);
  } });
  const has = (id) => p.boards.some((b) => b.id === id);
  const paintB = () => {
    chosen.replaceChildren(...p.boards.map((b) => h('button', { type: 'button', class: 'chip on', title: 'Çıkar', onclick: () => { p.boards = p.boards.filter((x) => x.id !== b.id); paintB(); } }, b.name)));
    const q = filter.value.trim().toLocaleLowerCase('tr');
    const pool = remote ? [...boards, ...remote.filter((r) => !boards.some((b) => b.id === r.id))] : boards;
    const list = pool.filter((b) => !has(b.id) && (!q || b.name.toLocaleLowerCase('tr').includes(q)));
    found.replaceChildren(...list.slice(0, 24).map((b) => h('button', { type: 'button', class: 'chip', title: b.project || '',
      onclick: () => { if (p.boards.length < 10) p.boards = [...p.boards, { id: b.id, name: b.name }]; paintB(); } }, b.name, b.project ? h('small', {}, b.project) : null)));
    if (boards.length || remote) {
      bnote.textContent = list.length > 24 ? `${list.length} pano; adla arayarak daralt.`
        : list.length ? 'Takımının panosunu seç; birden fazla seçebilirsin.'
        : q ? (remote || q.length < 2 ? 'Bu adla pano bulunamadı.' : 'Aranıyor…')
        : 'Seçili projelerdeki panoların hepsi seçili. Başka bir panoyu adıyla arayabilirsin.';
    }
  };
  const loadBoards = async () => {
    if (!state.config.jiraConfigured) { bnote.textContent = 'Panoları görmek için önce Jira\'yı bağla.'; return; }
    try {
      boards = (await api(`/api/jira/boards?projects=${encodeURIComponent(d.projects.join(','))}`)).boards;
      if (!boards.length) bnote.textContent = 'Seçili projelerde pano bulunamadı.';
    } catch (e) { bnote.textContent = e.message; }
    paintB();
  };
  paintB();
  loadBoards();

  return h('div', {},
    h('div', { class: 'group' },
      h('div', { class: 'row' }, h('span', { class: 'lab' }, 'Jira\'da'), h('div', { class: 'grow' }, who)),
      h('div', { class: 'row stack' }, h('div', { class: 'grow' }, h('b', {}, 'Rolün')), roles),
      h('div', { class: 'row stack' }, h('div', { class: 'grow' }, h('b', {}, 'Test ettiğin platformlar'), h('span', {}, 'Rehber bu platformlara göre yazılır; kontrol listesinde varsayılan olarak bunlar açılır.')), plats)),
    h('div', { class: 'group-title' }, 'Takımın'),
    h('div', { class: 'group' },
      h('div', { class: 'row stack' }, chosen, h('label', { class: 'grow' }, filter), bnote, found)),
    h('div', { class: 'group-foot' }, 'Listede "Takımım" seçince bu panolardaki epic\'ler ve hatalar gelir. Rolün, platformların ve takımın rehber yazılırken Claude\'a da söylenir.'),
  );
}

const BUG_PL = [{ key: 'ios', name: 'iOS' }, { key: 'android', name: 'Android' }, { key: 'both', name: 'İki platform' }];

function bugSection(d) {
  const b = d.bug;
  const project = () => b.project || d.projects[0] || '';
  const typeSel = h('select', { class: 'bare-sel', onchange: () => { b.issueType = typeSel.value; } }, h('option', { value: b.issueType }, b.issueType));
  const linkSel = h('select', { class: 'bare-sel', onchange: () => { b.linkType = linkSel.value; } }, h('option', { value: b.linkType }, b.linkType));
  const fillSelect = (sel, items, cur) => sel.replaceChildren(...[...new Set([cur, ...items])].filter(Boolean).map((v) => { const o = h('option', { value: v }, v); if (v === cur) o.selected = true; return o; }));
  const loadMeta = async () => {
    if (!state.config.jiraConfigured) return;
    if (project()) api(`/api/jira/issuetypes?project=${encodeURIComponent(project())}`).then((r) => fillSelect(typeSel, r.types.map((t) => t.name), b.issueType)).catch(() => {});
    api('/api/jira/linktypes').then((r) => fillSelect(linkSel, r.types.map((t) => t.name), b.linkType)).catch(() => {});
  };
  queueMicrotask(loadMeta);
  const projInput = h('input', { class: 'bare', placeholder: 'Boşsa rehberin işiyle aynı proje', value: b.project || '', autocomplete: 'off', spellcheck: 'false',
    oninput: () => { b.project = projInput.value.trim().toUpperCase(); }, onchange: loadMeta });
  const fmt = h('input', { class: 'bare', value: b.titleFormat, spellcheck: 'false', oninput: () => { b.titleFormat = fmt.value; } });

  const assigneeRow = (pl) => {
    const shown = h('span', {}, b.assignees?.[pl.key]?.name || 'Atanmasın');
    const q = h('input', { class: 'bare', placeholder: 'Ad yaz…', autocomplete: 'off', spellcheck: 'false' });
    const list = h('div', { class: 'chips' });
    let t;
    q.addEventListener('input', () => {
      clearTimeout(t);
      const text = q.value.trim();
      if (text.length < 2) return list.replaceChildren();
      t = setTimeout(async () => {
        try {
          const r = await api(`/api/jira/users?q=${encodeURIComponent(text)}&project=${encodeURIComponent(project())}`);
          list.replaceChildren(...r.users.slice(0, 8).map((u) => h('button', { type: 'button', class: 'chip', onclick: () => {
            b.assignees[pl.key] = { id: u.id, name: u.name }; shown.textContent = u.name; q.value = ''; list.replaceChildren();
          } }, u.name)));
        } catch (e) { list.replaceChildren(h('span', { class: 'hint' }, e.message)); }
      }, 300);
    });
    const clear = h('button', { class: 'btn link sm', type: 'button', onclick: () => { b.assignees[pl.key] = null; shown.textContent = 'Atanmasın'; } }, 'Kaldır');
    return h('div', { class: 'row stack' },
      h('div', { class: 'between' }, h('div', { class: 'grow' }, h('b', {}, `${pl.name} hataları`), shown), clear),
      q, list);
  };

  const names = h('div', { class: 'trio' }, ...BUG_PL.map((pl) => {
    const i = h('input', { class: 'input', value: b.names?.[pl.key] || '', 'aria-label': `${pl.name} başlık adı`, oninput: () => { b.names[pl.key] = i.value; } });
    return h('label', { class: 'f' }, pl.name, i);
  }));

  const fieldsBox = h('div', {}, ...BUG_PL.map((pl) => {
    const ta = h('textarea', { class: 'input mono', spellcheck: 'false', rows: '3', placeholder: '{ "components": [{ "name": "…" }] }' });
    ta.value = Object.keys(b.fields?.[pl.key] || {}).length ? JSON.stringify(b.fields[pl.key], null, 1) : '';
    const err = h('span', { class: 'hint bad-text' });
    ta.addEventListener('input', () => {
      const v = ta.value.trim();
      if (!v) { b.fields[pl.key] = {}; err.textContent = ''; return; }
      try { const o = JSON.parse(v); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(); b.fields[pl.key] = o; err.textContent = ''; }
      catch { err.textContent = 'Geçerli bir JSON nesnesi değil; kaydedilmez.'; }
    });
    return h('label', { class: 'f' }, `${pl.name} için ek alanlar`, ta, err);
  }));

  const board = h('input', { class: 'bare', inputmode: 'numeric', placeholder: 'Pano numarası (isteğe bağlı)', value: b.sprintBoard || '', oninput: () => { b.sprintBoard = board.value.replace(/\D/g, ''); } });
  const sprintFor = h('div', { class: 'chips' }, ...BUG_PL.map((pl) => {
    const c = h('button', { type: 'button', class: `chip${b.sprintFor?.includes(pl.key) ? ' on' : ''}`, onclick: () => {
      b.sprintFor = b.sprintFor.includes(pl.key) ? b.sprintFor.filter((k) => k !== pl.key) : [...b.sprintFor, pl.key];
      c.classList.toggle('on', b.sprintFor.includes(pl.key));
    } }, pl.name);
    return c;
  }));

  return h('div', {},
    state.config.jiraConfigured ? null : h('div', { class: 'msg warn', style: 'margin:0 0 14px' }, 'Hata kaydı açmak için önce Jira token\'ını gir. Token olmadan taslak hazırlanır, metni kopyalayabilirsin.'),
    h('div', { class: 'group' },
      h('label', { class: 'row' }, h('span', { class: 'lab' }, 'Proje'), h('div', { class: 'grow' }, projInput)),
      h('label', { class: 'row' }, h('span', { class: 'lab' }, 'Kayıt türü'), h('div', { class: 'grow' }, typeSel)),
      h('label', { class: 'row' }, h('span', { class: 'lab' }, 'Başlık biçimi'), h('div', { class: 'grow' }, fmt)),
      h('div', { class: 'row stack' }, h('span', { class: 'hint' }, '{platform} yerine aşağıdaki ad, {konu} yerine hatanın kısa adı gelir. Örn. "{platform} - {konu} Bug".'), names),
      h('label', { class: 'row' }, h('span', { class: 'lab' }, 'Story ile bağ'), h('div', { class: 'grow' }, linkSel))),
    h('div', { class: 'group-title' }, 'Atananlar'),
    h('div', { class: 'group' }, ...BUG_PL.map(assigneeRow)),
    h('div', { class: 'group-title' }, 'Sprint'),
    h('div', { class: 'group' },
      h('label', { class: 'row' }, h('span', { class: 'lab' }, 'Pano'), h('div', { class: 'grow' }, board)),
      h('div', { class: 'row stack' }, h('span', { class: 'hint' }, 'Hangi kayıtlar panonun aktif sprintine alınsın?'), sprintFor)),
    h('details', { class: 'adv' }, h('summary', {}, 'Gelişmiş: platforma göre ek alanlar'),
      h('p', { class: 'hint' }, 'Jira kaydına eklenecek alanlar, Jira REST biçiminde (bileşen, özel alan gibi). Boş bırakılabilir.'),
      fieldsBox),
  );
}

function runSection(d) {
  const r = d.run;
  const devs = h('span', {}, 'Cihazlara bakılıyor…');
  api('/api/devices').then((x) => { devs.textContent = `iOS: ${x.ios?.name || 'açık simülatör yok'} · Android: ${x.android?.name || 'bağlı cihaz yok'}`; }).catch(() => { devs.textContent = 'Cihazlara bakılamadı.'; });
  const field = (pl, key, label, ph) => {
    const i = h('input', { class: 'bare', placeholder: ph, value: r[pl]?.[key] || '', spellcheck: 'false', autocomplete: 'off', oninput: () => { r[pl] = { ...r[pl], [key]: i.value.trim() }; } });
    return h('label', { class: 'row' }, h('span', { class: 'lab' }, label), h('div', { class: 'grow' }, i));
  };
  return h('div', {},
    h('div', { class: 'group' },
      field('ios', 'appId', 'iOS bundle id', 'com.sirketin.uygulama'),
      field('ios', 'setupFlow', 'iOS ön akış', '/yol/giris-ios.yaml (isteğe bağlı)'),
      field('android', 'appId', 'Android paket', 'com.sirketin.uygulama'),
      field('android', 'setupFlow', 'Android ön akış', '/yol/giris-android.yaml (isteğe bağlı)'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, 'Cihazlar'), devs))),
    h('div', { class: 'group-foot' }, 'Maddenin platform menüsündeki "simülatöründe koş" Maestro ile çalışır. Ön akış (ör. giriş yapma) varsa her akıştan önce çalışır; uygulamayı da o açar. Akışı ilk seferde Claude araçsız yazar, sonraki koşular Claude kullanmaz.'),
  );
}

// Toplantılar: Claude Desktop'taki iki görev (Claude'u toplantıya ekleme, not çıkarma) bu ayarı okur.
const MEET_DECISION = { eklendi: 'Claude ekli', eklenecek: 'Eklenecek', atlandi: 'Atlandı', kaldirildi: 'Claude çıkarıldı', hata: 'Eklenemedi' };
function meetingsSection(d) {
  const m = d.meetings;
  const sw = h('input', { type: 'checkbox', class: 'switch', 'aria-label': 'Toplantılara Claude katılsın', onchange: () => { m.enabled = sw.checked; } });
  sw.checked = m.enabled;
  const auto = h('input', { type: 'checkbox', class: 'switch', 'aria-label': 'qaHere benim adıma eklesin', onchange: () => { m.autoAdd = auto.checked; } });
  auto.checked = m.autoAdd;
  const words = (key, label, ph) => {
    const i = h('input', { class: 'bare', placeholder: ph, value: m[key].join(', '), spellcheck: 'false', autocomplete: 'off',
      oninput: () => { m[key] = i.value.split(',').map((s) => s.trim()).filter(Boolean); } });
    return h('label', { class: 'row' }, h('span', { class: 'lab' }, label), h('div', { class: 'grow' }, i));
  };
  const list = h('div', { class: 'group' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', {}, 'Yaklaşan toplantılara bakılıyor…'))));
  const runInfo = h('div', { class: 'group-foot' });
  api('/api/meetings').then((r) => {
    const ov = r.settings.overrides || {};
    runInfo.textContent = `Ekleme görevi ${r.joinRunAt ? `en son ${fmtDate(r.joinRunAt)}` : 'henüz çalışmadı'} · not görevi ${r.notesRunAt ? `en son ${fmtDate(r.notesRunAt)}` : 'henüz çalışmadı'}. Seçimlerin görevin bir sonraki çalışmasında (hafta içi saatte bir) uygulanır.`;
    if (!r.upcoming.length) {
      list.replaceChildren(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, 'Henüz liste yok'),
        h('span', {}, 'Ekleme görevi ilk çalıştığında yaklaşan toplantıların ve kararı burada görünür; tek tek "girsin / girmesin" diyebilirsin.'))));
      return;
    }
    list.replaceChildren(...r.upcoming.map((x) => {
      const seg = h('div', { class: 'seg mini' });
      const paint = () => seg.replaceChildren(...[['auto', 'Kural'], ['add', 'Girsin'], ['skip', 'Girmesin']].map(([v, n]) => h('button', {
        type: 'button', class: (ov[x.id] || 'auto') === v ? 'active' : '',
        onclick: async () => { const prev = ov[x.id]; if (v === 'auto') delete ov[x.id]; else ov[x.id] = v; paint();
          try { await send(`/api/meetings/${encodeURIComponent(x.id)}`, 'PUT', { choice: v }); } catch { if (prev) ov[x.id] = prev; else delete ov[x.id]; paint(); } },
      }, n)));
      paint();
      const when = x.start ? new Date(x.start).toLocaleString('tr-TR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const info = h('span', {}, [when, MEET_DECISION[x.decision] || x.decision, x.reason].filter(Boolean).join(' · '));
      const added = x.decision === 'eklendi';
      const future = !x.start || Date.parse(x.start) > Date.now() - 30 * 60_000;
      const act = future && (x.decision === 'eklenecek' || x.decision === 'hata' || added || ov[x.id] === 'add') ? h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
        act.disabled = true; act.textContent = added ? 'Çıkarılıyor…' : 'Ekleniyor…';
        info.textContent = 'qaHere Chrome\'da claude.ai/meetings\'i açıp düğmeye basıyor; bir iki dakika sürebilir.';
        try {
          const r = await send(`/api/meetings/${encodeURIComponent(x.id)}/join`, 'POST', { action: added ? 'remove' : 'add' });
          info.textContent = r.ok ? (r.status === 'eklendi' ? 'Claude eklendi.' : r.status === 'kaldirildi' ? 'Claude çıkarıldı.' : r.detail || r.status) : `Olmadı: ${r.detail}`;
          act.remove();
        } catch (e) { info.textContent = e.message; act.disabled = false; act.textContent = 'Yeniden dene'; }
      } }, added ? 'Çıkar' : 'Şimdi ekle') : null;
      return h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, x.title), info), act, seg);
    }));
  }).catch((e) => list.replaceChildren(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', {}, e.message)))));
  return h('div', {},
    h('div', { class: 'group' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, 'Toplantılara Claude katılsın ve not alsın'),
        h('span', {}, 'Claude Desktop\'taki görev takvimine bakar, kurala uyan Google Meet toplantılarında Claude Meetings\'te Claude\'u ekler; toplantı bitince kararlar rehbere gelir. Kapatırsan iki görev de hiçbir şey yapmaz.')), sw),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, 'qaHere Claude\'u benim adıma eklesin'),
        h('span', {}, 'Açarsan qaHere, kurala uyan ya da "Girsin" dediğin toplantılarda Chrome\'unda claude.ai/meetings\'i açıp yalnızca "+ Add" düğmesine basar ("Girmesin" dediğin eklenmiş toplantıdan çıkarır). Toplantıya katılmaz, yanıt vermez, kimseye mesaj atmaz. Kapalıyken listeden tek tek "Şimdi ekle" dersin.')), auto),
      words('include', 'Başlıkta geçerse', 'Desk-Check, Grooming, Refinement'),
      words('exclude', 'Hariç', 'Daily, Standup, Birebir')),
    h('div', { class: 'group-foot' }, 'Jira iş anahtarı ya da bir rehberin konusu geçen toplantılar da eklenir. Dış katılımcısı olan toplantılara Claude eklenmez.'),
    h('div', { class: 'group-title' }, 'Yaklaşan toplantılar'), list, runInfo);
}

function testmuSection(d) {
  const t = d.testmu;
  const result = h('div', { class: 'result' });
  const test = h('button', { class: 'btn plain sm', type: 'button', onclick: run }, 'Bağlantıyı sına');
  async function run() {
    result.className = 'result wait'; result.textContent = 'Bağlanılıyor…'; test.disabled = true;
    try {
      const r = await send('/api/testmu/test', 'POST', { username: t.username, accessKey: t.accessKey });
      const c = r.concurrency || {};
      const conc = c.max_concurrency ? ` · aynı anda ${c.max_concurrency} koşu${c.running ? `, şu an ${c.running} koşuyor` : ''}` : '';
      result.className = 'result ok'; result.replaceChildren(icon('check', 15), `Bağlandı: ${r.username}${conc}`);
    } catch (e) { result.className = 'result bad'; result.textContent = e.message; }
    test.disabled = false;
  }
  if (t.hasKey && t.username) queueMicrotask(run);
  const user = h('input', { class: 'bare', placeholder: 'TestMu kullanıcı adın', value: t.username, autocomplete: 'off', spellcheck: 'false', oninput: () => { t.username = user.value.trim(); } });
  const key = h('input', { class: 'bare', type: 'password', placeholder: t.hasKey ? 'Kayıtlı. Değiştirmek için yenisini yapıştır' : 'Access Key\'i yapıştır', autocomplete: 'off', spellcheck: 'false', oninput: () => { t.accessKey = key.value.trim(); } });
  return h('div', {},
    h('div', { class: 'group' },
      h('label', { class: 'row' }, h('span', { class: 'lab' }, 'Kullanıcı adı'), h('div', { class: 'grow' }, user)),
      h('label', { class: 'row' }, h('span', { class: 'lab' }, 'Erişim anahtarı'), h('div', { class: 'grow' }, key)),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, result), test)),
    h('div', { class: 'group-foot' }, 'İkisini de ',
      h('a', { href: 'https://accounts.lambdatest.com/security', target: '_blank', rel: 'noopener' }, 'TestMu hesap sayfasında'),
      ' (Account Settings → Password & Security) bulursun. Yalnızca bu bilgisayarda saklanır ve yalnızca TestMu\'ya gönderilir. qaHere Firebase\'deki sürümü gerçek cihaza yükler, maddeleri orada koşar; iOS da gerçek iPhone\'da test edilebilir.'));
}

function openSettings() {
  const d = draftFrom(state.config);
  const before = state.config.accent;
  const err = h('div', {});
  const save = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    save.disabled = true;
    try { await saveDraft(d, { setupDone: true }); closeSheet(); loadHealth(); loadList(); if (!state.current) showWelcome(); }
    catch (e) { err.replaceChildren(h('div', { class: 'msg bad' }, e.message)); save.disabled = false; }
  } }, 'Kaydet');
  const cancel = h('button', { class: 'btn link sm', type: 'button', onclick: () => { document.documentElement.style.setProperty('--accent', before); closeSheet(); } }, 'Vazgeç');
  openSheet('Ayarlar', h('div', {},
    h('div', { class: 'group-title' }, 'Jira'), jiraSection(d),
    h('div', { class: 'group-title' }, 'Sen kimsin'), profileSection(d),
    h('div', { class: 'group-title' }, 'Kaynaklar'), sourcesSection(d),
    h('div', { class: 'group-title' }, 'Toplantılar'), meetingsSection(d),
    h('div', { class: 'group-title' }, 'Hata kaydı'), bugSection(d),
    h('div', { class: 'group-title' }, 'Simülatörde koşu'), runSection(d),
    h('div', { class: 'group-title' }, 'TestMu (LambdaTest) gerçek cihazlar'), testmuSection(d),
    h('div', { class: 'group-title' }, 'Görünüm'), lookSection(d),
    h('div', { class: 'group' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, 'Kurulum adımları'), h('span', {}, 'İlk açılıştaki adımları yeniden göster.')),
      h('button', { class: 'btn plain sm', type: 'button', onclick: () => { closeSheet(); startOnboarding(); } }, 'Aç'))),
    err,
  ), [cancel, save]);
}
$('#settingsBtn').addEventListener('click', openSettings);

// ---- İlk açılış ---------------------------------------------------------------------

function cmd(text) {
  const b = h('button', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text); b.textContent = 'Kopyalandı'; setTimeout(() => { b.textContent = 'Kopyala'; }, 1500); } catch { /* pano kapalı */ } } }, 'Kopyala');
  return h('pre', { class: 'cmd' }, h('code', {}, text), b);
}

function startOnboarding() {
  const box = $('#onboard');
  const d = draftFrom(state.config);
  let i = 0;
  const err = h('div', {});

  const claudeStep = () => {
    const body = h('div', {}, h('div', { class: 'result wait' }, 'Denetleniyor…'));
    const check = async () => {
      body.replaceChildren(h('div', { class: 'result wait' }, 'Denetleniyor…'));
      const hl = await loadHealth();
      if (hl?.claude.ok) {
        body.replaceChildren(h('div', { class: 'group' }, h('div', { class: 'row' }, h('span', { class: 'dot ok' }), h('div', { class: 'grow' }, h('b', {}, 'Claude Code kurulu'), h('span', {}, hl.claude.detail)))),
          h('div', { class: 'group-foot' }, 'Rehberler Claude hesabınla üretilir; ayrı bir API anahtarı gerekmez.'));
      } else {
        body.replaceChildren(
          h('div', { class: 'group' },
            h('div', { class: 'row stack' }, h('div', { class: 'grow' }, h('b', {}, '1. Claude Code\'u kur'), h('span', {}, 'Terminalde çalıştır (macOS / Linux).')), cmd('curl -fsSL https://claude.ai/install.sh | bash')),
            h('div', { class: 'row stack' }, h('div', { class: 'grow' }, h('b', {}, '2. Giriş yap'), h('span', {}, 'Bir kez çalıştır ve Claude hesabınla oturum aç.')), cmd('claude'))),
          h('div', { class: 'group-foot' }, 'Windows için PowerShell komutu README\'de. Kurduktan sonra yeniden denetle.'),
          h('div', { class: 'ob-center', style: 'margin-top:0' }, h('button', { class: 'btn plain sm', type: 'button', onclick: check }, 'Yeniden denetle')));
      }
    };
    check();
    return body;
  };

  const steps = [
    { hero: true },
    { title: 'Claude Code', lead: 'Rehberi bilgisayarındaki Claude Code yazar.', body: claudeStep },
    { title: 'Jira\'yı bağla', lead: 'Epic\'lerini ve hatalarını listelemek, içeriklerini okumak için.', body: () => jiraSection(d), skip: 'Token olmadan devam et', save: true },
    { title: 'Sen kimsin?', lead: 'Listeyi sana göre süzelim, rehberi de sana göre yazalım.', body: () => profileSection(d) },
    { title: 'Kaynakları seç', lead: 'Rehber yazılırken Jira\'nın yanında nerelere bakılsın?', body: () => sourcesSection(d) },
    { title: 'Son dokunuş', lead: 'İstersen bir ad ve renk ver.', body: () => lookSection(d), next: 'Kullanmaya başla' },
  ];

  const finish = async () => {
    try { await saveDraft(d, { setupDone: true }); box.hidden = true; loadHealth(); loadList(); showWelcome(); }
    catch (e) { err.replaceChildren(h('div', { class: 'msg bad' }, e.message)); }
  };

  function render() {
    const s = steps[i];
    err.replaceChildren();
    if (s.hero) {
      box.replaceChildren(h('div', { class: 'ob' },
        mascot('ob-mark'),
        h('h1', {}, 'qaHere\'a hoş geldin'),
        h('p', { class: 'lead' }, 'Bir Jira işini seç; test etmeden önce okunacak rehberi senin yerine hazırlasın.'),
        h('div', { class: 'feat' }, h('i', {}, icon('doc')), h('div', {}, h('b', {}, 'Tek rehberde her şey'), h('span', {}, 'Akış, kontrol listesi, platform farkları, açık sorular ve kime ne sorulacağı.'))),
        h('div', { class: 'feat' }, h('i', {}, icon('chat')), h('div', {}, h('b', {}, 'Dağınık bağlamı toplar'), h('span', {}, 'Jira işlerini, ilgili yazışmaları ve dokümanları okur; birbiriyle çelişen yerleri gösterir.'))),
        h('div', { class: 'feat' }, h('i', {}, icon('lock')), h('div', {}, h('b', {}, 'Bilgisayarında kalır'), h('span', {}, 'Ayarların ve rehberlerin yalnızca bu bilgisayarda durur. Araç kaynaklarda yalnızca okuma yapar.'))),
        h('div', { class: 'ob-center' }, h('button', { class: 'btn lg', type: 'button', onclick: () => { i = 1; render(); } }, 'Kurulumu başlat'),
          h('span', { class: 'hint' }, 'Yaklaşık iki dakika sürer.'))));
      return;
    }
    box.replaceChildren(h('div', { class: 'ob' },
      h('div', { class: 'steps' }, ...steps.slice(1).map((_, n) => h('span', { class: n === i - 1 ? 'on' : '' }))),
      h('h1', { class: 'sm' }, s.title),
      h('p', { class: 'lead' }, s.lead),
      s.body(), err,
      h('div', { class: 'ob-nav' },
        h('button', { class: 'btn link', type: 'button', onclick: () => { i -= 1; render(); } }, 'Geri'),
        h('div', { class: 'right' },
          s.skip ? h('button', { class: 'btn link', type: 'button', onclick: () => { d.jiraApiToken = ''; i += 1; render(); } }, s.skip) : null,
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            if (i === steps.length - 1) return finish();
            // Jira adımından sonra bağlantı kaydedilir ki sonraki adım panoları okuyabilsin.
            if (s.save && d.jiraOk) { try { await saveDraft(d); d.jiraApiToken = ''; d.hasToken = state.config.hasToken; } catch (e) { err.replaceChildren(h('div', { class: 'msg bad' }, e.message)); return; } }
            i += 1; render();
          } }, s.next || 'Devam')))));
    box.scrollTop = 0;
  }
  box.hidden = false;
  render();
}

// ---- Sol liste -------------------------------------------------------------------------

function issueItem(it, onClick, right) {
  return h('button', { class: `item${state.current === it.key ? ' active' : ''}`, 'data-key': it.key, type: 'button', onclick: onClick },
    h('div', { class: 'k' }, h('span', {}, it.key), right || (it.status ? h('span', { class: `st ${it.statusCategory || ''}` }, it.status) : null)),
    h('div', { class: 's' }, it.summary || it.title || '—'));
}

// Rehberi o an üretilen iş listede dönen bir simgeyle işaretlenir. Üretim başka yerden (başka pencere,
// terminal) başlatılmış olabileceği için sunucuya birkaç saniyede bir sorulur; liste her yenilendiğinde yeniden işlenir.
let runningKey = null;
function paintBusy() {
  document.querySelectorAll('#list .item').forEach((el) => {
    const on = el.dataset.key === runningKey;
    el.classList.toggle('busy', on);
    if (on) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
    el.title = on ? 'Rehberi hazırlanıyor' : '';
  });
}
async function pollActive() {
  const a = await api('/api/jobs/active').catch(() => null);
  if (!a) return;
  const k = a.jobId ? a.key : null;
  if (k !== runningKey) { runningKey = k; paintBusy(); }
}
new MutationObserver(paintBusy).observe($('#list'), { childList: true });
setInterval(pollActive, 4000);
pollActive();

const settingsNote = (text, label = 'Ayarları aç') => h('div', { class: 'note' }, text, h('div', {}, h('button', { class: 'btn plain sm', type: 'button', onclick: openSettings }, label)));

function scopeOf() {
  const sel = $('#scope');
  const hasTeam = state.config.profile?.boards?.length > 0;
  sel.querySelector('option[value="team"]').disabled = !hasTeam;
  if (!sel.dataset.ready) { sel.value = store.get('qahere.scope') || (hasTeam ? 'team' : 'all'); sel.dataset.ready = '1'; }
  if (sel.value === 'team' && !hasTeam) sel.value = 'all';
  return sel.value;
}

async function loadList() {
  const list = $('#list');
  list.replaceChildren(h('div', { class: 'note' }, 'Yükleniyor…'));
  const jiraTab = state.tab !== 'archive';
  $('#sideFilter').hidden = !jiraTab || !state.config.jiraConfigured;
  try {
    if (state.tab === 'archive') {
      const { guides } = await api('/api/guides');
      if (!guides.length) return list.replaceChildren(h('div', { class: 'note' }, 'Henüz rehber yok. Bir iş açıp "Rehber oluştur"a bas.'));
      list.replaceChildren(...guides.map((g) => issueItem({ key: g.key, summary: g.title }, () => openIssue(g.key, g.id), h('span', {}, fmtDate(g.createdAt)))));
      return;
    }
    const what = state.tab === 'bugs' ? 'hata' : 'epic';
    if (!state.config.jiraConfigured) return list.replaceChildren(settingsNote(`${what === 'hata' ? 'Hata' : 'Epic'} listesi için Jira'yı bağla. Bağlamadan da yukarıya işin anahtarını yazıp açabilirsin.`, 'Jira\'yı bağla'));
    if (!state.config.projects.length) return list.replaceChildren(settingsNote('Listelenecek proje seçilmedi.', 'Proje seç'));
    const scope = scopeOf();
    // Takım kapsamı panolardan gelir; proje seçimi yalnızca "Projenin tümü" ve "Benim" için.
    $('#project').hidden = scope === 'team' || state.config.projects.length < 2;
    const q = new URLSearchParams({ kind: state.tab === 'bugs' ? 'bug' : 'epic', scope, project: $('#project').value || '' });
    const { issues } = await api(`/api/list?${q}`);
    if (issues.length) return list.replaceChildren(...issues.map((e) => issueItem(e, () => openIssue(e.key))));
    const empty = {
      team: `Takımının panolarında açık ${what} yok.`,
      mine: `Sana atanan ya da senin açtığın açık ${what} yok.`,
      all: `Bu projede ${what === 'hata' ? 'açık hata' : 'epic'} bulunamadı.`,
    }[scope];
    list.replaceChildren(h('div', { class: 'note' }, empty));
  } catch (e) {
    list.replaceChildren(h('div', { class: 'note' }, h('div', { class: 'msg bad', style: 'margin:0' }, e.message)));
  }
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  state.tab = t.dataset.tab;
  loadList();
}));
$('#scope').addEventListener('change', () => { store.set('qahere.scope', $('#scope').value); loadList(); });
$('#project').addEventListener('change', loadList);

$('#searchForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  const key = (q.toUpperCase().match(/[A-Z][A-Z0-9]+-\d+/) || [])[0];
  if (key) return openIssue(key);
  const list = $('#list');
  if (!state.config.jiraConfigured) return list.replaceChildren(settingsNote('Başlıkla arama için Jira bağlantısı gerekir. İşin anahtarını ya da linkini yazabilirsin.', 'Jira\'yı bağla'));
  list.replaceChildren(h('div', { class: 'note' }, 'Aranıyor…'));
  try {
    const { issues } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    list.replaceChildren(...(issues.length ? issues.map((i) => issueItem(i, () => openIssue(i.key))) : [h('div', { class: 'note' }, 'Sonuç yok.')]));
  } catch (e) { list.replaceChildren(h('div', { class: 'note' }, h('div', { class: 'msg bad', style: 'margin:0' }, e.message))); }
});

// ---- Ana alan ---------------------------------------------------------------------------

const wrap = (...kids) => h('div', { class: 'wrap' }, ...kids);

// ---- Ana ekran -------------------------------------------------------------------------------
// Sabah açılan ekran: sıradaki toplantı (Claude katılacak mı), sürdürdüğün rehberler, ortamın durumu, yaklaşan toplantılar.

const dayName = (d) => d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
const hhmm = (d) => d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
function relDay(d) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const n = Math.round((b - a) / 86400_000);
  return n === 0 ? 'Bugün' : n === 1 ? 'Yarın' : d.toLocaleDateString('tr-TR', { weekday: 'long' });
}
function untilText(d) {
  const min = Math.round((d - Date.now()) / 60_000);
  if (min <= 0 && min > -60) return 'Şu an sürüyor';
  if (min < 60) return `${min} dakika sonra`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} saat ${min % 60 ? `${min % 60} dakika ` : ''}sonra`;
  return `${relDay(d)} ${hhmm(d)}`;
}

// Üst çubuktaki gezinme: hangi ekrandaysan o işaretli (bir iş açıkken ikisi de değil).
function setView(v) {
  document.querySelectorAll('.topnav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.topnav button').forEach((b) => b.setAttribute('aria-current', b.dataset.view === v ? 'page' : 'false'));
}

function showWelcome() {
  state.current = null;
  setView('home');
  $('#main').classList.remove('gmode');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  document.querySelectorAll('.item').forEach((el) => el.classList.remove('active'));
  const cfg = state.config;
  const hl = state.health;
  const notice = [];
  if (hl && !hl.claude.ok) notice.push(h('div', { class: 'callout' }, h('div', {}, h('b', {}, 'Claude Code bulunamadı'), h('span', {}, 'Rehber üretimi onsuz çalışmaz.')), h('button', { class: 'btn sm', type: 'button', onclick: startOnboarding }, 'Kurulumu aç')));
  if (!cfg.jiraConfigured) notice.push(h('div', { class: 'callout' }, h('div', {}, h('b', {}, 'Jira bağlı değil'), h('span', {}, 'Epic listesi ve başlıkla arama için bağla.')), h('button', { class: 'btn sm', type: 'button', onclick: openSettings }, 'Bağla')));

  const ticket = h('section', { class: 'ticket is-loading', 'aria-label': 'Sıradaki toplantı' }, h('div', { class: 'tk-main' }, h('span', { class: 'tk-kicker' }, 'Sıradaki toplantı'), h('div', { class: 'tk-time' }, '··:··')));
  const env = h('section', { class: 'env', 'aria-label': 'Ortam' });
  const guides = h('div', { class: 'glist' });
  const agenda = h('div', { class: 'agenda' });

  $('#main').replaceChildren(h('div', { class: 'wrap home' },
    h('header', { class: 'home-head' }, h('h1', {}, dayName(new Date())),
      h('p', {}, 'Bir işe başlamak için soldan seç ya da anahtarını yaz.')),
    ...notice,
    h('div', { class: 'home-top' }, ticket, env),
    h('div', { class: 'home-cols' },
      h('section', {}, h('h2', { class: 'home-h' }, 'Rehberlerin'), guides),
      h('section', {}, h('h2', { class: 'home-h' }, 'Yaklaşan toplantılar'), agenda))));

  // ---- toplantılar
  api('/api/meetings').then((r) => {
    const now = Date.now();
    const list = r.upcoming.map((m) => ({ ...m, at: new Date(m.start) })).filter((m) => !Number.isNaN(+m.at) && +m.at > now - 60 * 60_000).sort((a, b) => a.at - b.at);
    const auto = r.settings.autoAdd;
    const withClaude = list.find((m) => m.decision === 'eklendi' || m.decision === 'eklenecek');
    const next = list[0];
    ticket.classList.remove('is-loading');
    if (!r.settings.enabled) {
      ticket.replaceChildren(h('div', { class: 'tk-main' }, h('span', { class: 'tk-kicker' }, 'Toplantılar kapalı'),
        h('p', { class: 'tk-empty' }, 'Claude toplantılara katılmıyor ve not almıyor.'), h('button', { class: 'btn plain sm', type: 'button', onclick: openSettings }, 'Ayarlardan aç')));
    } else if (!next) {
      ticket.replaceChildren(h('div', { class: 'tk-main' }, h('span', { class: 'tk-kicker' }, 'Sıradaki toplantı'),
        h('p', { class: 'tk-empty' }, r.joinRunAt ? 'Bugün ve yarın için takviminde toplantı yok.' : 'Takvimin henüz okunmadı. Claude Desktop\'taki "qaHere yaklaşan toplantılar" görevi hafta içi saatte bir bakar.')));
    } else {
      const stub = (m) => {
        const box = h('div', { class: `tk-stub st-${m.decision || 'yok'}` });
        const say = (b, t, ...rest) => box.replaceChildren(mascot('tk-mascot'), h('b', {}, b), t ? h('span', {}, t) : null, ...rest);
        if (m.decision === 'eklendi') say('Claude katılacak', 'Toplantı bitince kararlar rehbere gelir.');
        else if (m.decision === 'eklenecek' && +m.at < Date.now() - 15 * 60_000) { say('Claude eklenmedi', 'Toplantı başlayalı 15 dakikadan fazla oldu; qaHere başlamış toplantıya eklemez.'); box.className = 'tk-stub st-gecti'; }
        else if (m.decision === 'eklenecek') {
          if (auto) say('Claude eklenecek', 'qaHere birkaç dakika içinde ekler.');
          else {
            const add = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
              add.disabled = true; add.textContent = 'Ekleniyor…';
              try { const x = await send(`/api/meetings/${encodeURIComponent(m.id)}/join`, 'POST', { action: 'add' }); if (x.ok) { m.decision = 'eklendi'; box.replaceWith(stub(m)); } else { add.disabled = false; add.textContent = 'Yeniden dene'; box.querySelector('span').textContent = x.detail; } }
              catch (e) { add.disabled = false; add.textContent = 'Yeniden dene'; box.querySelector('span').textContent = e.message; }
            } }, 'Claude\'u ekle');
            say('Claude katılmıyor', 'Bu toplantı kurala uyuyor; eklemek senin onayınla.', add);
          }
        } else {
          const want = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
            want.disabled = true;
            try { await send(`/api/meetings/${encodeURIComponent(m.id)}`, 'PUT', { choice: 'add' }); m.decision = 'eklenecek'; box.replaceWith(stub(m)); } catch { want.disabled = false; }
          } }, 'Yine de katılsın');
          say('Claude katılmayacak', m.reason || '', want);
        }
        return box;
      };
      const main = h('div', { class: 'tk-main' },
        h('span', { class: 'tk-kicker' }, 'Sıradaki toplantı'),
        h('div', { class: 'tk-time' }, hhmm(next.at)),
        h('div', { class: 'tk-when' }, untilText(next.at)),
        h('h2', { class: 'tk-title' }, next.title),
        withClaude && withClaude !== next ? h('p', { class: 'tk-also' }, `Claude'un katılacağı sıradaki: ${relDay(withClaude.at)} ${hhmm(withClaude.at)}, ${withClaude.title}`) : null);
      ticket.replaceChildren(main, stub(next));
    }
    // gün gün liste
    if (!list.length) { agenda.replaceChildren(h('p', { class: 'muted' }, 'Liste boş.')); return; }
    const days = new Map();
    for (const m of list) { const k = relDay(m.at); if (!days.has(k)) days.set(k, []); days.get(k).push(m); }
    const LABEL = { eklendi: 'Claude katılacak', eklenecek: auto ? 'Claude eklenecek' : 'Claude eklenebilir', atlandi: 'Claude katılmayacak', kaldirildi: 'Claude çıkarıldı', hata: 'Eklenemedi' };
    const row = (m) => h('div', { class: `ag-row st-${m.decision || 'yok'}` }, h('time', {}, hhmm(m.at)),
      h('div', {}, h('b', {}, m.title), h('span', {}, m.decision === 'eklenecek' && +m.at < Date.now() - 15 * 60_000 ? 'Claude eklenmedi' : LABEL[m.decision] || '')));
    agenda.replaceChildren(...[...days].map(([d, ms]) => h('div', { class: 'ag-day' }, h('h3', {}, d), ...ms.map(row))),
      h('button', { class: 'btn link sm', type: 'button', onclick: openSettings }, 'Toplantı ayarları'));
  }).catch(() => { ticket.classList.remove('is-loading'); ticket.replaceChildren(h('div', { class: 'tk-main' }, h('span', { class: 'tk-kicker' }, 'Sıradaki toplantı'), h('p', { class: 'tk-empty' }, 'Toplantılar okunamadı.'))); });

  // ---- rehberler: her işin en son rehberi, önce yarım kalanlar
  api('/api/guides').then(({ guides: gs }) => {
    const latest = new Map();
    for (const g of gs) if (!latest.has(g.key)) latest.set(g.key, g);
    const rows = [...latest.values()].map((g) => ({ g, total: g.checkTotal || 0, done: g.checks?.length || 0, fail: g.failed?.length || 0 }))
      .sort((a, b) => (b.fail - a.fail) || ((a.total && a.done === a.total) - (b.total && b.done === b.total)) || b.g.createdAt.localeCompare(a.g.createdAt))
      .slice(0, 8);
    if (!rows.length) { guides.replaceChildren(h('p', { class: 'muted' }, 'Henüz rehber yok. Soldan bir iş seçip "Rehber oluştur"a bas.')); return; }
    guides.replaceChildren(...rows.map(({ g, total, done, fail }) => {
      const pct = (n) => `${total ? (n / total) * 100 : 0}%`;
      const notes = [fail ? h('em', { class: 'badt' }, `${fail} kaldı`) : null, g.pending?.count ? h('em', { class: 'warnt' }, `${g.pending.count} güncelleme`) : null].filter(Boolean);
      return h('button', { class: 'grow-row', type: 'button', onclick: () => openIssue(g.key, g.id) },
        h('span', { class: 'gr-key' }, g.key),
        h('span', { class: 'gr-name' }, g.issueSummary || g.title),
        h('span', { class: 'gr-bar', role: 'img', 'aria-label': `${total} maddeden ${done} bitti, ${fail} kaldı` },
          h('i', { class: 'b-done', style: `width:${pct(done)}` }), h('i', { class: 'b-fail', style: `width:${pct(fail)}` })),
        h('span', { class: 'gr-count' }, total ? `${done}/${total}` : '—'),
        notes.length ? h('span', { class: 'gr-notes' }, ...notes) : h('span', { class: 'gr-notes' }));
    }));
  }).catch(() => guides.replaceChildren(h('p', { class: 'muted' }, 'Rehberler okunamadı.')));

  // ---- ortam: kokpitin özeti
  const ENV = [['android', 'Android'], ['ios', 'iOS'], ['claude', 'Claude Code'], ['jira', 'Jira'], ['firebase', 'Firebase'], ['testmu', 'TestMu'], ['meet', 'Toplantı görevi']];
  const cells = Object.fromEntries(ENV.map(([k, n]) => [k, h('li', { class: 'off' }, h('i', {}), h('span', {}, n), h('small', {}, '…'))]));
  const set = (k, st, t) => { cells[k].className = st; cells[k].querySelector('small').textContent = t; };
  env.replaceChildren(h('h2', { class: 'home-h' }, 'Ortam'), h('ul', {}, ...Object.values(cells)),
    h('button', { class: 'btn plain sm', type: 'button', onclick: showCockpit }, 'Kokpiti aç'));
  api('/api/health').then((x) => {
    set('claude', x.claude.ok ? 'ok' : 'bad', x.claude.ok ? 'hazır' : 'yok');
    set('jira', !x.jira.configured ? 'warn' : x.jira.ok ? 'ok' : 'bad', !x.jira.configured ? 'bağlı değil' : x.jira.ok ? 'bağlı' : 'hata');
  }).catch(() => {});
  api('/api/cockpit/app').then((a) => {
    for (const p of ['android', 'ios']) {
      const x = a[p];
      set(p, !x.appId ? 'off' : !x.device || !x.installed ? 'bad' : x.crash ? 'bad' : 'ok',
        !x.appId ? 'ayarlı değil' : !x.device ? 'cihaz yok' : !x.installed ? 'kurulu değil' : x.crash ? 'çöktü' : `${x.installed.version || x.installed.build}`);
    }
  }).catch(() => {});
  api('/api/cockpit/tools').then((t) => {
    set('firebase', t.firebase.ok ? 'ok' : 'bad', t.firebase.ok ? 'giriş var' : 'giriş gerekli');
    if (!t.firebase.ok) env.querySelector('ul').after(h('div', { class: 'env-fix' }, h('span', {}, t.firebase.detail), fbLoginButton(() => showWelcome())));
    const m = t.testmu || {};
    set('testmu', m.ok === null ? 'off' : m.ok ? 'ok' : 'bad', m.ok === null ? 'ayarlı değil' : m.ok ? (m.detail.match(/aynı anda \d+ koşu/)?.[0] || 'bağlı') : 'bağlanamadı');
    const j = t.meetingJoin;
    set('meet', !t.meetingsEnabled ? 'off' : j.ok ? 'ok' : 'warn', !t.meetingsEnabled ? 'kapalı' : j.detail.replace('Son çalışma ', ''));
  }).catch(() => {});
}

async function openIssue(key, guideId) {
  state.current = key;
  setView('');
  history.replaceState(null, '', `#${key}`);
  document.querySelectorAll('.item').forEach((el) => el.classList.toggle('active', el.dataset.key === key));
  const main = $('#main');
  main.classList.remove('gmode');
  main.replaceChildren(wrap(h('div', { class: 'note' }, `${key} yükleniyor…`)));
  let data;
  try { data = await api(`/api/issues/${key}`); }
  catch (e) { return main.replaceChildren(wrap(h('div', { class: 'msg bad' }, e.message))); }
  if (state.current !== key) return;
  const { issue, children, guides, limited } = data;
  const sourceNames = ['Jira', ...SOURCES.filter((s) => state.config.sources[s.key]).map((s) => s.name)];
  const hasGuide = guides.length > 0;

  const head = h('div', { class: 'ihead' },
    h('div', { class: 'eyebrow' },
      issue.url ? h('a', { href: issue.url, target: '_blank', rel: 'noopener' }, issue.key) : h('b', {}, issue.key),
      issue.type ? h('span', {}, issue.type) : null,
      issue.status ? h('span', { class: `st ${issue.statusCategory}` }, issue.status) : null),
    h('h1', { class: 'title' }, issue.summary || guides[0]?.issueSummary || key),
    h('div', { class: 'sub' }, limited ? (hasGuide ? 'Jira bağlı değil; başlık kayıtlı rehberden alındı.' : 'Jira bağlı olmadığı için iş ayrıntıları burada gösterilmiyor; rehber yine de üretilebilir.')
      : [issue.assignee && `Atanan: ${issue.assignee}`, issue.reporter && `Raporlayan: ${issue.reporter}`, issue.parent && `Üst iş: ${issue.parent.key}`].filter(Boolean).join('  ·  ')));

  const gen = h('div', { class: 'card', id: 'genCard', hidden: hasGuide },
    h('h2', {}, hasGuide ? 'Rehberi yeniden oluştur' : 'QA rehberi'),
    h('div', { class: 'sub' }, issue.isBug
      ? `Hata rehberi: yeniden üretme, düzeltmenin doğrulanması ve regresyon. ${sourceNames.join(', ')} taranır; epic rehberinden kısadır ve Claude kullanım hakkından düşer.${hasGuide ? ' Mevcut rehber silinmez; önceki sürüm olarak kalır.' : ''}`
      : `${sourceNames.join(', ')} taranır${children.length ? ` · ${children.length} alt iş` : ''}. Genelde 3–8 dakika sürer ve Claude kullanım hakkından düşer.${hasGuide ? ' Mevcut rehber silinmez; önceki sürüm olarak kalır.' : ''}`),
    h('div', { class: 'gen' },
      h('label', { class: 'f' }, 'Ek not (isteğe bağlı)',
        h('textarea', { id: 'notes', placeholder: 'Örn. hata durumlarına ağırlık ver', maxlength: '600' })),
      h('button', { class: 'btn', id: 'genBtn', type: 'button', onclick: () => startJob(key) }, hasGuide ? 'Yeniden oluştur' : 'Rehber oluştur')),
    h('div', { id: 'progress' }));

  const kidsTable = () => h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...['Anahtar', 'Başlık', 'Atanan', 'Durum'].map((t) => h('th', {}, t)))),
    h('tbody', {}, ...children.map((c) => h('tr', {},
      h('td', {}, h('a', { href: c.url, target: '_blank', rel: 'noopener' }, c.key)),
      h('td', {}, c.summary), h('td', {}, c.assignee || '—'),
      h('td', {}, h('span', { class: `st ${c.statusCategory}` }, c.status)))))));
  state.kids = children.length ? { count: children.length, render: kidsTable } : null;

  if (hasGuide) {
    // Rehber varsa ekranın tamamı ona ayrılır: üstte ince iş şeridi + araç çubuğu, altında rehber.
    main.classList.add('gmode');
    main.replaceChildren(h('div', { class: 'gtop' }, head, gen), h('div', { id: 'viewer', class: 'gview' }));
  } else {
    const kids = children.length ? h('div', { class: 'card' }, h('h2', {}, 'Alt işler'), h('div', { class: 'sub' }, `${children.length} iş`), kidsTable()) : null;
    main.replaceChildren(wrap(head, gen, h('div', { id: 'viewer' }), kids));
  }
  main.scrollTop = 0;
  renderGuides(key, guides, guideId || guides[0]?.id);

  // Bu iş için süren bir üretim varsa ilerlemeye bağlan
  const active = await api('/api/jobs/active').catch(() => ({}));
  if (active.jobId && active.key === key) attachJob(active.jobId, key);
}

function renderGuides(key, guides, selectedId) {
  const box = $('#viewer');
  if (!box) return;
  if (!guides.length) return box.replaceChildren();
  const g = guides.find((x) => x.id === selectedId) || guides[0];
  const base = `/guides/${g.key}/${g.id}`;
  const stats = g.stats ? `${Math.round((g.stats.durationMs || 0) / 60000) || '<1'} dk · ${g.stats.toolCalls ?? '?'} kaynak sorgusu · ${g.model}` : g.model;

  const progress = h('div', { class: 'checks' });
  const paintProgress = (note) => {
    if (!g.checkTotal) return progress.replaceChildren();
    const n = g.checks?.length || 0;
    const failed = g.failed?.length || 0;
    const all = n === g.checkTotal;
    progress.classList.toggle('all', all);
    progress.replaceChildren(
      h('span', { class: 'cnum' }, h('b', {}, String(n)), ` / ${g.checkTotal} kontrol`),
      h('span', { class: 'cbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(g.checkTotal), 'aria-valuenow': String(n) },
        h('i', { style: `width:${(n / g.checkTotal) * 100}%` })),
      note ? h('span', { class: 'cnote bad err' }, note)
        : failed ? h('span', { class: 'cnote bad' }, `${failed} madde kaldı`)
          : h('span', { class: 'cnote' }, all ? 'Tamamı bitti' : 'Otomatik kaydediliyor'));
  };
  paintProgress();

  // Rehber korumalı bir çerçeveye srcdoc ile gömülür: ayrı köken (allow-same-origin yok), dış istek yok.
  // Çalışabilen tek betik, her açılışta üretilen nonce'lu viewer.js; rehber içeriğindeki betikler CSP'ye takılır.
  const frame = h('iframe', { class: 'viewer', title: `${g.key} QA rehberi`, sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox' });
  Promise.all([fetch(`${base}.html`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error('Rehber yüklenemedi.')))), viewerAssets()])
    .then(([html, assets]) => { frame.srcdoc = withViewer(html, assets); })
    .catch((e) => frame.replaceWith(h('div', { class: 'msg bad' }, e.message)));

  // Her işaret hemen kaydedilir. keepalive: sekme o an kapansa da istek tamamlanır.
  // rev: ağdan geç dönen eski bir isteğin yeni durumu ezmesini önler (sunucu her seferinde tüm durumu alır).
  let seq = 0;
  state.onChecks = (e) => {
    if (e.source !== frame.contentWindow) return;
    const msg = e.data || {};
    if (msg.qa === 'run' && Number.isInteger(msg.c) && ['ios', 'android'].includes(msg.platform)) {
      return openRunSheet({ g, frame, c: msg.c, platform: msg.platform, item: String(msg.text || '').slice(0, 1500), section: String(msg.section || '').slice(0, 200) });
    }
    if (msg.qa === 'taskKeys' && Array.isArray(msg.keys)) {
      const keys = [...new Set([...msg.keys, g.key])].filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k)).slice(0, 60);
      api(`/api/firebase/builds?keys=${encodeURIComponent(keys.join(','))}`).then((data) => {
        if (data.platforms?.length) frame.contentWindow?.postMessage({ qa: 'builds', data: { ...data, guideKey: g.key } }, '*');
      }).catch(() => {});
      return;
    }
    if (msg.qa === 'runGroup' && ['ios', 'android'].includes(msg.platform) && Array.isArray(msg.items)) {
      return openBatchRunSheet({ g, frame, platform: msg.platform, title: String(msg.title || '').slice(0, 200),
        items: msg.items.filter((x) => Number.isInteger(x?.c)).slice(0, 60).map((x) => ({ c: x.c, text: String(x.text || '').slice(0, 1500), section: String(x.section || '').slice(0, 200), state: String(x.state || '') })) });
    }
    if (msg.qa === 'mockblock' && typeof msg.text === 'string') {
      return openMockSheet({ g, c: null, item: '', onChange: paintMocks, preset: parseMockBlock(String(msg.title || ''), msg.text) });
    }
    if (msg.qa === 'mock' && Number.isInteger(msg.c)) {
      return openMockSheet({ g, c: msg.c, item: String(msg.text || '').slice(0, 1500), onChange: paintMocks });
    }
    if (msg.qa === 'fail' && Number.isInteger(msg.c)) {
      return openBugSheet({ g, frame, c: msg.c, platform: msg.platform, item: String(msg.text || '').slice(0, 1500), section: String(msg.section || '').slice(0, 200) });
    }
    if (msg.qa !== 'results' || typeof msg.results !== 'object' || !Array.isArray(msg.platforms)) return;
    const mine = ++seq;
    fetch(`/api/guides/${g.key}/${g.id}/results`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: msg.results, platforms: msg.platforms, rev: Date.now() * 1000 + (mine % 1000) }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((rec) => { if (mine !== seq) return; Object.assign(g, { checks: rec.checks, failed: rec.failed, platforms: rec.platforms }); paintProgress(); })
      .catch((err) => { if (mine === seq) paintProgress(`Kaydedilemedi (${err.message}). Yeniden işaretle.`); });
  };

  // Açık mock varsa araç çubuğunda görünür: test bitince kapatmak unutulmasın.
  const mocksBtn = h('button', { class: 'btn plain sm mockbtn', type: 'button', onclick: () => openMockSheet({ g, c: null, item: '', onChange: paintMocks }) });
  function paintMocks() {
    const on = (g.mocks || []).filter((m) => m.enabled).length;
    mocksBtn.hidden = !(g.mocks || []).length;
    mocksBtn.classList.toggle('on', on > 0);
    mocksBtn.textContent = on ? `Mock açık (${on})` : 'Mocklar';
  }
  paintMocks();

  const del = h('button', { class: 'btn danger sm', type: 'button', onclick: async () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Silmeyi onayla'; setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Sil'; }, 4000); return; }
    await api(`/api/guides/${g.key}/${g.id}`, { method: 'DELETE' });
    if (state.tab === 'archive') loadList();
    openIssue(key);
  } }, 'Sil');
  const regen = h('button', { class: 'btn plain sm', type: 'button', onclick: () => {
    const card = $('#genCard');
    if (!card) return;
    card.hidden = !card.hidden;
    if (!card.hidden) $('#notes')?.focus();
  } }, 'Yeniden oluştur');
  const version = guides.length > 1 ? h('select', { class: 'ver', 'aria-label': 'Rehber sürümü', onchange: (e) => renderGuides(key, guides, e.target.value) },
    ...guides.map((x, i) => { const o = h('option', { value: x.id }, `${fmtDate(x.createdAt)}${i === 0 ? ' (son)' : ''}`); if (x.id === g.id) o.selected = true; return o; })) : null;
  const kidsBtn = state.kids ? h('button', { class: 'btn plain sm', type: 'button', onclick: () => openSheet(`Alt işler (${state.kids.count})`, state.kids.render(), [h('button', { class: 'btn sm', type: 'button', onclick: closeSheet }, 'Kapat')]) }, `Alt işler (${state.kids.count})`) : null;

  const ask = askPanel(g, { frame });
  // Araç çubuğunda iki düğme, aynı panelin iki sekmesi: açık sekmenin düğmesi panel kapatır.
  const panelBtn = (t, label) => h('button', { class: 'btn plain sm askbtn', type: 'button', onclick: () => (ask.isOpen() && ask.tab() === t ? ask.close() : ask.open(t)) }, label);
  const askBtn = panelBtn('ask', 'Rehbere sor');
  const syncBtn = h('button', { class: 'btn plain sm', type: 'button', title: `Rehberden sonra Jira'da ve Slack'te yazılanları bul, rehbere ekle${g.syncedAt ? ` (son denetim: ${fmtDate(g.syncedAt)})` : ''}`,
    onclick: () => (g.pending ? showSyncPreview(g, { ops: g.pending.ops, count: g.pending.count, pending: true }) : openSyncSheet(g)) }, 'Güncellemeleri denetle');
  watchAutoSync(g, syncBtn);
  const botBtn = panelBtn('bugbot', 'Bugbot');
  ask.onChange = () => { for (const [b, t] of [[askBtn, 'ask'], [botBtn, 'bugbot']]) b.setAttribute('aria-expanded', String(ask.isOpen() && ask.tab() === t)); };
  ask.onChange();

  box.replaceChildren(
    h('div', { class: 'gbar' },
      // İşin başlığı hemen üstte ve rehberin kendisinde yazıyor; burada rehberin ne zaman, nasıl üretildiği.
      h('div', { class: 'gtitle' }, h('h2', {}, `${fmtDate(g.createdAt)} tarihli rehber`), h('div', { class: 'sub' }, stats)),
      progress,
      h('div', { class: 'acts' },
        version, runMenu(g, frame), askBtn, botBtn, syncBtn,
        moreMenu([kidsBtn, mocksBtn,
          state.config?.testmu?.hasKey ? h('button', { class: 'btn plain sm', type: 'button', onclick: () => openTestManagerSheet(g) }, 'Test Manager\'a aktar') : null,
          regen,
          h('a', { class: 'btn plain sm', href: `${base}.html`, target: '_blank', rel: 'noopener', title: 'Tam rapor, düz sırayla' }, 'Yeni sekmede aç'),
          del]),
        h('a', { class: 'btn sm', href: `${base}.pdf` }, 'PDF indir'))),
    ...denialNotes(g),
    h('div', { class: 'gbody' }, frame, ask.el));
}

/** Kontrol listesini TestMu Test Manager'a aktarma: önizleme → onay → qaHere yazar. Yeniden aktarmada kopya açılmaz. */
async function openTestManagerSheet(g) {
  const body = h('div', { class: 'tmx' }, h('p', { class: 'muted' }, 'Test Manager okunuyor…'));
  const go = h('button', { class: 'btn sm', type: 'button', disabled: true }, 'Aktar');
  openSheet('Test Manager\'a aktar', body, [h('button', { class: 'btn plain sm', type: 'button', onclick: closeSheet }, 'Vazgeç'), go]);
  let pv, projects;
  try { [pv, { projects }] = await Promise.all([api(`/api/guides/${g.key}/${g.id}/testmanager`), api('/api/testmanager/projects')]); }
  catch (e) { return body.replaceChildren(h('div', { class: 'msg bad' }, e.message)); }
  const NEW = '__new__';
  const sel = h('select', { 'aria-label': 'Test Manager projesi' },
    ...projects.map((p) => h('option', { value: p.id }, p.name)), h('option', { value: NEW }, 'Yeni proje aç…'));
  sel.value = pv.previous?.projectId && projects.some((p) => p.id === pv.previous.projectId) ? pv.previous.projectId : projects.length ? projects[0].id : NEW;
  const name = h('input', { class: 'bare', value: `${g.key.split('-')[0]} · qaHere`, placeholder: 'Yeni proje adı', 'aria-label': 'Yeni proje adı' });
  const nameRow = h('div', { class: 'row' }, h('span', { class: 'k' }, 'Proje adı'), name);
  const showName = () => { nameRow.hidden = sel.value !== NEW; };
  sel.onchange = showName; showName();
  const res = pv.plan.results || {};
  const resTotal = Object.values(res).reduce((a, b) => a + b, 0);
  const withRes = h('input', { type: 'checkbox', disabled: !resTotal });
  withRes.checked = resTotal > 0;
  const plan = pv.plan;
  const what = [plan.create && `${plan.create} yeni senaryo`, plan.update && `${plan.update} senaryo güncellenecek`, plan.archive && `${plan.archive} senaryo arşivlenecek`].filter(Boolean).join(', ') || 'Senaryolar güncel; yeni madde yok';
  const status = h('div', {});
  body.replaceChildren(...[
    pv.previous ? h('div', { class: 'msg' }, `${fmtDate(pv.previous.exportedAt)} tarihinde "${pv.previous.projectName || 'Test Manager'}" projesine aktarıldı. Yalnız yeni ve metni değişen maddeler gider; kopya açılmaz.`) : null,
    h('div', { class: 'group' },
      h('div', { class: 'row' }, h('span', { class: 'k' }, 'Proje'), sel), nameRow,
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, `${pv.total} kontrol maddesi`), h('span', {}, `${what}. Her madde bir test senaryosu; rehberle aynı adlı bir klasöre girer, Jira işine bağlanır.`))),
      h('label', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, 'İşaretli sonuçları test koşusu olarak işle'),
        h('span', {}, resTotal ? Object.entries(res).filter(([, n]) => n).map(([p, n]) => `${PL[p]}: ${n} sonuç`).join(' · ') + '. Platform başına bir koşu açılır; Kaldı olanlara hata kaydı not düşülür.' : 'Henüz işaretli sonuç yok.')), withRes)),
    pv.sample.length ? h('div', { class: 'group-title' }, 'İlk senaryolar') : null,
    pv.sample.length ? h('ul', { class: 'tmx-sample' }, ...pv.sample.map((x) => h('li', {}, x.title))) : null,
    h('p', { class: 'hint' }, 'Ortam ve test hazırlığı maddeleri her senaryoya ön koşul olarak yazılır. TestMu\'da silme yok: açılan senaryo ve koşular orada kalır (elle silinebilir).'),
    status].filter(Boolean));
  go.disabled = false;
  go.onclick = async () => {
    if (sel.value === NEW && !name.value.trim()) { name.focus(); return; }
    go.disabled = true; sel.disabled = true; name.disabled = true; withRes.disabled = true;
    status.replaceChildren(h('div', { class: 'msg wait' }, 'Başlıyor…'));
    let last = null;
    try {
      const r = await fetch(`/api/guides/${g.key}/${g.id}/testmanager`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: sel.value === NEW ? { name: name.value.trim() } : { id: sel.value }, withResults: withRes.checked }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Aktarılamadı (${r.status}).`); }
      const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let e; try { e = JSON.parse(line); } catch { continue; }
          if (e.type === 'step') status.replaceChildren(h('div', { class: 'msg wait' }, `${e.message}…`));
          else last = e;
        }
      }
      if (last?.type !== 'done') throw new Error(last?.message || 'Aktarma tamamlanamadı.');
      status.replaceChildren(
        h('div', { class: 'msg ok' }, `"${last.projectName || 'Test Manager'}" projesinde ${last.cases} senaryo hazır${last.runs.length ? `; ${last.runs.map((x) => `${PL[x.platform]} koşusu (${x.count} sonuç)`).join(', ')} açıldı` : ''}.`),
        ...last.warnings.map((w) => h('div', { class: 'msg warn' }, w)));
      go.textContent = 'Bitti'; go.disabled = false; go.onclick = closeSheet;
    } catch (e) {
      status.replaceChildren(h('div', { class: 'msg bad' }, e.message));
      go.disabled = false; sel.disabled = false; name.disabled = false; withRes.disabled = !resTotal;
    }
  };
}

/** Rehberin şu anki işini (işaretlenmemiş maddesi olan ilk iş) seçilen platformda sırayla koşturur: simülatörde ya da TestMu gerçek cihazında. */
function runMenu(g, frame) {
  const ps = (g.platforms?.length ? g.platforms : ['ios', 'android']).filter((p) => p === 'ios' || p === 'android');
  const NAME = { ios: 'iOS', android: 'Android' };
  return moreMenu(ps.map((p) => h('button', { class: 'btn plain sm', type: 'button', title: 'Koşu penceresinde simülatör ya da TestMu gerçek cihaz seçilir',
    onclick: () => frame.contentWindow?.postMessage({ qa: 'runCurrent', platform: p }, '*') }, `Şu anki işi ${NAME[p]}${p === 'ios' ? '\'ta' : '\'de'} koş`)), 'Cihazda koş', 'btn plain sm runbtn');
}

/** Seyrek kullanılan işlemler tek "Diğer" menüsünde; dışarı tıklayınca ya da Escape ile kapanır. */
function moreMenu(items, label = 'Diğer', cls = 'btn plain sm') {
  const d = h('details', { class: 'more' }, h('summary', { class: cls }, label), h('div', { class: 'menu', role: 'menu' }, ...items.filter(Boolean)));
  const close = (e) => { if (d.open && (e.type === 'keydown' ? e.key === 'Escape' : !d.contains(e.target))) d.open = false; };
  document.addEventListener('click', close);
  document.addEventListener('keydown', close);
  d.querySelector('.menu').addEventListener('click', (e) => { if (e.target.closest('button,a') && !e.target.classList.contains('danger')) d.open = false; });
  return d;
}

// ---- Rehberi güncelle: rehberden sonra yazılanları bul, önizle, onaylanırsa yeni sürüm ----

/** Rehber açılınca: ayardaki süre dolduysa sunucu arka planda denetler; bulunan öneri düğmede "Güncelleme var" olarak bekler. */
function watchAutoSync(g, btn) {
  const paint = (running) => {
    btn.classList.toggle('has-upd', Boolean(g.pending));
    btn.textContent = g.pending ? `Güncelleme var (${g.pending.count})` : running ? 'Güncellemelere bakılıyor…' : 'Güncellemeleri denetle';
    if (g.pending) btn.title = g.pending.summary;
  };
  paint(false);
  if (g.pending) return;
  const shown = () => state.current === g.key && document.body.contains(btn);
  send(`/api/guides/${g.key}/${g.id}/sync/auto`, 'POST', {}).then(async (r) => {
    if (r.status === 'pending') { g.pending = r.pending; return paint(false); }
    if (r.status !== 'started' && r.status !== 'running') return;
    paint(true);
    for (let i = 0; i < 40 && shown(); i++) {
      await new Promise((ok) => setTimeout(ok, 15_000));
      const s = await api(`/api/guides/${g.key}/${g.id}/sync/auto`).catch(() => null);
      if (!s) continue;
      if (s.pending) g.pending = s.pending;
      if (!s.running) break;
    }
    if (shown()) paint(false);
  }).catch(() => {});
}
function openSyncSheet(g) {
  const log = h('ul', { class: 'log' });
  const body = h('div', {}, h('p', {}, `Rehber ${fmtDate(g.syncedAt || g.createdAt)} itibarıyla hazır. Bu tarihten sonra Jira'da ve Slack'te yazılanlara bakılıyor; rehber yeniden üretilmez, yalnızca değişenler eklenir.`), log);
  const ctrl = new AbortController();
  const cancel = h('button', { class: 'btn link sm', type: 'button', onclick: () => { ctrl.abort(); closeSheet(); } }, 'Vazgeç');
  openSheet('Güncellemeleri denetle', body, [cancel]);
  $('#sheet').addEventListener('close', () => ctrl.abort(), { once: true });
  const add = (t) => { log.append(h('li', {}, t)); log.scrollTop = log.scrollHeight; };
  (async () => {
    try {
      const res = await fetch(`/api/guides/${g.key}/${g.id}/sync`, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Sunucu ${res.status} döndü.`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let result = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'step') add(ev.message);
          else if (ev.type === 'error') throw new Error(ev.message);
          else if (ev.type === 'done') result = ev;
        }
      }
      if (!result) throw new Error('Yanıt yarım kaldı.');
      showSyncPreview(g, result);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      body.append(h('div', { class: 'msg bad' }, e.message));
    }
  })();
}

function showSyncPreview(g, r) {
  const o = r.ops;
  const textOf = (c) => `${c}. madde`;
  const part = (title, items) => (items.length ? [h('div', { class: 'group-title' }, title), h('ul', { class: 'sync-list' }, ...items)] : []);
  const apply = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    apply.disabled = true; apply.textContent = 'Ekleniyor…';
    try {
      const x = await send(`/api/guides/${g.key}/${g.id}/sync/apply`, 'POST', r.pending ? { pending: true } : { token: r.token });
      closeSheet();
      g.pending = null;
      if (x.updated) openIssue(g.key, x.guide.id);
    } catch (e) { apply.disabled = false; apply.textContent = 'Rehbere ekle'; msg.replaceChildren(h('div', { class: 'msg bad' }, e.message)); }
  } }, r.count ? 'Rehbere ekle' : 'Tamam');
  const msg = h('div', {});
  openSheet(r.count ? 'Rehbere eklenecekler' : 'Yeni bir şey yok', h('div', {},
    h('p', {}, o.summary),
    ...part('Güncelleme notları', o.notes.map((x) => h('li', {}, x.text, x.source ? [' ', h('a', { href: x.source, target: '_blank', rel: 'noopener' }, 'kaynak')] : []))),
    ...part('Yeni kontrol maddeleri', o.add_checks.map((x) => h('li', {}, x.text, x.group ? h('span', { class: 'hint' }, ` · ${x.group}`) : null))),
    ...part('Değişen maddeler (işareti sıfırlanır)', o.change_checks.map((x) => h('li', {}, h('b', {}, `${textOf(x.c + 1)}: `), x.text, x.reason ? h('span', { class: 'hint' }, ` · ${x.reason}`) : null))),
    ...part('Geçersiz kalan maddeler', o.obsolete_checks.map((x) => h('li', {}, h('b', {}, `${textOf(x.c + 1)}: `), x.reason))),
    ...part('Yeni çelişkiler', o.add_conflicts.map((x) => h('li', {}, x.text))),
    r.count ? h('p', { class: 'hint' }, 'Eklenince rehberin yeni bir sürümü oluşur; işaretlerin, hata kayıtların ve sohbetler taşınır, eski sürüm de durur.') : h('p', { class: 'hint' }, 'Denetim zamanı kaydedilir; bir sonraki denetim buradan devam eder.'),
    r.pending ? h('p', { class: 'hint' }, 'Bu öneri rehber açılırken arka planda yapılan denetimden geldi.') : null,
    h('p', { class: 'hint' }, [r.stats?.jiraComments ? `${r.stats.jiraComments} yeni Jira yorumu` : null, r.stats?.tools != null ? `${r.stats.tools} kaynak sorgusu` : null, r.stats?.durationMs ? `${Math.round(r.stats.durationMs / 1000)} sn` : null].filter(Boolean).join(' · ')),
    msg),
  [h('button', { class: 'btn link sm', type: 'button', onclick: closeSheet }, r.pending ? 'Sonra' : 'Vazgeç'),
    r.pending ? h('button', { class: 'btn plain sm', type: 'button', title: 'Bu öneriyi rehbere ekleme; bir sonraki denetim buradan devam eder', onclick: async () => {
      await api(`/api/guides/${g.key}/${g.id}/sync/pending`, { method: 'DELETE' }).catch(() => {});
      g.pending = null; closeSheet(); openIssue(g.key, g.id);
    } }, 'Ekleme') : null,
    apply]);
}

// ---- Rehbere sor: rehberin yanında açılan soru-yanıt paneli ----
const ASK_OPEN = 'qahere.askOpen';
const ASK_TAB = 'qahere.askTab';
const ASK_SUGGEST = ['Teste başlamadan neyi hazırlamam gerekiyor?', 'Hangi maddeler henüz bitmedi?', 'Kaynaklar arasındaki çelişkileri kısaca özetle.'];

/** Yanıttaki sade biçimi (paragraf, "- " madde, **kalın**, https bağlantı) güvenli DOM'a çevirir. */
function richText(text) {
  const frag = document.createDocumentFragment();
  const inline = (line) => line.split(/(\*\*[^*]+\*\*|https:\/\/[^\s)<>]+)/g).filter(Boolean).map((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return h('b', {}, part.slice(2, -2));
    if (/^https:\/\//.test(part)) return h('a', { href: part, target: '_blank', rel: 'noopener' }, part.replace(/^https:\/\//, '').slice(0, 60));
    return part;
  });
  let list = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { if (!list) { list = h('ul'); frag.append(list); } list.append(h('li', {}, ...inline(m[1]))); continue; }
    list = null;
    frag.append(h('p', {}, ...inline(line.replace(/^#+\s*/, ''))));
  }
  return frag;
}

/**
 * Rehberin yanındaki panel: iki sekme. "Rehbere sor" soru-yanıt; "Bugbot" karşılaşılan hatayı konuşup kayıt taslağı çıkarır,
 * taslak mevcut önizle-onayla penceresine gider (Jira'ya yalnızca qaHere, kullanıcının onayıyla yazar).
 */
function askPanel(g, { frame }) {
  const api_ = { el: null, onChange: null, isOpen: () => !el.hidden, tab: () => tab, open: (t) => open(t), close: () => close() };
  let tab = store.get(ASK_TAB) === 'bugbot' ? 'bugbot' : 'ask';
  const views = { ask: chatView(g, 'ask', { frame }), bugbot: chatView(g, 'bugbot', { frame }) };
  const tabs = h('div', { class: 'ask-tabs', role: 'tablist' });
  const paintTabs = () => {
    tabs.replaceChildren(...[['ask', 'Rehbere sor'], ['bugbot', 'Bugbot']].map(([k, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), class: tab === k ? 'on' : '', onclick: () => { tab = k; store.set(ASK_TAB, k); paint(); } }, label)));
  };
  const body = h('div', { class: 'ask-body' });
  const paint = () => { paintTabs(); body.replaceChildren(views[tab].el); views[tab].shown(); api_.onChange?.(); };
  const el = h('aside', { class: 'ask', 'aria-label': 'Rehber paneli', hidden: store.get(ASK_OPEN) !== '1' },
    h('div', { class: 'ask-head' }, tabs,
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Kapat', title: 'Kapat', onclick: () => close() }, '×')),
    body);
  function open(t) { if (t) { tab = t; store.set(ASK_TAB, t); } el.hidden = false; store.set(ASK_OPEN, '1'); paint(); }
  function close() { el.hidden = true; store.set(ASK_OPEN, ''); Object.values(views).forEach((v) => v.abort()); api_.onChange?.(); }
  api_.el = el;
  paint();
  return api_;
}

const BOT_PL = [['ios', 'iOS'], ['android', 'Android'], ['both', 'İkisi']];

/** Tek bir sohbet: "ask" (rehbere sor) ya da "bugbot". */
function chatView(g, mode, { frame }) {
  const bot = mode === 'bugbot';
  const field = bot ? 'bugbot' : 'chat';
  const thread = h('div', { class: 'ask-thread', 'aria-live': 'polite' });
  const input = h('textarea', { rows: '2', placeholder: bot ? 'Ne oldu? Hangi ekranda, ne yaptın, ne gördün?' : 'Rehberle ilgili sorunu yaz', 'aria-label': bot ? 'Hatayı anlat' : 'Soru' });
  const pl = { v: (state.config.profile?.platforms?.length === 1 ? state.config.profile.platforms[0] : 'both') };
  const plSeg = h('div', { class: 'seg mini' });
  const paintPl = () => plSeg.replaceChildren(...BOT_PL.map(([k, n]) => h('button', { type: 'button', class: pl.v === k ? 'active' : '', onclick: () => { pl.v = k; paintPl(); } }, n)));
  paintPl();
  // Bugbot'a eklenen ekran görüntüleri Claude'a gitmez; kayıt hazırlanırken önizleme penceresine aktarılır.
  const images = [];
  const shots = h('div', { class: 'ask-shots' });
  const paintShots = () => shots.replaceChildren(...images.map((im, i) => h('figure', {},
    h('img', { src: `data:${im.type};base64,${im.data}`, alt: `Ekran görüntüsü ${i + 1}` }),
    h('button', { type: 'button', 'aria-label': 'Görseli kaldır', onclick: () => { images.splice(i, 1); paintShots(); } }, '×'))));
  const addFiles = async (files) => {
    for (const file of files) if (/^image\/(png|jpeg|gif|webp)$/.test(file.type) && images.length < 10) images.push(await readFile(file));
    paintShots();
  };
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, hidden: true, onchange: () => addFiles([...fileInput.files]) });
  if (bot) input.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); addFiles(files); } });

  const sendBtn = h('button', { class: 'btn sm', type: 'submit' }, bot ? 'Gönder' : 'Sor');
  const clearBtn = h('button', { class: 'btn plain sm', type: 'button', title: 'Bu konuşmayı sil', onclick: async () => {
    if (clearBtn.dataset.armed !== '1') { clearBtn.dataset.armed = '1'; clearBtn.textContent = 'Silmeyi onayla'; setTimeout(() => { clearBtn.dataset.armed = ''; clearBtn.textContent = 'Temizle'; }, 4000); return; }
    await api(`/api/guides/${g.key}/${g.id}/${bot ? 'bugbot' : 'chat'}`, { method: 'DELETE' }).catch(() => {});
    g[field] = []; clearBtn.dataset.armed = ''; clearBtn.textContent = 'Temizle'; paint();
  } }, 'Temizle');
  let busy = null;

  const openDraft = (entry) => {
    const d = entry.draft || {};
    openBugSheet({
      g, frame,
      c: d.item ? d.item - 1 : null,
      platform: d.platform || entry.platform,
      item: d.expected || '',
      section: d.item ? `Bugbot · ${d.item}. madde` : 'Bugbot',
      preset: { happened: d.happened || entry.q, steps: (d.steps || []).join('\n'), images: [...images], notifyOption: true },
      onFiled: async (r, { notify, summary }) => {
        entry.filed = { key: r.key, url: r.url, slack: notify ? 'sending' : undefined };
        images.length = 0; paintShots(); paint();
        await send(`/api/guides/${g.key}/${g.id}/bugbot/filed`, 'POST', { at: entry.at, bug: { key: r.key, url: r.url }, notify, summary }).catch(() => {});
        // Slack bildirimi arka planda gider (birkaç saniye); sonucu kaydı yeniden okuyarak gösterilir.
        if (notify) for (const wait of [12_000, 25_000, 45_000]) {
          await new Promise((ok) => setTimeout(ok, wait));
          const fresh = (await api(`/api/guides?key=${g.key}`).catch(() => ({ guides: [] }))).guides.find((x) => x.id === g.id);
          const e = fresh?.bugbot?.find((x) => x.at === entry.at);
          if (e?.filed) { entry.filed = e.filed; paint(); }
          if (e?.filed?.slack !== 'sending') break;
        }
      },
    });
  };
  const draftCard = (entry) => {
    const d = entry.draft;
    if (!d || (!d.happened && !d.expected)) return null;
    if (entry.filed) {
      const sl = entry.filed.slack;
      const slackNote = !sl ? null : sl === 'sending' ? 'Slack\'ten sana iletiliyor…' : sl === 'sent' ? 'Slack\'ten sana iletildi.' : `Slack'e iletilemedi: ${String(sl).replace(/^error:\s*/, '')}`;
      return h('div', { class: 'bb-card filed' }, 'Kayıt açıldı: ', h('a', { href: entry.filed.url, target: '_blank', rel: 'noopener' }, entry.filed.key),
        slackNote ? h('p', { class: `hint${/^error/.test(sl) ? ' bad' : ''}` }, slackNote) : null);
    }
    return h('div', { class: `bb-card${d.ready ? '' : ' wait'}` },
      h('div', { class: 'bb-row' }, h('b', {}, d.topic || 'Kayıt taslağı'), h('span', { class: 'bb-pl' }, BOT_PL.find(([k]) => k === d.platform)?.[1] || '')),
      d.happened ? h('p', {}, h('span', {}, 'Gerçekleşen: '), d.happened) : null,
      d.expected ? h('p', {}, h('span', {}, 'Beklenen: '), d.expected) : null,
      d.steps?.length ? h('ol', {}, ...d.steps.map((s) => h('li', {}, s))) : null,
      d.similar?.length ? h('p', { class: 'bb-sim' }, 'Benzer açık kayıt: ', ...d.similar.flatMap((k, i) => [i ? ', ' : '',
        state.config.jiraBaseUrl ? h('a', { href: `${state.config.jiraBaseUrl}/browse/${k}`, target: '_blank', rel: 'noopener' }, k) : k]), ' — kopya olmadığından emin ol.') : null,
      h('div', { class: 'bb-row' },
        h('span', { class: 'hint' }, d.ready ? (d.item ? `${d.item}. kontrol maddesine bağlanır` : 'Hazır') : 'Eksik bilgi var; yanıtlayınca güncellenir'),
        h('button', { class: `btn sm${d.ready ? '' : ' plain'}`, type: 'button', onclick: () => openDraft(entry) }, 'Kaydı hazırla')));
  };
  const exchange = (c, last) => h('div', { class: 'ask-ex' },
    h('div', { class: 'ask-q' }, c.q),
    h('div', { class: 'ask-a' }, richText(c.a)),
    bot && last ? draftCard(c) : (bot && c.filed ? draftCard(c) : null),
    h('div', { class: 'ask-meta' }, [fmtDate(c.at), c.stats ? (c.stats.tools ? `${c.stats.tools} kaynak sorgusu` : 'rehberden') : null, c.stats?.durationMs ? `${Math.max(1, Math.round(c.stats.durationMs / 1000))} sn` : null].filter(Boolean).join(' · ')));

  function paint() {
    const chat = Array.isArray(g[field]) ? g[field] : [];
    clearBtn.hidden = !chat.length;
    if (!chat.length && !busy) {
      thread.replaceChildren(bot
        ? h('div', { class: 'ask-empty' },
          h('p', {}, 'Test ederken karşılaştığın hatayı anlat. Bugbot rehberdeki beklenen davranışla karşılaştırır, Jira\'da benzer açık kayıt var mı bakar, eksik bilgiyi sorar ve kayıt taslağını çıkarır; "Kaydı hazırla" ile önizler, onaylarsan qaHere Jira\'da açar.'),
          h('p', {}, 'Ekran görüntüsünü buraya yapıştırabilirsin (⌘V); Claude\'a gönderilmez, kayda eklenir.'),
          h('p', { class: 'ask-note' }, 'Her mesaj Claude kullanım hakkından düşer.'))
        : h('div', { class: 'ask-empty' },
          h('p', {}, 'Rehberde yazanları ve işaretlediğin kontrolleri bilerek yanıtlar; rehberde olmayan ya da güncel bir şey sorarsan Jira, Slack, Notion, Confluence ve Figma\'da yalnızca okuyarak arar.'),
          ...ASK_SUGGEST.map((q) => h('button', { class: 'ask-sug', type: 'button', onclick: () => { input.value = q; submit(); } }, q)),
          h('p', { class: 'ask-note' }, 'Her soru Claude kullanım hakkından düşer.')));
      return;
    }
    thread.replaceChildren(...chat.map((c, i) => exchange(c, i === chat.length - 1)));
  }

  async function submit(e) {
    e?.preventDefault();
    const question = input.value.trim();
    if (!question || busy) return;
    const ctrl = new AbortController();
    const live = h('div', { class: 'ask-a live' });
    const step = h('div', { class: 'ask-meta' }, bot ? 'Rehberle karşılaştırılıyor…' : 'Rehbere bakılıyor…');
    busy = ctrl;
    if (!(g[field] || []).length) thread.replaceChildren();
    thread.append(h('div', { class: 'ask-ex' }, h('div', { class: 'ask-q' }, question), live, step));
    thread.scrollTop = thread.scrollHeight;
    input.value = ''; input.disabled = true;
    sendBtn.textContent = 'Durdur'; sendBtn.type = 'button'; sendBtn.onclick = () => ctrl.abort();
    let text = '';
    try {
      const res = await fetch(`/api/guides/${g.key}/${g.id}/${bot ? 'bugbot' : 'ask'}`, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bot ? { question, platform: pl.v } : { question }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Sunucu ${res.status} döndü.`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'delta') { text += ev.text; live.replaceChildren(richText(text)); }
          else if (ev.type === 'reset') { text = ''; live.replaceChildren(); }
          else if (ev.type === 'step') step.textContent = ev.message;
          else if (ev.type === 'error') throw new Error(ev.message);
          else if (ev.type === 'done') g[field] = [...(g[field] || []), ev.entry];
        }
        thread.scrollTop = thread.scrollHeight;
      }
      busy = null;
      paint();
    } catch (err) {
      busy = null;
      step.textContent = ctrl.signal.aborted ? 'Durduruldu.' : err.message;
      step.classList.add('bad');
      if (!input.value) input.value = question;
    } finally {
      busy = null;
      input.disabled = false;
      sendBtn.textContent = bot ? 'Gönder' : 'Sor'; sendBtn.type = 'submit'; sendBtn.onclick = null;
      thread.scrollTop = thread.scrollHeight;
      input.focus();
    }
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e); });
  const row = bot
    ? h('div', { class: 'ask-row' }, plSeg, h('div', { class: 'ask-row-r' },
      h('button', { class: 'btn plain sm', type: 'button', title: 'Ekran görüntüsü ekle', onclick: () => fileInput.click() }, 'Görsel'), sendBtn))
    : h('div', { class: 'ask-row' }, h('span', { class: 'ask-deep' }, 'Gerekirse Jira, Slack, Notion, Confluence ve Figma\'ya da bakar'), sendBtn);
  const el = h('div', { class: 'ask-view' },
    h('div', { class: 'ask-sub' }, h('span', {}, bot ? 'Karşılaştığın hatayı konuş, kaydı birlikte hazırlayın.' : 'Rehber hakkında soru sor.'), clearBtn),
    thread,
    h('form', { class: 'ask-form', onsubmit: submit }, bot ? shots : null, input, fileInput, row));
  paint();
  return { el, abort: () => busy?.abort(), shown: () => { paint(); thread.scrollTop = thread.scrollHeight; setTimeout(() => input.focus(), 30); } };
}

// Rehber içi düzen ve işaretleme: public/viewer.{js,css}. Bir kez alınır, her açılışta rehbere satır içi eklenir.
let viewerAssetsP;
const viewerAssets = () => (viewerAssetsP ||= Promise.all(['/viewer.js', '/viewer.css'].map((u) => fetch(u).then((r) => {
  if (!r.ok) throw new Error('Görüntüleyici dosyaları yüklenemedi.');
  return r.text();
})))).catch((e) => { viewerAssetsP = null; throw e; });

function withViewer(html, [js, css]) {
  // CSP'siz (beklenmeyen biçimdeki) bir rehbere betik eklenmez; düz hâliyle gösterilir.
  if (!/<meta http-equiv="Content-Security-Policy"/i.test(html)) return html;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  return html
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace(/<\/head>/i, () => `<style>${css}</style></head>`)
    .replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `<script nonce="${nonce}">${js}</script></body>`);
}
window.addEventListener('message', (e) => state.onChecks?.(e));

/** Reddedilen araçları kaynağa çevirir; kapalı kaynak varsa tek tıkla açtırır. */
const DENIAL_SOURCES = [[/Claude_Docs/i, 'docs'], [/slack/i, 'slack'], [/notion/i, 'notion'], [/confluence/i, 'confluence'], [/figma/i, 'figma'], [/proxyman/i, 'proxyman']];
function denialNotes(g) {
  const denied = [...new Set(g.stats?.denials || [])];
  if (!denied.length) return [];
  const keys = new Set();
  const other = [];
  for (const t of denied) { const m = DENIAL_SOURCES.find(([re]) => re.test(t)); if (m) keys.add(m[1]); else other.push(t.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')); }
  const notes = [...keys].map((k) => {
    const src = SOURCES.find((s) => s.key === k);
    const box = h('div', { class: 'callout', style: 'margin:0 0 14px;box-shadow:none;background:color-mix(in srgb,var(--warn) 10%,transparent)' });
    const paint = () => {
      if (state.config.sources[k]) return box.replaceChildren(h('div', {}, h('b', {}, `${src.name} artık açık`), h('span', {}, 'Bu rehber o kaynak kapalıyken üretildi. İçeriğe girmesi için "Yeniden oluştur"a bas.')));
      box.replaceChildren(
        h('div', {}, h('b', {}, `${src.name} kapalı olduğu için bir kaynak okunamadı`), h('span', {}, `İşte ${src.name} bağlantısı geçiyor ama bu kaynak Ayarlar'da kapalı. Açarsan sonraki rehberlerde okunur.`)),
        h('button', { class: 'btn sm', type: 'button', onclick: async (e) => {
          e.target.disabled = true;
          try { applyConfig(await send('/api/settings', 'PUT', { sources: { [k]: true } })); paint(); }
          catch (err) { e.target.disabled = false; e.target.textContent = err.message; }
        } }, 'Kaynağı aç'));
    };
    paint();
    return box;
  });
  if (other.length) notes.push(h('div', { class: 'msg warn', style: 'margin:0 0 14px' }, `İzin listesinde olmayan araçlar denendi ve atlandı: ${other.join(', ')}`));
  return notes;
}

// ---- Üretim -----------------------------------------------------------------------------

async function startJob(key) {
  const btn = $('#genBtn');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Kaynaklar kontrol ediliyor…';
  // Üretimden önce: işte kapalı bir kaynağa bağlantı varsa şimdi sor; sonradan "yeniden oluştur" gerekmesin.
  const pre = await send('/api/guides/preflight', 'POST', { key }).catch(() => null);
  btn.textContent = label;
  if (pre?.missing) {
    const go = await askMissingSources(pre);
    if (go === null) { btn.disabled = false; return; }
  }
  await runJob(key);
}

/** Kapalı kaynakları sorar. true: açıldı, false: kapalı kalsın, null: vazgeçildi. */
function askMissingSources(pre) {
  return new Promise((resolve) => {
    const off = [...pre.sources, ...pre.connectors].filter((x) => !x.enabled);
    const name = (x) => (x.name || '').replace(/^claude\.ai\s+/i, '');
    const msg = h('div', {});
    let decided = false;
    const done = (v) => { if (decided) return; decided = true; closeSheet(); resolve(v); };
    const openBtn = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      openBtn.disabled = true; skipBtn.disabled = true; openBtn.textContent = 'Açılıyor…'; msg.replaceChildren();
      try {
        const sources = { ...state.config.sources };
        for (const x of pre.sources) if (!x.enabled) sources[x.key] = true;
        const connectors = JSON.parse(JSON.stringify(state.config.connectors || {}));
        for (const x of pre.connectors.filter((c) => !c.enabled)) {
          openBtn.textContent = `${name(x)} araçları listeleniyor…`;
          try {
            const r = await send('/api/connectors/inspect', 'POST', { name: x.name });
            if (r.read.length) connectors[x.name] = { enabled: true, tools: r.read, skipped: r.skipped };
          } catch (e) { msg.append(h('div', { class: 'msg warn' }, `${name(x)} açılamadı: ${e.message}`)); }
        }
        applyConfig(await send('/api/settings', 'PUT', { sources, connectors }));
        done(true);
      } catch (e) { msg.replaceChildren(h('div', { class: 'msg bad' }, e.message)); openBtn.disabled = false; skipBtn.disabled = false; openBtn.textContent = 'Aç ve başlat'; }
    } }, 'Aç ve başlat');
    const skipBtn = h('button', { class: 'btn plain sm', type: 'button', onclick: () => done(false) }, 'Kapalı kalsın, başlat');
    openSheet('Bu işte kapalı kaynaklara bağlantı var', h('div', {},
      h('p', {}, 'Rehber üretimi birkaç dakika sürer ve kullanım hakkından düşer. Bu kaynaklar kapalı kalırsa içerikleri rehbere giremez; sonradan eklemek için yeniden üretmen gerekir.'),
      h('ul', {}, ...off.map((x) => h('li', {}, h('b', {}, name(x)), ` · ${x.count} bağlantı`))),
      h('p', { class: 'hint' }, 'Açınca yalnızca okuma araçları açılır; ayarı sonradan Ayarlar → Kaynaklar\'dan değiştirebilirsin. Bağlantı claude.ai\'de girişli değilse yine okunamaz.'),
      msg),
    [h('button', { class: 'btn link sm', type: 'button', onclick: () => done(null) }, 'Vazgeç'), skipBtn, openBtn]);
    $('#sheet').addEventListener('close', () => done(null), { once: true });
  });
}

async function runJob(key) {
  const btn = $('#genBtn');
  btn.disabled = true;
  try {
    const { jobId } = await send('/api/guides', 'POST', { key, notes: $('#notes')?.value || '' });
    runningKey = key; paintBusy();
    attachJob(jobId, key);
  } catch (e) {
    btn.disabled = false;
    $('#progress').replaceChildren(h('div', { class: 'msg bad' }, e.message));
  }
}

function attachJob(jobId, key) {
  state.es?.close();
  const box = $('#progress');
  const btn = $('#genBtn');
  if (btn) btn.disabled = true;
  const card = $('#genCard');
  if (card) card.hidden = false;
  const log = h('ul', { class: 'log' });
  const timer = h('span', { class: 'sub' }, '0:00');
  let started = Date.now();
  let lastStep = Date.now();
  let quietShown = false;
  let steps = 0; // Claude'dan gelen gerçek adım sayısı
  box.replaceChildren(h('div', { class: 'progress' },
    h('div', { class: 'head' }, h('span', { class: 'spinner' }), h('b', {}, 'Rehber hazırlanıyor'), timer,
      h('button', { class: 'btn plain sm', type: 'button', style: 'margin-left:auto', onclick: () => api(`/api/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {}) }, 'İptal')),
    log));
  const add = (t, cls) => { log.append(h('li', cls ? { class: cls } : {}, t)); log.scrollTop = log.scrollHeight; lastStep = Date.now(); };
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    // Claude bazen uzun süre sessiz kalır (açılışta bağlantılar yüklenirken ya da yazarken); kullanıcı takıldı sanmasın.
    // Ne yaptığını bilmediğimiz için "okuma bitti" demiyoruz; her sessiz aralıkta bir kez not düşülür.
    if (!quietShown && Date.now() - lastStep > 30_000) {
      quietShown = true;
      add(steps <= 1 ? 'Claude Code açılıyor ve bağlantılar yükleniyor; ilk adım biraz sürebilir.' : 'Claude okuduklarını değerlendiriyor ya da rehberi yazıyor; bu adım birkaç dakika sürebilir.', 'quiet');
    }
  }, 1000);
  const es = new EventSource(`/api/jobs/${jobId}/events`);
  const finish = () => { clearInterval(tick); es.close(); if ($('#genBtn')) $('#genBtn').disabled = false; pollActive(); };
  state.es = es;
  es.onmessage = async (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === 'start') started = ev.startedAt;
    if (ev.type === 'step') { steps += 1; quietShown = false; add(ev.message); }
    if (ev.type === 'init') {
      const on = SOURCES.filter((s) => state.config.sources[s.key]).map((s) => (s.key === 'confluence' ? 'atlassian' : s.key === 'docs' ? 'claude docs' : s.key));
      const bad = (ev.servers || []).filter((s) => on.some((k) => s.toLowerCase().includes(k)) && !/connected/i.test(s));
      if (bad.length) add(`Uyarı: bağlı olmayan kaynak → ${bad.join(', ')}. Sağ üstte Durum → Bağlantıları denetle ile nasıl bağlanacağını gör.`);
    }
    if (ev.type === 'done') {
      finish();
      if (state.current !== key) return;
      if (state.tab === 'archive') loadList();
      openIssue(key, ev.guide.id); // rehber düzenine geç
    }
    if (ev.type === 'error') { finish(); if (state.current === key) box.replaceChildren(h('div', { class: 'msg bad' }, ev.message)); }
  };
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) finish(); };
}

// ---- Hata kaydı ---------------------------------------------------------------------------

const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({ name: file.name || 'ekran.png', type: file.type, data: String(r.result).split(',')[1] || '' });
  r.onerror = () => reject(new Error('Dosya okunamadı.'));
  r.readAsDataURL(file);
});

function openBugSheet({ g, frame, c, platform, item, section, preset = {}, onFiled }) {
  const f = { platform: ['ios', 'android'].includes(platform) ? platform : 'both', happened: preset.happened || '', expected: item, steps: preset.steps || '', images: preset.images || [], flows: [] };
  const bugCfg = state.config.bug || {};
  let onPaste = null;
  const done = () => { if (onPaste) document.removeEventListener('paste', onPaste); onPaste = null; };
  $('#sheet').addEventListener('close', done, { once: true });

  // 1. adım: bilgi toplama
  const step1 = () => {
    const seg = h('div', { class: 'seg' });
    const paintSeg = () => seg.replaceChildren(...BUG_PL.map((p) => h('button', { type: 'button', class: f.platform === p.key ? 'active' : '', onclick: () => { f.platform = p.key; paintSeg(); paintShots(); } }, p.name)));
    paintSeg();
    const ta = (key, attrs) => { const t = h('textarea', { class: 'input', ...attrs, oninput: () => { f[key] = t.value; } }); t.value = f[key]; return t; };
    const happened = ta('happened', { rows: '3', placeholder: 'Örn. Devam\'a basınca hiçbir mesaj çıkmıyor, buton aktif kalıyor', required: true });
    const shots = h('div', { class: 'shots' });
    const shotErr = h('div', {});
    const addFiles = async (files) => {
      for (const file of files) {
        if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { shotErr.replaceChildren(h('div', { class: 'msg bad' }, 'Yalnızca PNG, JPEG, GIF ya da WebP eklenebilir.')); continue; }
        if (f.images.length >= 10) break;
        f.images.push(await readFile(file));
      }
      paintShots();
    };
    const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, hidden: true, onchange: () => addFiles([...fileInput.files]) });
    const simBtn = (pl, label) => {
      const btn = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
        btn.disabled = true; shotErr.replaceChildren();
        try { f.images.push(await send('/api/screenshot', 'POST', { platform: pl })); paintShots(); }
        catch (e) { shotErr.replaceChildren(h('div', { class: 'msg bad' }, e.message)); }
        btn.disabled = false;
      } }, label);
      return btn;
    };
    function paintShots() {
      const sims = f.platform === 'ios' ? [simBtn('ios', 'iOS simülatöründen al')] : f.platform === 'android' ? [simBtn('android', 'Android emülatöründen al')]
        : [simBtn('ios', 'iOS simülatöründen al'), simBtn('android', 'Android emülatöründen al')];
      shots.replaceChildren(
        ...f.images.map((im, i) => h('figure', { class: 'shot' },
          h('img', { src: `data:${im.type};base64,${im.data}`, alt: `Ekran görüntüsü ${i + 1}` }),
          h('button', { type: 'button', class: 'x', 'aria-label': 'Görseli kaldır', onclick: () => { f.images.splice(i, 1); paintShots(); } }, '×'))),
        h('div', { class: 'drop', ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave: (e) => e.currentTarget.classList.remove('over'),
          ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); addFiles([...e.dataTransfer.files]); } },
          h('span', {}, 'Görseli buraya sürükle ya da yapıştır (⌘V)'),
          h('div', { class: 'drop-acts' }, h('button', { class: 'btn plain sm', type: 'button', onclick: () => fileInput.click() }, 'Dosya seç'), ...sims)));
    }
    paintShots();
    done();
    onPaste = (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); addFiles(files); } };
    document.addEventListener('paste', onPaste);

    // Proxyman'den ilgili istek (isteğe bağlı): kimlik bilgileri gizlenip metin olarak eklenir.
    const flowsBox = h('div', { class: 'f' });
    const paintFlows = (open) => {
      const chips = f.flows.map((fl, i) => h('span', { class: 'flowchip' }, `${fl.method} ${fl.url.replace(/^https?:\/\//, '').slice(0, 70)}`,
        h('button', { type: 'button', 'aria-label': 'İsteği kaldır', onclick: () => { f.flows.splice(i, 1); paintFlows(open); } }, '×')));
      flowsBox.replaceChildren('Proxyman istekleri (isteğe bağlı)', ...chips,
        open ? flowPicker({ q: guessPath(item), onPick: (fl) => { if (!f.flows.some((x) => x.id === fl.id) && f.flows.length < 5) f.flows.push(fl); paintFlows(true); } })
          : h('div', {}, h('button', { class: 'btn plain sm', type: 'button', onclick: () => paintFlows(true) }, 'Proxyman\'den istek ekle')));
    };
    paintFlows(false);

    const err = h('div', {});
    const next = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      if (!f.happened.trim()) { err.replaceChildren(h('div', { class: 'msg bad' }, '"Ne oldu?" alanını doldur.')); happened.focus(); return; }
      next.disabled = true; next.textContent = 'Taslak hazırlanıyor…'; err.replaceChildren();
      try {
        const dr = await send('/api/bugs/draft', 'POST', { storyKey: g.key, storyTitle: g.title, item: section ? `${section}: ${item}` : item, platform: f.platform, happened: f.happened, expected: f.expected, steps: f.steps });
        step2(dr);
      } catch (e) { err.replaceChildren(h('div', { class: 'msg bad' }, e.message)); next.disabled = false; next.textContent = 'Taslağı hazırla'; }
    } }, 'Taslağı hazırla');
    openSheet('Hata kaydı', h('div', { class: 'bugform' },
      h('p', { class: 'bug-item' }, h('span', {}, section || 'Test maddesi'), item),
      h('div', { class: 'row stack plain' }, h('span', { class: 'hint' }, 'Platform'), seg),
      h('label', { class: 'f' }, 'Ne oldu?', happened),
      h('label', { class: 'f' }, 'Ne bekleniyordu?', ta('expected', { rows: '2' })),
      h('label', { class: 'f' }, 'Adımlar (isteğe bağlı, her satıra bir adım)', ta('steps', { rows: '3', placeholder: 'Şifremi unuttum ekranına gir\nE-posta alanına "abc" yaz\nDevam\'a bas' })),
      h('div', { class: 'f' }, 'Ekran görüntüleri', shots, fileInput, shotErr),
      flowsBox,
      h('p', { class: 'hint' }, 'Taslağı Claude araçsız, kısa bir çağrıyla yazar (birkaç saniye). Kayıt, önizlemeyi onaylamadan açılmaz.'),
      err,
    ), [h('button', { class: 'btn link sm', type: 'button', onclick: closeSheet }, 'Vazgeç'), next]);
    setTimeout(() => happened.focus(), 50);
  };

  // 2. adım: önizleme ve onay
  const step2 = (dr) => {
    const title = h('input', { class: 'input', value: dr.summary, maxlength: '250' });
    const desc = h('textarea', { class: 'input', rows: '10' });
    desc.value = dr.description;
    const pl = dr.platform;
    const project = bugCfg.project || g.key.split('-')[0];
    const assignee = bugCfg.assignees?.[pl]?.name;
    const sprint = bugCfg.sprintBoard && bugCfg.sprintFor?.includes(pl);
    const facts = h('dl', { class: 'facts' },
      h('dt', {}, 'Proje'), h('dd', {}, `${project} · ${bugCfg.issueType || 'Bug'}`),
      h('dt', {}, 'Atanan'), h('dd', {}, assignee || 'Atanmayacak'),
      h('dt', {}, 'Bağ'), h('dd', {}, `${g.key} (${bugCfg.linkType || 'Relates'})`),
      h('dt', {}, 'Sprint'), h('dd', {}, sprint ? 'Aktif sprinte alınacak' : 'Backlog'),
      h('dt', {}, 'Görsel'), h('dd', {}, f.images.length ? `${f.images.length} ekran görüntüsü` : 'Yok'),
      h('dt', {}, 'İstek'), h('dd', {}, f.flows.length ? `${f.flows.length} Proxyman isteği (kimlik bilgileri gizlenir)` : 'Yok'));
    // Bugbot'tan gelen kayıtta: açılınca qaHere kullanıcısına Slack'ten (kendine DM) haber verilir. Kullanıcı kapatabilir.
    const slackOn = Boolean(preset.notifyOption && state.config.sources?.slack);
    const notifyBox = h('input', { type: 'checkbox', checked: slackOn });
    const notifyRow = slackOn ? h('label', { class: 'only-row' }, notifyBox, ' Kayıt açılınca Slack\'ten bana bildir (kendine mesaj; Claude\'un Slack bağlantısıyla)') : null;
    const err = h('div', {});
    const back = h('button', { class: 'btn link sm', type: 'button', onclick: step1 }, 'Geri');
    const copy = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(`${title.value}\n\n${desc.value}`); copy.textContent = 'Kopyalandı'; } catch { copy.textContent = 'Kopyalanamadı'; }
    } }, 'Metni kopyala');
    const go = h('button', { class: 'btn sm', type: 'button', disabled: !state.config.jiraConfigured, onclick: async () => {
      go.disabled = true; back.disabled = true; go.textContent = 'Açılıyor…'; err.replaceChildren();
      try {
        const r = await send('/api/bugs', 'POST', { storyKey: g.key, guideId: g.id, c, platform: pl, summary: title.value, description: desc.value, images: f.images, flows: f.flows.map((x) => x.id) });
        if (c != null) frame.contentWindow?.postMessage({ qa: 'bug', c, key: r.key, url: r.url }, '*');
        onFiled?.(r, { notify: Boolean(notifyRow && notifyBox.checked), summary: title.value });
        done();
        openSheet(`${r.key} açıldı`, h('div', { class: 'bugform' },
          h('div', { class: 'msg ok' }, h('a', { href: r.url, target: '_blank', rel: 'noopener' }, `${r.key} · ${title.value}`)),
          r.sprint ? h('p', { class: 'hint' }, `Sprint: ${r.sprint}`) : null,
          ...(r.warnings || []).map((w) => h('div', { class: 'msg warn' }, w)),
          h('p', { class: 'hint' }, 'Kayıt maddenin yanında da görünür ve PDF\'e yansır.'),
        ), [h('a', { class: 'btn plain sm', href: r.url, target: '_blank', rel: 'noopener' }, 'Jira\'da gör'), h('button', { class: 'btn sm', type: 'button', onclick: closeSheet }, 'Bitti')]);
      } catch (e) {
        err.replaceChildren(h('div', { class: 'msg bad' }, e.message));
        go.disabled = false; back.disabled = false; go.textContent = 'Jira\'da aç';
      }
    } }, 'Jira\'da aç');
    openSheet('Hata kaydı önizlemesi', h('div', { class: 'bugform' },
      dr.viaClaude ? null : h('div', { class: 'msg warn' }, 'Claude\'a ulaşılamadı; taslak yazdıklarından düz olarak hazırlandı.'),
      state.config.jiraConfigured ? null : h('div', { class: 'msg warn' }, 'Jira token\'ı girilmediği için kayıt açılamaz. Metni kopyalayıp elle açabilirsin.'),
      h('label', { class: 'f' }, 'Başlık', title),
      h('label', { class: 'f' }, 'Açıklama', desc),
      f.images.length ? h('div', { class: 'shots' }, ...f.images.map((im, i) => h('figure', { class: 'shot' }, h('img', { src: `data:${im.type};base64,${im.data}`, alt: `Ekran görüntüsü ${i + 1}` })))) : null,
      facts,
      notifyRow,
      h('p', { class: 'hint' }, 'Proje, atanan ve sprint kuralı Ayarlar → Hata kaydı bölümünden gelir.'),
      err,
    ), [back, copy, go]);
    setTimeout(() => title.focus(), 50);
  };

  step1();
}

// ---- Proxyman ------------------------------------------------------------------------------

/** Maddenin metnindeki uç nokta yolunu tahmin eder ("/api/v1/discount-wheel/participate" gibi). */
function guessPath(text) {
  const paths = String(text || '').match(/\/[A-Za-z0-9_\-.]+(?:\/[A-Za-z0-9_\-.{}]+)+/g) || [];
  const best = paths.sort((a, b) => b.length - a.length)[0] || '';
  return best.split('/').filter((x) => x && !/[{}]/.test(x)).slice(-3).join('/');
}

/** Proxyman'de yakalanan istekleri arayıp seçtirir. onPick(flow) her seçimde çağrılır. */
function flowPicker({ q = '', onPick, pickLabel = 'Ekle' }) {
  const input = h('input', { class: 'input', placeholder: 'Adreste geçen bir parça (ör. discount-wheel)', value: q, spellcheck: 'false' });
  const list = h('div', { class: 'flows' });
  const status = h('div', { class: 'hint' });
  let t;
  const load = async () => {
    status.textContent = 'Proxyman\'e bakılıyor…';
    try {
      const r = await api(`/api/proxyman/flows?limit=60&q=${encodeURIComponent(input.value.trim())}`);
      status.textContent = r.flows.length ? '' : 'Eşleşen istek yok. Uygulamada ilgili ekranı açıp tekrar ara; HTTPS istekleri için Proxyman\'de SSL Proxying açık olmalı.';
      list.replaceChildren(...r.flows.slice(0, 40).map((f) => h('button', { type: 'button', class: 'flow', onclick: () => onPick(f) },
        h('span', { class: `fm m-${f.method.toLowerCase()}` }, f.method),
        h('span', { class: `fs ${f.status >= 400 ? 'bad' : ''}` }, f.status ?? '…'),
        h('span', { class: 'fu', title: f.url }, f.url.replace(/^https?:\/\//, '')),
        h('span', { class: 'fa' }, pickLabel))));
    } catch (e) { status.textContent = e.message; list.replaceChildren(); }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 350); });
  queueMicrotask(load);
  return h('div', { class: 'picker' }, input, status, list);
}

function mockList(g, onChange) {
  const box = h('div', { class: 'mocks' });
  const paint = () => {
    const ms = Array.isArray(g.mocks) ? g.mocks : [];
    if (!ms.length) return box.replaceChildren(h('p', { class: 'hint' }, 'Bu rehber için kurulmuş mock yok.'));
    box.replaceChildren(...ms.map((m) => {
      const err = h('span', { class: 'hint bad-text' });
      const call = async (fn) => { try { const r = await fn(); g.mocks = r.mocks; paint(); onChange?.(); } catch (e) { err.textContent = e.message; } };
      const sw = h('input', { type: 'checkbox', class: 'switch', 'aria-label': 'Mock açık', onchange: () => call(() => send(`/api/proxyman/mocks/${m.id}`, 'PUT', { key: g.key, guideId: g.id, enabled: sw.checked })) });
      sw.checked = m.enabled;
      return h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('b', {}, `${m.method || 'ANY'} ${String(m.url || '').replace(/^https?:\/\//, '') || '(yakalanan istekten)'}`),
          h('span', {}, `${m.c != null ? `Madde ${m.c + 1} · ` : ''}${m.status ? `${m.status} · ` : ''}${fmtDate(m.at)}`), err),
        sw,
        h('button', { class: 'btn danger sm', type: 'button', onclick: () => call(() => api(`/api/proxyman/mocks/${m.id}?key=${encodeURIComponent(g.key)}&guideId=${encodeURIComponent(g.id)}`, { method: 'DELETE' })) }, 'Sil'));
    }));
  };
  paint();
  return box;
}

/** Rehberdeki mock bloğu: başlıktan yöntem + yol, ilk satırdan durum kodu ("HTTP 410"), kalanı gövde. */
function parseMockBlock(title, text) {
  const m = title.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i);
  const lines = text.replace(/\r/g, '').split('\n');
  const st = lines[0].match(/^\s*HTTP(?:\/[\d.]+)?\s+(\d{3})/i);
  return {
    method: m ? m[1].toUpperCase() : 'ANY',
    path: m ? m[2].replace(/[—–-]+$/, '') : '',
    status: st ? Number(st[1]) : 200,
    body: (st ? lines.slice(1) : lines).join('\n').trim(),
    title,
  };
}

function openMockSheet({ g, c, item, onChange, preset }) {
  const f = { url: '', method: preset?.method || 'GET', status: preset?.status || 200, body: preset?.body || '', flow: null };
  const urlIn = h('input', { class: 'input', placeholder: 'https://api.ornek.com/v1/kuponlar', spellcheck: 'false', oninput: () => { f.url = urlIn.value.trim(); f.flow = null; paintSrc(); } });
  const methodSel = h('select', { class: 'input', onchange: () => { f.method = methodSel.value; } }, ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'].map((m) => h('option', { value: m }, m)));
  const statusIn = h('input', { class: 'input', type: 'number', min: '100', max: '599', value: String(f.status), oninput: () => { f.status = Number(statusIn.value) || 200; } });
  const body = h('textarea', { class: 'input mono', rows: '10', spellcheck: 'false', placeholder: '{ "items": [] }', oninput: () => { f.body = body.value; } });
  body.value = f.body;
  methodSel.value = f.method;
  let sample = '';
  const srcBox = h('div', {});
  const useCaptured = h('label', { class: 'only-row' }, h('input', { type: 'checkbox' }), ' Yakalanan yanıtı olduğu gibi kullan (gövde yazmadan)');
  const paintSrc = () => {
    useCaptured.hidden = !f.flow;
    srcBox.replaceChildren(...(f.flow ? [h('div', { class: 'msg ok' }, `Seçilen istek: ${f.flow.method} ${f.flow.url.replace(/^https?:\/\//, '')}${f.flow.status ? ` → ${f.flow.status}` : ''}`)] : []));
  };
  const picker = flowPicker({ q: preset?.path || guessPath(item), pickLabel: 'Seç', onPick: async (fl) => {
    f.flow = fl; f.url = fl.url.split('?')[0]; urlIn.value = f.url; f.method = fl.method; methodSel.value = fl.method; paintSrc();
    try { sample = (await api(`/api/proxyman/flows/${encodeURIComponent(fl.id)}`)).text; } catch { sample = ''; }
  } });
  paintSrc();

  const instr = h('input', { class: 'input', placeholder: 'Ör. kupon listesi boş dönsün / tutar 0 olsun / 500 hata' });
  const err = h('div', {});
  const gen = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
    gen.disabled = true; gen.textContent = 'Üretiliyor…'; err.replaceChildren();
    try { const r = await send('/api/proxyman/mock-draft', 'POST', { instruction: instr.value, sample, item, url: f.url }); body.value = r.body; f.body = r.body; }
    catch (e) { err.replaceChildren(h('div', { class: 'msg bad' }, e.message)); }
    gen.disabled = false; gen.textContent = 'Claude üretsin';
  } }, 'Claude üretsin');

  const listBox = mockList(g, onChange);
  const create = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    err.replaceChildren();
    const fromFlow = f.flow && useCaptured.querySelector('input').checked;
    if (!fromFlow) {
      if (!/^https?:\/\//.test(f.url)) return err.replaceChildren(h('div', { class: 'msg bad' }, 'Adres https:// ile başlamalı. Yukarıdan bir istek seç ya da adresi yaz.'));
      if (body.value.trim()) { try { JSON.parse(body.value); } catch { if (!confirm('Gövde geçerli JSON değil. Yine de düz metin olarak kurulsun mu?')) return; } }
    }
    create.disabled = true; create.textContent = 'Kuruluyor…';
    try {
      const r = await send('/api/proxyman/mocks', 'POST', fromFlow
        ? { key: g.key, guideId: g.id, c, from: 'flow', flowId: f.flow.id, url: f.url, method: f.method }
        : { key: g.key, guideId: g.id, c, from: 'body', url: f.url, method: f.method, status: f.status, body: body.value || '{}' });
      g.mocks = r.mocks;
      listBox.replaceWith(mockList(g, onChange));
      onChange?.();
      create.textContent = 'Kuruldu';
      setTimeout(closeSheet, 700);
    } catch (e) { err.replaceChildren(h('div', { class: 'msg bad' }, e.message)); create.disabled = false; create.textContent = 'Proxyman\'de kur'; }
  } }, 'Proxyman\'de kur');

  openSheet('Mock ile test', h('div', { class: 'bugform' },
    item ? h('p', { class: 'bug-item mock' }, h('span', {}, 'Test maddesi'), item) : null,
    preset ? h('p', { class: 'bug-item mock' }, h('span', {}, 'Rehberdeki mock'), preset.title || `${preset.method} ${preset.path}`) : null,
    h('div', { class: 'f' }, preset?.path ? `Hangi istek? Rehber yalnızca yolu veriyor (${preset.path}); uygulamada ekranı açıp yakalanan istekten seç ya da tam adresi yaz.` : 'Hangi istek? Uygulamada ekranı açtıysan yakalanan istekten seç.', picker),
    srcBox,
    h('div', { class: 'trio wide' }, h('label', { class: 'f' }, 'Adres', urlIn), h('label', { class: 'f' }, 'Yöntem', methodSel), h('label', { class: 'f' }, 'Durum kodu', statusIn)),
    useCaptured,
    h('div', { class: 'f' }, 'Yanıt gövdesi', h('div', { class: 'gen-row' }, instr, gen), body),
    h('p', { class: 'hint' }, 'Kural Proxyman\'de Map Local olarak açılır ve uygulama bu adrese gittiğinde bu yanıtı alır. Test bitince aşağıdan kapat ya da sil. Claude yalnızca gövdeyi yazar; kuralı qaHere kurar.'),
    err,
    h('div', { class: 'group-title' }, 'Bu rehberdeki mocklar'),
    listBox,
  ), [h('button', { class: 'btn link sm', type: 'button', onclick: closeSheet }, 'Kapat'), create]);
}

// ---- Simülatörde koşu ----------------------------------------------------------------------

function openRunSheet({ g, frame, c, platform, item, section }) {
  const PLN = platform === 'ios' ? 'iOS' : 'Android';
  const q = `key=${encodeURIComponent(g.key)}&guideId=${encodeURIComponent(g.id)}&c=${c}&platform=${platform}`;
  const ids = { key: g.key, guideId: g.id, c, platform };
  const yaml = h('textarea', { class: 'input mono', rows: '14', spellcheck: 'false', placeholder: 'appId: com.sirketin.uygulama\n---\n- launchApp\n- tapOn:\n    id: "…"\n- assertVisible: "…"' });
  let saved = '';
  const dev = h('span', { class: 'hint' }, 'Cihaza bakılıyor…');
  const buildSlot = h('div', {});
  api('/api/devices').then((x) => {
    dev.textContent = x[platform] ? `Cihaz: ${x[platform].name}` : (platform === 'ios' ? 'Açık iOS simülatörü yok.' : 'Bağlı Android cihaz yok.');
    if (platform === 'android' && x.android) buildSlot.replaceChildren(androidBuildRow(x.android.id, null, String(section).match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || [g.key]));
  }).catch(() => {});
  const note = h('div', {});
  const out = h('div', {});
  const setNote = (cls, text) => note.replaceChildren(...(text ? [h('div', { class: `msg ${cls}` }, text)] : []));

  // Nerede koşsun: bu bilgisayardaki simülatör/emülatör ya da TestMu gerçek cihazı.
  const hasTestmu = Boolean(state.config.testmu?.hasKey);
  let target = hasTestmu && store.get(`qahere.runTarget.${platform}`) === 'testmu' ? 'testmu' : 'local';
  const tmBox = h('div', { class: 'tmrun' });
  const localBox = h('div', {}, h('div', { class: 'grow' }, dev), buildSlot);
  const cloud = testmuPicker(platform, g);
  const seg = h('div', { class: 'seg mini' });
  const paintTarget = () => {
    seg.replaceChildren(...[['local', platform === 'ios' ? 'Simülatör' : 'Emülatör'], ['testmu', 'TestMu gerçek cihaz']].map(([v, n]) =>
      h('button', { type: 'button', class: target === v ? 'active' : '', onclick: () => { target = v; store.set(`qahere.runTarget.${platform}`, v); paintTarget(); } }, n)));
    localBox.hidden = target !== 'local'; tmBox.hidden = target !== 'testmu';
    if (target === 'testmu' && !tmBox.childElementCount) tmBox.append(cloud.el);
    $('#sheetBody h2') && ($('#sheetBody h2').textContent = target === 'testmu' ? `${PLN} gerçek cihazda koş (TestMu)` : platform === 'ios' ? 'iOS simülatöründe koş' : 'Android emülatöründe koş');
  };

  const write = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
    if (yaml.value.trim() && !confirm('Mevcut akış Claude\'un yazacağıyla değiştirilsin mi?')) return;
    write.disabled = true; write.textContent = 'Yazılıyor…'; setNote();
    try {
      const r = await send('/api/flows/draft', 'POST', { ...ids, item, section });
      yaml.value = r.yaml; saved = r.yaml;
      setNote(r.syntaxError ? 'warn' : 'ok', r.syntaxError ? `Akış kaydedildi ama Maestro sözdizimi uyarısı verdi:\n${r.syntaxError}` : 'Akış yazıldı. "# kontrol et" işaretli satırlara bak, sonra koş.');
    } catch (e) { setNote('bad', e.message); }
    write.disabled = false; write.textContent = 'Claude yazsın';
  } }, 'Claude yazsın');

  const save = async () => {
    if (yaml.value === saved) return true;
    try {
      const r = await send('/api/flows', 'PUT', { ...ids, yaml: yaml.value });
      saved = yaml.value;
      if (r.syntaxError) { setNote('warn', `Maestro sözdizimi uyarısı:\n${r.syntaxError}`); return false; }
      return true;
    } catch (e) { setNote('bad', e.message); return false; }
  };

  const runBtn = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    setNote(); out.replaceChildren();
    if (!yaml.value.trim()) return setNote('bad', 'Önce akışı yazdır ya da yaz.');
    if (!(await save()) && !confirm('Sözdizimi uyarısına rağmen koşulsun mu?')) return;
    runBtn.disabled = true; write.disabled = true; runBtn.textContent = 'Koşuyor…';
    let job;
    const body = target === 'testmu' ? { ...ids, target, ...cloud.value() } : ids;
    if (target === 'testmu' && !body.app) { setNote('bad', 'Önce TestMu\'da koşulacak sürümü seç ya da Firebase\'den yükle.'); runBtn.disabled = false; write.disabled = false; runBtn.textContent = 'Koş'; return; }
    try { job = await send('/api/runs', 'POST', body); } catch (e) { setNote('bad', e.message); runBtn.disabled = false; write.disabled = false; runBtn.textContent = 'Koş'; return; }
    const log = h('pre', { class: 'runlog' });
    const stop = h('button', { class: 'btn plain sm', type: 'button', onclick: () => send(`/api/runs/${job.id}/cancel`, 'POST').catch(() => {}) }, 'Durdur');
    out.replaceChildren(h('div', { class: 'runhead' }, h('span', { class: 'spinner' }), h('b', {}, job.target === 'testmu' ? `${job.device.name} üzerinde koşuyor` : `${PLN} üzerinde koşuyor`), stop), log);
    let from = 0;
    while (true) {
      await new Promise((r) => setTimeout(r, 1000));
      try { job = await api(`/api/runs/${job.id}?from=${from}`); } catch { continue; }
      from = job.logTotal;
      if (job.log.length) { log.textContent += `${job.log.join('\n')}\n`; log.scrollTop = log.scrollHeight; }
      if (job.status !== 'running') break;
    }
    runBtn.disabled = false; write.disabled = false; runBtn.textContent = 'Yeniden koş';
    const secs = Math.round((job.endedAt - job.startedAt) / 1000);
    const where = job.target === 'testmu' ? `TestMu, ${job.device.name}` : `Maestro, ${PLN}`;
    const links = job.video || job.sessionUrl ? h('div', { class: 'runacts' },
      job.video ? h('a', { class: 'btn plain sm', href: job.video, target: '_blank', rel: 'noopener' }, 'Koşu videosu') : null,
      job.sessionUrl ? h('a', { class: 'btn plain sm', href: job.sessionUrl, target: '_blank', rel: 'noopener' }, 'TestMu\'da aç') : null) : null;
    if (job.status === 'pass') {
      frame.contentWindow?.postMessage({ qa: 'set', c, platform, value: 'pass' }, '*');
      out.replaceChildren(h('div', { class: 'msg ok' }, `Geçti (${secs} sn). Madde ${PLN} için "geçti" olarak işaretlendi.`), links, log);
    } else if (job.status === 'fail') {
      frame.contentWindow?.postMessage({ qa: 'set', c, platform, value: 'fail' }, '*');
      const bugBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => openBugSheet({ g, frame, c, platform, item, section,
        preset: { happened: `Otomasyon koşusunda (${where}) adım başarısız oldu:\n${job.message}${job.video ? `\nKoşu videosu: ${job.video}` : ''}${job.sessionUrl ? `\nTestMu oturumu: ${job.sessionUrl}` : ''}`, images: job.image ? [job.image] : [] } }) }, 'Hata kaydı aç');
      out.replaceChildren(
        h('div', { class: 'msg bad' }, h('b', {}, `Kaldı (${secs} sn).`), h('pre', { class: 'runmsg' }, job.message)),
        links,
        job.image ? h('figure', { class: 'shot big' }, h('img', { src: `data:${job.image.type};base64,${job.image.data}`, alt: 'Koşu bittiğindeki ekran' })) : null,
        h('div', { class: 'runacts' }, bugBtn, h('span', { class: 'hint' }, 'Akış hatalıysa (yanlış kimlik gibi) yukarıda düzeltip yeniden koş; madde işaretini de elle değiştirebilirsin.')),
        log);
    } else {
      out.replaceChildren(h('div', { class: 'msg warn' }, job.message || 'Koşu tamamlanamadı.'), log);
    }
  } }, 'Koş');

  openSheet(platform === 'ios' ? 'iOS simülatöründe koş' : 'Android emülatöründe koş', h('div', { class: 'bugform' },
    h('p', { class: 'bug-item run' }, h('span', {}, section || 'Test maddesi'), item),
    hasTestmu ? h('div', { class: 'between' }, h('span', { class: 'hint' }, 'Nerede koşsun'), seg) : null,
    h('div', { class: 'between' }, h('div', { class: 'grow' }, localBox, tmBox), write),
    h('label', { class: 'f' }, 'Maestro akışı', yaml),
    h('p', { class: 'hint' }, 'Akış bu madde ve platform için saklanır; sonraki koşular Claude kullanmaz. Uygulama kimliği ve ön akış Ayarlar → Simülatörde koşu bölümünden gelir.'),
    note, out,
  ), [h('button', { class: 'btn link sm', type: 'button', onclick: closeSheet }, 'Kapat'), runBtn]);

  paintTarget();
  api(`/api/flows?${q}`).then((r) => {
    yaml.value = r.yaml || ''; saved = yaml.value;
    if (!r.yaml) setNote('', state.config.run?.[platform]?.appId ? 'Bu madde için henüz akış yok. "Claude yazsın" rehberdeki otomasyon kimliklerinden kısa bir akış yazar; ya da kendin yaz.'
      : `Önce Ayarlar → Simülatörde koşu bölümünde ${platform === 'ios' ? 'iOS bundle id' : 'Android paket adı'} gir.`);
  }).catch((e) => setNote('bad', e.message));
}

/**
 * TestMu gerçek cihaz seçimi: cihaz + TestMu'daki sürüm (ya da Firebase'deki bir sürümü TestMu'ya yükle) + elle test.
 * Seçimler platform başına hatırlanır.
 */
function testmuPicker(platform, g) {
  const KEY = `qahere.testmu.${platform}`;
  let saved = {}; try { saved = JSON.parse(store.get(KEY) || '{}'); } catch { /* yok */ }
  const devSel = h('select', { 'aria-label': 'TestMu cihazı' }, h('option', {}, 'Cihazlar yükleniyor…'));
  const appSel = h('select', { 'aria-label': 'Uygulama sürümü' }, h('option', {}, 'Sürümler yükleniyor…'));
  const fbSel = h('select', { 'aria-label': 'Firebase sürümü', hidden: true });
  const msg = h('span', { class: 'hint' });
  const remember = () => store.set(KEY, JSON.stringify({ device: devSel.value, app: appSel.value }));
  devSel.addEventListener('change', remember); appSel.addEventListener('change', remember);
  const loadApps = (pick) => api(`/api/testmu/apps?platform=${platform}`).then((r) => {
    appSel.replaceChildren(...(r.apps.length ? r.apps.map((a) => h('option', { value: a.app }, `${a.version || '?'} (${a.build || '?'}) · ${fmtDate(a.at)}`)) : [h('option', { value: '' }, 'TestMu\'da yüklü sürüm yok')]));
    if (pick || saved.app) appSel.value = pick || saved.app;
    if (!appSel.value && r.apps[0]) appSel.value = r.apps[0].app;
  }).catch((e) => { appSel.replaceChildren(h('option', { value: '' }, e.message)); });
  api(`/api/testmu/devices?platform=${platform}`).then((r) => {
    devSel.replaceChildren(...r.devices.map((d) => h('option', { value: `${d.deviceName}|${d.platformVersion}` }, `${d.deviceName} · ${platform === 'ios' ? 'iOS' : 'Android'} ${d.platformVersion}`)));
    if (saved.device && [...devSel.options].some((o) => o.value === saved.device)) devSel.value = saved.device;
  }).catch((e) => devSel.replaceChildren(h('option', { value: '' }, e.message)));
  loadApps();
  const upload = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
    if (fbSel.hidden) {
      upload.disabled = true; msg.textContent = 'Firebase sürümlerine bakılıyor…';
      const r = await api(`/api/firebase/releases?platform=${platform}`).catch((e) => ({ releases: [], error: e.message }));
      upload.disabled = false;
      if (r.error || !r.releases.length) { msg.replaceChildren(r.error || 'Firebase\'de sürüm yok.', ' ', fbFix(r.error, () => { msg.textContent = 'Firebase girişi tamam; şimdi yeniden "Firebase\'den yükle"ye bas.'; }) || ''); return; }
      const keys = [g.key];
      fbSel.replaceChildren(...r.releases.map((x) => h('option', { value: x.name }, `${x.version} (${x.build})${keys.some((k) => x.notes.includes(k)) ? ` · ${g.key} bu sürümde` : ''}`)));
      const hit = r.releases.find((x) => x.notes.includes(g.key));
      if (hit) fbSel.value = hit.name;
      fbSel.hidden = false; upload.textContent = 'Bu sürümü TestMu\'ya yükle'; msg.textContent = '';
      return;
    }
    upload.disabled = true; msg.textContent = 'TestMu sürümü Firebase\'den çekiyor; büyük dosyalarda bir iki dakika sürebilir…';
    try {
      const r = await send('/api/testmu/upload', 'POST', { platform, releaseName: fbSel.value });
      await loadApps(r.app); remember();
      msg.textContent = r.reused ? `${r.version} (${r.build}) zaten TestMu'daydı; seçildi.` : `${r.version} (${r.build}) yüklendi ve seçildi.`;
      fbSel.hidden = true; upload.textContent = 'Firebase\'den yükle';
    } catch (e) { msg.textContent = e.message; }
    upload.disabled = false;
  } }, 'Firebase\'den yükle');
  const el = h('div', { class: 'tmpick' },
    h('label', { class: 'f' }, 'Cihaz', devSel),
    h('label', { class: 'f' }, 'Sürüm', h('div', { class: 'between' }, appSel, upload)),
    fbSel, msg,
    h('p', { class: 'hint' }, 'Hesabında aynı anda 3 oturum hakkı var. Elle test etmek için ',
      h('a', { href: 'https://applive.lambdatest.com/', target: '_blank', rel: 'noopener' }, 'TestMu App Live'), '\'ı aç: yüklediğin sürümler orada listelenir.'));
  return {
    el,
    value: () => { const [deviceName, platformVersion] = String(devSel.value).split('|'); return { device: { deviceName, platformVersion }, app: appSel.value }; },
  };
}

/**
 * Android emülatöründe kurulu sürüm + Firebase App Distribution'dan sürüm seçip kurma. Koşudan önce doğru sürüm.
 * onChange(installed) kurulum bitince çağrılır.
 */
function androidBuildRow(deviceId, onChange, keys = []) {
  const box = h('div', { class: 'buildrow' }, h('span', { class: 'hint' }, 'Kurulu sürüme ve Firebase\'e bakılıyor…'));
  const fmt = (v) => (v ? `${v.version || '?'}${v.build ? ` (${v.build})` : ''}` : 'kurulu değil');
  const paint = (d) => {
    const inst = h('span', {}, h('b', {}, 'Kurulu: '), fmt(d.installed));
    if (d.error) return box.replaceChildren(inst, h('span', { class: 'hint' }, ` · ${d.error}`), fbFix(d.error, () => api(`/api/firebase/android?device=${encodeURIComponent(deviceId)}`).then(paint).catch((e) => paint({ error: e.message }))));
    const rels = d.releases || [];
    if (!rels.length) return box.replaceChildren(inst, h('span', { class: 'hint' }, ' · Firebase\'de sürüm yok.'));
    // Sürüm notlarında iş anahtarı geçiyor mu? (ör. "PROJ-123 - Fix …") İşi içeren ilk sürüm = en küçük build.
    const want = [...new Set(keys.filter(Boolean))];
    const has = (r, k) => new RegExp(`\\b${k.replace(/[-]/g, '\\-')}\\b`).test(r.notes);
    const matches = want.map((k) => {
      const hits = rels.filter((r) => has(r, k));
      const first = hits.reduce((a, r) => (!a || Number(r.build) < Number(a.build) ? r : a), null);
      // Aynı sürüm hattında (versionName) build büyükse içerir; farklı hatta (ör. 2.4.1 hotfix ↔ 2.5.0) yalnızca
      // notlarında iş geçen sürümün kendisi kuruluysa kesin; değilse "belli değil".
      const inst = d.installed;
      const exact = Boolean(inst && hits.some((r) => String(r.build) === String(inst.build)));
      const sameLine = Boolean(first && inst && hits.some((r) => r.version === inst.version && Number(inst.build) >= Number(r.build)));
      const otherLine = Boolean(first && inst && !exact && !sameLine && !hits.some((r) => r.version === inst.version));
      return { k, first, inInstalled: exact || sameLine, unsure: otherLine && Number(inst.build) >= Number(first.build) };
    });
    const sel = h('select', { class: 'ver', 'aria-label': 'Firebase sürümü' }, ...rels.map((r, i) => h('option', { value: r.name },
      `${r.version} (${r.build}) · ${fmtDate(r.createdAt)}${i === 0 ? ' · en yeni' : ''}${want.some((k) => has(r, k)) ? ` · ${want.filter((k) => has(r, k)).join(', ')}` : ''}`)));
    const same = (r) => d.installed && String(d.installed.build) === String(r.build);
    const note = h('div', {});
    const btn = h('button', { class: 'btn sm', type: 'button' });
    const paintBtn = () => {
      const r = rels.find((x) => x.name === sel.value);
      btn.textContent = same(r) ? 'Yeniden kur' : 'Bu sürümü kur';
      btn.classList.toggle('plain', same(r));
      note.replaceChildren(...(r?.notes ? [h('div', { class: 'hint relnotes' }, r.notes)] : []));
    };
    sel.onchange = paintBtn;
    btn.onclick = async (ev, allowUninstall = false) => {
      btn.disabled = true; sel.disabled = true;
      const st = h('span', { class: 'hint' }, 'Başlıyor…');
      note.replaceChildren(st);
      try {
        const res = await fetch('/api/firebase/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ release: sel.value, device: deviceId, allowUninstall }) });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let last = null;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            let e; try { e = JSON.parse(line); } catch { continue; }
            if (e.type === 'step') st.textContent = `${e.message}…`;
            else last = e;
          }
        }
        if (last?.type === 'done') { d.installed = last.installed; onChange?.(last.installed); paint(d); box.append(h('div', { class: 'msg ok' }, `${last.version} (${last.build}) kuruldu.`)); return; }
        if (last?.needsUninstall && confirm(`${last.message}\n\nKaldırıp kurulsun mu?`)) return btn.onclick(ev, true);
        note.replaceChildren(h('div', { class: 'msg bad' }, last?.message || 'Kurulum tamamlanamadı.'));
      } catch (e) { note.replaceChildren(h('div', { class: 'msg bad' }, e.message)); }
      btn.disabled = false; sel.disabled = false;
    };
    paintBtn();
    const latest = rels[0];
    const keyNotes = matches.map((m) => (!m.first
      ? h('div', { class: 'msg warn' }, `${m.k} son ${rels.length} Firebase sürümünün notlarında geçmiyor; düzeltmesi henüz bir sürüme girmemiş olabilir.`)
      : m.inInstalled
        ? h('div', { class: 'msg ok' }, `${m.k} ilk kez ${m.first.version} (${m.first.build}) ile geldi; emülatördeki sürüm bunu içeriyor.`)
        : m.unsure
          ? h('div', { class: 'msg warn' }, `${m.k} ${m.first.version} (${m.first.build}) ile geldi; emülatördeki ${d.installed.version} farklı bir sürüm hattı, düzeltmeyi içerip içermediği belli değil. Emin olmak için ${m.first.version} sürümünü kur.`)
        : h('div', { class: 'msg warn' }, `${m.k} ilk kez ${m.first.version} (${m.first.build}) ile geldi; emülatördeki sürüm ${d.installed ? 'bunu içermiyor' : 'yok'}. Testten önce kur.`)));
    // İşi içermeyen bir sürüm kuruluysa en yeni sürüm hazır seçilir.
    // İşi içermeyen ya da belirsiz bir sürüm kuruluysa: işin geçtiği en yeni sürüm hazır seçilir.
    const need = matches.find((m) => m.first && !m.inInstalled);
    if (need) { const best = rels.find((r) => has(r, need.k)) || latest; sel.value = best.name; paintBtn(); }
    box.replaceChildren(...[h('div', { class: 'buildline' }, inst, sel, btn),
      ...keyNotes,
      !same(latest) && d.installed && !keyNotes.length ? h('div', { class: 'msg warn' }, `Emülatördeki sürüm Firebase'deki en yeni sürüm değil (${latest.version} (${latest.build})). Testten önce kurmayı düşün.`) : null,
      !d.installed ? h('div', { class: 'msg warn' }, 'Uygulama emülatörde kurulu değil; koşmadan önce kur.') : null,
      note].filter(Boolean));
  };
  api(`/api/firebase/android?device=${encodeURIComponent(deviceId)}`).then(paint).catch((e) => paint({ error: e.message }));
  return box;
}

/**
 * İş (alt başlık) başına toplu koşu: maddeler sırayla. Akışı olmayan maddeye Claude bir kez akış yazar (kullanım hakkı),
 * koşuyu Maestro yapar (Claude'suz). Her sonuç maddeye işlenir; kalanlardan tek tıkla hata kaydı açılır.
 */
function openBatchRunSheet({ g, frame, platform, title, items }) {
  const PLN = platform === 'ios' ? 'iOS' : 'Android';
  const appId = state.config.run?.[platform]?.appId;
  const ids = (c) => ({ key: g.key, guideId: g.id, c, platform });
  const skipDone = h('input', { type: 'checkbox', checked: true });
  const list = h('ol', { class: 'batch' });
  const rows = new Map();
  const ICON = { wait: '·', draft: '✎', run: '▶', pass: '✓', fail: '✕', skip: '–', err: '!' };
  const setRow = (c, st, note) => { const r = rows.get(c); r.dataset.st = st; r.firstChild.textContent = ICON[st] || '·'; r.lastChild.textContent = note || ''; };
  for (const it of items) {
    const li = h('li', { 'data-st': 'wait' }, h('span', { class: 'bi' }, '·'), h('span', { class: 'bt' }, it.text), h('span', { class: 'bn' }, it.state === 'pass' ? 'daha önce geçti' : it.state === 'fail' ? 'daha önce kaldı' : ''));
    rows.set(it.c, li); list.append(li);
  }
  const info = h('div', {});
  const out = h('div', {});
  let stop = false;
  let current = null;
  const startBtn = h('button', { class: 'btn sm', type: 'button', disabled: true }, 'Koşmaya başla');
  const stopBtn = h('button', { class: 'btn plain sm', type: 'button', hidden: true, onclick: () => { stop = true; if (current) send(`/api/runs/${current}/cancel`, 'POST').catch(() => {}); stopBtn.disabled = true; stopBtn.textContent = 'Durduruluyor…'; } }, 'Durdur');

  // Nerede koşsun: bu bilgisayar ya da TestMu gerçek cihazı (tekli koşu penceresiyle aynı seçim, platform başına hatırlanır).
  const hasTestmu = Boolean(state.config.testmu?.hasKey);
  let target = hasTestmu && store.get(`qahere.runTarget.${platform}`) === 'testmu' ? 'testmu' : 'local';
  let cloud = null;
  const seg = h('div', { class: 'seg mini' });
  const paintTarget = () => seg.replaceChildren(...[['local', platform === 'ios' ? 'Simülatör' : 'Emülatör'], ['testmu', 'TestMu gerçek cihaz']].map(([v, n]) =>
    h('button', { type: 'button', class: target === v ? 'active' : '', disabled: !startBtn.hidden && startBtn.dataset.started === '1',
      onclick: () => { target = v; store.set(`qahere.runTarget.${platform}`, v); paintTarget(); check(); } }, n)));
  const where = () => (target === 'testmu' ? 'TestMu gerçek cihazda' : `${PLN} üzerinde`);

  // Ön kontrol: cihaz, uygulama kimliği, akışı olmayan madde sayısı.
  const check = async () => {
    startBtn.disabled = true;
    if (!appId) return info.replaceChildren(h('div', { class: 'msg bad' }, `Önce Ayarlar → Simülatörde koşu bölümünde ${platform === 'ios' ? 'iOS bundle id' : 'Android paket adı'} gir.`));
    let dev = null;
    if (target === 'local') {
      dev = (await api('/api/devices').catch(() => ({})))[platform];
      if (!dev) return info.replaceChildren(h('div', { class: 'msg bad' }, platform === 'ios' ? 'Açık bir iOS simülatörü yok. Simülatörü aç ya da TestMu gerçek cihazı seç.' : 'Bağlı bir Android emülatörü ya da cihazı yok. Emülatörü aç ya da TestMu gerçek cihazı seç.'));
    } else cloud ||= testmuPicker(platform, g);
    const flows = await Promise.all(items.map((it) => api(`/api/flows?key=${encodeURIComponent(g.key)}&guideId=${encodeURIComponent(g.id)}&c=${it.c}&platform=${platform}`).then((r) => Boolean(r.yaml)).catch(() => false)));
    items.forEach((it, i) => { it.hasFlow = flows[i]; });
    const missing = items.filter((it) => !it.hasFlow).length;
    const build = target === 'testmu' ? cloud.el : platform === 'android' ? androidBuildRow(dev.id, null, title.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || [g.key]) : null;
    info.replaceChildren(...(build ? [build] : []), h('p', { class: 'hint' }, target === 'testmu' ? `${items.length} madde, sırayla koşulur; her madde ayrı bir TestMu oturumu ve videosudur. ` : `Cihaz: ${dev.name}. ${items.length} madde. `,
      missing ? `${missing} maddenin akışı yok; Claude onları bir kez yazacak (kullanım hakkından düşer, sonraki koşular Claude kullanmaz).` : 'Bütün maddelerin akışı hazır; koşu Claude kullanmaz.'),
      h('p', { class: 'hint' }, 'Akışlar gerçek uygulamada çalışır. Gönderme, ödeme gibi geri alınamayan adım içeren maddelerin akışını önce maddenin kendi penceresinden gözden geçir.'));
    startBtn.disabled = false;
  };
  paintTarget();
  check();

  startBtn.onclick = async () => {
    if (target === 'testmu' && !cloud?.value().app) return info.append(h('div', { class: 'msg bad' }, 'Önce TestMu\'da koşulacak sürümü seç ya da Firebase\'den yükle.'));
    startBtn.dataset.started = '1'; paintTarget();
    startBtn.hidden = true; stopBtn.hidden = false; skipDone.disabled = true;
    const tally = { pass: 0, fail: 0, skip: 0, err: 0 };
    const failed = [];
    for (const it of items) {
      if (stop) break;
      if (skipDone.checked && it.state === 'pass') { setRow(it.c, 'skip', 'daha önce geçti, atlandı'); tally.skip++; continue; }
      rows.get(it.c).scrollIntoView({ block: 'nearest' });
      try {
        if (!it.hasFlow) {
          setRow(it.c, 'draft', 'Claude akışı yazıyor…');
          const d = await send('/api/flows/draft', 'POST', { ...ids(it.c), item: it.text, section: it.section });
          it.hasFlow = true;
          if (d.syntaxError) { setRow(it.c, 'err', 'Akışta sözdizimi hatası; maddenin penceresinden düzelt'); tally.err++; continue; }
        }
        if (stop) break;
        setRow(it.c, 'run', `${where()} koşuyor…`);
        let job = await send('/api/runs', 'POST', target === 'testmu' ? { ...ids(it.c), target, ...cloud.value() } : ids(it.c));
        current = job.id;
        while (job.status === 'running') {
          await new Promise((r) => setTimeout(r, 1500));
          try { job = await api(`/api/runs/${job.id}?from=999999`); } catch { /* yeniden dene */ }
        }
        current = null;
        const secs = Math.round((job.endedAt - job.startedAt) / 1000);
        if (job.status === 'pass') { frame.contentWindow?.postMessage({ qa: 'set', c: it.c, platform, value: 'pass' }, '*'); setRow(it.c, 'pass', `geçti · ${secs} sn`); tally.pass++; }
        else if (job.status === 'fail') {
          frame.contentWindow?.postMessage({ qa: 'set', c: it.c, platform, value: 'fail' }, '*');
          setRow(it.c, 'fail', `kaldı · ${secs} sn`); tally.fail++; failed.push({ it, job });
        } else { setRow(it.c, 'err', job.message || 'koşu tamamlanamadı'); tally.err++; }
      } catch (e) { setRow(it.c, 'err', e.message); tally.err++; }
    }
    for (const it of items) if (rows.get(it.c).dataset.st === 'wait') setRow(it.c, 'wait', 'koşulmadı');
    stopBtn.hidden = true;
    out.replaceChildren(
      h('div', { class: `msg ${tally.fail || tally.err ? 'warn' : 'ok'}` }, `${stop ? 'Durduruldu. ' : ''}${tally.pass} geçti, ${tally.fail} kaldı${tally.err ? `, ${tally.err} koşulamadı` : ''}${tally.skip ? `, ${tally.skip} atlandı` : ''}. Sonuçlar maddelere ${PLN} için işlendi.`),
      ...failed.map(({ it, job }) => h('div', { class: 'batch-fail' },
        h('b', {}, it.text.slice(0, 140)), h('pre', { class: 'runmsg' }, job.message),
        h('button', { class: 'btn plain sm', type: 'button', onclick: () => openBugSheet({ g, frame, c: it.c, platform, item: it.text, section: it.section,
          preset: { happened: `Otomasyon koşusunda (${job.target === 'testmu' ? `TestMu, ${job.device.name}` : `Maestro, ${PLN}`}) adım başarısız oldu:\n${job.message}${job.video ? `\nKoşu videosu: ${job.video}` : ''}`, images: job.image ? [job.image] : [] } }) }, 'Hata kaydı aç'),
        job.video ? h('a', { class: 'btn plain sm', href: job.video, target: '_blank', rel: 'noopener' }, 'Koşu videosu') : null)));
  };

  openSheet(`${title} · ${platform === 'ios' ? 'iOS\'ta' : 'Android\'de'} koş`, h('div', { class: 'bugform' },
    hasTestmu ? h('div', { class: 'between' }, h('span', { class: 'hint' }, 'Nerede koşsun'), seg) : null,
    info, h('label', { class: 'only-row' }, skipDone, ' Daha önce geçmiş maddeleri atla'), list, out),
  [h('button', { class: 'btn link sm', type: 'button', onclick: () => { stop = true; if (current) send(`/api/runs/${current}/cancel`, 'POST').catch(() => {}); closeSheet(); } }, 'Kapat'), stopBtn, startBtn]);
}

// ---- Kokpit ------------------------------------------------------------------------------
// Test ortamının uyarı paneli: üstte ışıklar (yeşil/sarı/kırmızı), altta ayrıntı. Cihazda bir şey açmak yalnızca tıklayınca.

const PL = { android: 'Android', ios: 'iOS' };
const lampState = (x) => (x == null ? 'off' : x === true ? 'ok' : x === false ? 'bad' : x);

function cockpitLinksSheet(onSaved) {
  const c = JSON.parse(JSON.stringify(state.config.cockpit || { deeplinks: [], endpoints: [] }));
  const err = h('div', {});
  const editor = (key, title, ph, hint) => {
    const box = h('div', { class: 'group' });
    const paint = () => box.replaceChildren(
      ...c[key].map((x, i) => {
        const n = h('input', { class: 'bare', placeholder: 'Ad', value: x.name, oninput: () => { x.name = n.value; } });
        const u = h('input', { class: 'bare mono', placeholder: ph, value: x.url, spellcheck: 'false', oninput: () => { x.url = u.value.trim(); } });
        return h('div', { class: 'row' }, h('div', { style: 'width:150px;flex:none' }, n), h('div', { class: 'grow' }, u),
          h('button', { class: 'btn danger sm', type: 'button', onclick: () => { c[key].splice(i, 1); paint(); } }, 'Sil'));
      }),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', {}, hint)),
        h('button', { class: 'btn plain sm', type: 'button', onclick: () => { c[key].push({ name: '', url: '' }); paint(); } }, 'Ekle')));
    paint();
    return h('div', {}, h('div', { class: 'group-title' }, title), box);
  };
  const save = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    save.disabled = true;
    try { applyConfig(await send('/api/settings', 'PUT', { cockpit: c })); closeSheet(); onSaved(); }
    catch (e) { err.replaceChildren(h('div', { class: 'msg bad' }, e.message)); save.disabled = false; }
  } }, 'Kaydet');
  openSheet('Kokpit bağlantıları', h('div', {},
    editor('deeplinks', 'Deeplink\'ler', 'uygulama://urun/123 ya da https://site.com/kampanya', 'Kokpitte "Android\'de aç / iOS\'ta aç" ile cihazda denenir. https bağlantıları için App Links ve Universal Links dosyası da denetlenir.'),
    editor('endpoints', 'Ayakta olması gereken adresler', 'https://api.sirketin.com/health', 'Kokpit her açıldığında yalnızca GET isteği atılır; 400 ve üstü ya da 10 sn yanıtsızlık kırmızı yanar. Token ya da gizli bilgi içeren adres girme.'),
    err), [h('button', { class: 'btn link sm', type: 'button', onclick: closeSheet }, 'Vazgeç'), save]);
}

// ---- Firebase girişi uygulamadan: düğme CLI'ın Google onay sayfasını tarayıcıda açar, onay gelince kendiliğinden biter.
const FB_LOGIN_RE = /Firebase.{0,40}(giriş|login)|invalid_grant/i;
function fbLoginButton(onDone) {
  const b = h('button', { class: 'btn sm', type: 'button' }, 'Firebase\'e giriş yap');
  const st = h('span', { class: 'hint fbstate' });
  b.onclick = async () => {
    b.disabled = true;
    let s = await send('/api/firebase/login', 'POST', {}).catch((e) => ({ status: 'error', message: e.message }));
    while (s.status === 'waiting') {
      st.replaceChildren(s.message, s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, ' Sayfa açılmadıysa buradan aç.') : '');
      await new Promise((r) => setTimeout(r, 2000));
      s = await api('/api/firebase/login').catch((e) => ({ status: 'error', message: e.message }));
    }
    st.textContent = s.message || '';
    if (s.status === 'ok') { b.remove(); onDone?.(); return; }
    b.disabled = false; b.textContent = 'Yeniden dene';
  };
  return h('span', { class: 'fbfix' }, b, st);
}
const fbFix = (msg, onDone) => (FB_LOGIN_RE.test(msg || '') ? fbLoginButton(onDone) : null);

// ---- Cloud: gerçek cihaz bulutları (TestMu; BrowserStack sırada) ----

function showCloud() {
  state.current = null;
  setView('cloud');
  $('#main').classList.remove('gmode');
  if (location.hash !== '#cloud') history.replaceState(null, '', '#cloud');
  document.querySelectorAll('.item').forEach((el) => el.classList.remove('active'));
  const provBox = h('div', { class: 'cl-prov' }, h('p', { class: 'muted' }, 'Sağlayıcılar okunuyor…'));
  const runBox = h('div', { class: 'group' }, h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Son koşular okunuyor…')));
  const devBox = h('div', { class: 'cp-cols' });
  const appBox = h('div', { class: 'cp-cols' });
  const section = (title, sub, ...kids) => h('section', { class: 'cp-sec' }, h('div', { class: 'group-title' }, title), sub ? h('p', { class: 'cl-sub' }, sub) : null, ...kids);
  const refresh = h('button', { class: 'btn plain sm', type: 'button', onclick: () => showCloud() }, 'Yenile');
  $('#main').replaceChildren(h('div', { class: 'wrap wide cockpit cloud' },
    h('div', { class: 'cp-head' }, h('div', {}, h('h1', {}, 'Cloud'), h('span', { class: 'muted' }, 'Maddeleri gerçek cihazlarda koşturan bulut hizmetleri')),
      h('div', { class: 'bar-actions' }, h('button', { class: 'btn plain sm', type: 'button', onclick: openSettings }, 'Hesap bağla'), refresh)),
    provBox,
    section('Son koşular', 'Hesaptaki son otomasyon oturumları. qaHere\'den başlatılanların adı "İŞ · madde n · platform" biçiminde.', runBox),
    section('Cihazlar', 'Koşu penceresinde "TestMu gerçek cihaz" seçilince bu listeden seçilir. Telefonlar önde.', devBox),
    section('Yüklü sürümler', 'Test edilen uygulamanın TestMu\'ya yüklenmiş sürümleri. Koşu penceresinde "Firebase\'den yükle" ile eklenir.', appBox)));

  const STATUS = { passed: ['ok', 'Geçti'], completed: ['ok', 'Bitti'], failed: ['bad', 'Kaldı'], error: ['bad', 'Hata'], running: ['run', 'Koşuyor'], queued: ['warn', 'Sırada'], timeout: ['bad', 'Zaman aşımı'], idle_timeout: ['bad', 'Zaman aşımı'], stopped: ['warn', 'Durduruldu'], 'lambda error': ['bad', 'TestMu hatası'] };
  const dur = (s) => (s >= 60 ? `${Math.floor(s / 60)} dk ${s % 60} sn` : `${s} sn`);

  api('/api/cloud').then(({ providers, sessions }) => {
    provBox.replaceChildren(...providers.map((p) => {
      if (p.supported === false) return h('div', { class: 'cl-card soon' }, h('div', { class: 'cl-top' }, h('b', {}, p.name), h('span', { class: 'cl-state' }, 'Henüz yok')),
        h('p', {}, 'Desteği sırada. Eklendiğinde hesabını Ayarlar\'dan bağlarsın, cihazları ve koşuları burada görürsün.'));
      const c = p.concurrency || {};
      const st = !p.configured ? ['off', 'Bağlı değil'] : p.ok ? ['ok', 'Bağlı'] : ['bad', 'Bağlanamadı'];
      return h('div', { class: `cl-card ${st[0]}` },
        h('div', { class: 'cl-top' }, h('b', {}, p.name), h('span', { class: 'cl-state' }, h('i', {}), st[1])),
        !p.configured ? h('p', {}, 'Kullanıcı adı ve erişim anahtarını Ayarlar → TestMu\'ya gir.')
          : !p.ok ? h('p', {}, p.error)
          : h('div', { class: 'cl-meter' },
            h('div', {}, h('strong', {}, String(c.running ?? c.created ?? 0)), h('span', {}, `/ ${c.max_concurrency ?? '?'} cihaz şu an kullanımda`)),
            c.pqueued ? h('span', { class: 'muted' }, `${c.pqueued} koşu sırada`) : null),
        p.configured ? h('div', { class: 'cl-links' },
          h('span', { class: 'muted' }, p.username),
          h('a', { href: 'https://appautomation.lambdatest.com/build', target: '_blank', rel: 'noopener' }, 'Otomasyon panosu'),
          h('a', { href: 'https://applive.lambdatest.com/', target: '_blank', rel: 'noopener' }, 'App Live')) : null);
    }));
    const tmu = providers.find((p) => p.id === 'testmu');
    const tmg = tmu?.testManager;
    if (tmu?.configured && tmu.ok && tmg) {
      provBox.insertBefore(h('div', { class: `cl-card ${tmg.ok ? 'ok' : 'bad'}` },
        h('div', { class: 'cl-top' }, h('b', {}, 'TestMu Test Manager'), h('span', { class: 'cl-state' }, h('i', {}), tmg.ok ? 'Bağlı' : 'Bağlanamadı')),
        tmg.ok ? h('div', { class: 'cl-meter' }, h('div', {}, h('strong', {}, String(tmg.total)), h('span', {}, 'proje'))) : h('p', {}, tmg.error),
        h('p', {}, tmg.ok ? 'Ek kurulum gerekmez: TestMu anahtarınla bağlanır. Bir rehberin kontrol listesini aktarmak için rehberde Diğer → Test Manager\'a aktar.' : 'TestMu anahtarın Test Manager\'a erişemedi.')), provBox.children[1] || null);
    }
    if (!tmu?.configured || !tmu.ok) {
      const msg = !tmu?.configured ? 'TestMu bağlanınca son koşular, cihazlar ve yüklü sürümler burada görünür.' : 'TestMu\'ya bağlanılamadı.';
      for (const b of [runBox, devBox, appBox]) b.replaceChildren(h('p', { class: 'muted' }, msg));
      return;
    }
    runBox.replaceChildren(...(sessions.length ? sessions.map((s) => {
      const [cls, label] = STATUS[s.status] || ['', s.status || '—'];
      return h('div', { class: 'row cl-run' },
        h('span', { class: `dot ${cls}` }),
        h('div', { class: 'grow' }, h('b', {}, s.name || s.build || s.id), h('span', {}, `${PL[s.platform] || s.platform} ${s.os} · ${s.device} · ${dur(s.duration)} · ${fmtDate(s.at)}`)),
        h('span', { class: `val cl-st ${cls}` }, label),
        s.video ? h('a', { class: 'btn plain sm', href: s.video, target: '_blank', rel: 'noopener' }, 'Video') : null,
        s.url ? h('a', { class: 'btn plain sm', href: s.url, target: '_blank', rel: 'noopener' }, 'Oturum') : null);
    }) : [h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Henüz koşu yok. Bir rehberde "Cihazda koş"a bas, "TestMu gerçek cihaz"ı seç.'))]));
  }).catch((e) => provBox.replaceChildren(h('p', { class: 'msg bad' }, e.message)));

  const cfgApp = (p) => state.config?.run?.[p]?.appId;
  for (const p of ['android', 'ios']) {
    const dcol = h('div', { class: 'group' }, h('div', { class: 'row' }, h('b', { class: 'cp-pl' }, PL[p]), h('span', { class: 'muted' }, 'okunuyor…')));
    const acol = h('div', { class: 'group' }, h('div', { class: 'row' }, h('b', { class: 'cp-pl' }, PL[p]), h('span', { class: 'muted' }, 'okunuyor…')));
    devBox.append(dcol); appBox.append(acol);
    api(`/api/testmu/devices?platform=${p}`).then(({ devices }) => {
      const byName = new Map();
      for (const d of devices) byName.set(d.deviceName, [...(byName.get(d.deviceName) || []), d.platformVersion]);
      const rows = [...byName].map(([n, vs]) => h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, n)), h('span', { class: 'val' }, [...new Set(vs)].join(', '))));
      const head = h('div', { class: 'row' }, h('b', { class: 'cp-pl' }, PL[p]), h('span', { class: 'muted' }, `${byName.size} model`));
      dcol.replaceChildren(head, ...rows.slice(0, 8), rows.length > 8 ? h('details', { class: 'cl-more' }, h('summary', {}, `${rows.length - 8} model daha`), ...rows.slice(8)) : null);
    }).catch((e) => dcol.replaceChildren(h('div', { class: 'row' }, h('b', { class: 'cp-pl' }, PL[p]), h('span', { class: 'muted' }, e.message))));
    api(`/api/testmu/apps?platform=${p}`).then(({ apps }) => {
      const head = h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', { class: 'cp-pl' }, PL[p]), h('span', {}, cfgApp(p) || '')));
      acol.replaceChildren(head, ...(apps.length ? apps.slice(0, 6).map((a) => h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, `${a.version || '?'} (${a.build || '?'})`)), h('span', { class: 'val' }, a.at ? fmtDate(a.at.replace(' ', 'T')) : '')))
        : [h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Yüklü sürüm yok.'))]));
    }).catch((e) => acol.replaceChildren(h('div', { class: 'row' }, h('b', { class: 'cp-pl' }, PL[p]), h('span', { class: 'muted' }, e.message))));
  }
}

function showCockpit() {
  state.current = null;
  setView('cockpit');
  $('#main').classList.remove('gmode');
  if (location.hash !== '#kokpit') history.replaceState(null, '', '#kokpit');
  document.querySelectorAll('.item').forEach((el) => el.classList.remove('active'));
  const cfg = state.config;
  const lamps = {};
  const panel = h('div', { class: 'ann' });
  const LAMPS = [
    ['android', 'Android'], ['ios', 'iOS'], ['version', 'Sürüm'], ['crash', 'Çökme'], ['links', 'App Links'], ['deeplinks', 'Deeplink'],
    ['endpoints', 'Adresler'], ['claude', 'Claude Code'], ['jira', 'Jira'], ['firebase', 'Firebase'], ['testmu', 'TestMu'], ['tools', 'Cihaz araçları'], ['proxyman', 'Proxyman'], ['meetings', 'Toplantılar'],
  ];
  for (const [k, n] of LAMPS) {
    lamps[k] = h('button', { type: 'button', class: 'lamp off', onclick: () => document.getElementById(`cp-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      h('b', {}, n), h('span', {}, '…'));
    panel.append(lamps[k]);
  }
  const setLamp = (k, st, text) => { lamps[k].className = `lamp ${st}`; lamps[k].querySelector('span').textContent = text; };

  const appBox = h('div', { class: 'cp-cols' });
  const dlBox = h('div', { class: 'group' });
  const epBox = h('div', { class: 'group' });
  const assocBox = h('div', { class: 'group' });
  const toolBox = h('div', { class: 'group' });
  const stamp = h('span', { class: 'muted' });
  const section = (id, title, ...kids) => h('section', { id: `cp-${id}`, class: 'cp-sec' }, h('div', { class: 'group-title' }, title), ...kids);
  const row = (st, name, detail, ...right) => h('div', { class: 'row' }, h('span', { class: `dot ${st}` }), h('div', { class: 'grow' }, h('b', {}, name), detail ? h('span', {}, detail) : null), ...right);
  const dotOf = (x) => (x?.ok ? 'ok' : x?.warn ? 'warn' : x?.ok === null ? '' : 'bad');

  const refresh = h('button', { class: 'btn plain sm', type: 'button', onclick: () => load() }, 'Yenile');
  const editLinks = h('button', { class: 'btn plain sm', type: 'button', onclick: () => cockpitLinksSheet(() => showCockpit()) }, 'Bağlantıları düzenle');
  $('#main').replaceChildren(h('div', { class: 'wrap wide cockpit' },
    h('div', { class: 'cp-head' }, h('div', {}, h('h1', {}, 'Kokpit'), stamp), h('div', { class: 'bar-actions' }, editLinks, refresh)),
    panel,
    section('app', 'Test edilen uygulama', appBox),
    section('deeplinks', 'Deeplink\'ler', dlBox),
    section('links', 'App Links ve Universal Links', assocBox),
    section('endpoints', 'Adresler', epBox),
    section('tools', 'qaHere ve araçlar', toolBox)));

  // ---- uygulama
  const appCard = (p, a, all) => {
    const head = h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', { class: 'cp-pl' }, PL[p]), h('span', {}, a.appId || 'Uygulama kimliği girilmedi')));
    if (!a.appId) return h('div', { class: 'group' }, head, row('', 'Ayarlar → Simülatörde koşu', 'Uygulama kimliğini girince bu platform denetlenir.', h('button', { class: 'btn plain sm', type: 'button', onclick: openSettings }, 'Aç')));
    const ver = a.installed ? `${a.installed.version || '?'} (${a.installed.build || '?'})` : null;
    const latest = a.latest && !a.latest.error ? `${a.latest.version} (${a.latest.build})` : null;
    const same = ver && latest ? (a.installed.version === a.latest.version && a.installed.build === a.latest.build) : null;
    const launch = h('button', { class: 'btn plain sm', type: 'button', disabled: !a.device || !a.installed, onclick: async () => {
      launch.disabled = true; launch.textContent = 'Açılıyor…';
      try { await send('/api/cockpit/launch', 'POST', { platform: p }); setTimeout(load, 2500); } catch (e) { launch.textContent = e.message; }
    } }, a.running ? 'Öne getir' : 'Uygulamayı aç');
    return h('div', { class: 'group' }, head,
      row(a.device ? 'ok' : 'bad', p === 'ios' ? 'Simülatör' : 'Cihaz', a.device?.name || (p === 'ios' ? 'Açık simülatör yok' : 'Bağlı emülatör ya da cihaz yok')),
      row(!a.device ? '' : a.installed ? 'ok' : 'bad', 'Kurulu sürüm', !a.device ? '—' : ver || 'Uygulama kurulu değil'),
      row(same === true ? 'ok' : same === false ? 'warn' : '', 'Firebase\'deki son sürüm', a.latest?.error || latest || '—', fbFix(a.latest?.error, load),
        same === false && p === 'android' ? h('span', { class: 'val' }, 'Rehberden "Sürüm kur" ile güncelle') : null),
      row(!a.installed ? '' : a.running ? 'ok' : 'warn', 'Çalışıyor mu', !a.installed ? '—' : a.running ? 'Açık' : 'Kapalı', a.installed && a.device ? launch : null),
      row(a.crash ? 'bad' : a.installed ? 'ok' : '', 'Son çökme', a.crash ? `${a.crash.at ? fmtDate(a.crash.at.includes('T') ? a.crash.at : `${new Date().getFullYear()}-${a.crash.at.replace(' ', 'T')}`) : ''} ${a.crash.detail}` : a.installed ? (p === 'android' ? 'Çökme kaydı yok' : 'Son 3 günde çökme raporu yok') : '—'),
      p === 'android' && a.appLinks?.length ? row(a.appLinks.every((x) => x.ok) ? 'ok' : 'warn', 'App Links doğrulaması',
        a.appLinks.map((x) => `${x.domain}: ${x.ok ? 'doğrulandı' : `doğrulanmadı (${x.state})`}`).join(' · ')) : null);
  };

  // ---- deeplinks
  const dls = cfg.cockpit?.deeplinks || [];
  const dlResults = {};
  const paintDeeplinks = () => {
    if (!dls.length) {
      dlBox.replaceChildren(row('', 'Deeplink tanımlı değil', 'Uygulamanın önemli giriş noktalarını ekle (ürün, kampanya, sepet…); kokpitten cihazda tek tıkla açılıp doğru ekrana gidip gitmediği görülür.', h('button', { class: 'btn plain sm', type: 'button', onclick: () => cockpitLinksSheet(() => showCockpit()) }, 'Ekle')));
      setLamp('deeplinks', 'off', 'tanımlı değil');
      return;
    }
    dlBox.replaceChildren(...dls.map((d, i) => {
      const res = dlResults[i] || {};
      const btn = (p) => h('button', { class: 'btn plain sm', type: 'button', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Açılıyor…';
        try { res[p] = await send(`/api/cockpit/deeplinks/${i}`, 'POST', { platform: p }); }
        catch (x) { res[p] = { ok: false, detail: x.message }; }
        dlResults[i] = res; paintDeeplinks();
      } }, `${PL[p]}'${p === 'ios' ? 'ta' : 'de'} aç`);
      const outs = ['android', 'ios'].filter((p) => res[p]).map((p) => h('div', { class: 'dl-res' },
        res[p].shot ? h('img', { src: res[p].shot, alt: `${PL[p]} ekranı`, class: 'shot' }) : null,
        h('div', {}, h('b', { class: res[p].ok ? 'okt' : res[p].warn ? 'warnt' : 'badt' }, `${PL[p]}: ${res[p].ok ? 'açıldı' : res[p].warn ? 'yanlış yere gitti' : 'açılamadı'}`), h('span', {}, res[p].detail || ''))));
      const st = ['android', 'ios'].some((p) => res[p] && !res[p].ok) ? 'bad' : ['android', 'ios'].some((p) => res[p]) ? 'ok' : '';
      return h('div', { class: 'row stack' },
        h('div', { class: 'row plain' }, h('span', { class: `dot ${st}` }), h('div', { class: 'grow' }, h('b', {}, d.name || d.url), h('span', { class: 'mono' }, d.url)), btn('android'), btn('ios')),
        outs.length ? h('div', { class: 'dl-outs' }, ...outs) : null);
    }));
    const all = Object.values(dlResults).flatMap((r) => Object.values(r));
    setLamp('deeplinks', !all.length ? 'off' : all.some((r) => !r.ok) ? 'bad' : 'ok', !all.length ? `${dls.length} tanımlı · denenmedi` : all.some((r) => !r.ok) ? `${all.filter((r) => !r.ok).length} sorunlu` : 'açılıyor');
  };

  async function load() {
    refresh.disabled = true;
    stamp.textContent = 'Denetleniyor…';
    paintDeeplinks();
    const jobs = [];

    jobs.push(api('/api/health').then((hl) => {
      state.health = hl;
      setLamp('claude', hl.claude.ok ? 'ok' : 'bad', hl.claude.ok ? 'hazır' : 'yok');
      setLamp('jira', !hl.jira.configured ? 'warn' : hl.jira.ok ? 'ok' : 'bad', !hl.jira.configured ? 'bağlı değil' : hl.jira.ok ? 'bağlı' : 'bağlanamadı');
      return hl;
    }));

    jobs.push(api('/api/cockpit/app').then((a) => {
      appBox.replaceChildren(appCard('android', a.android), appCard('ios', a.ios));
      for (const p of ['android', 'ios']) {
        const x = a[p];
        setLamp(p, !x.appId ? 'off' : !x.device ? 'bad' : !x.installed ? 'bad' : x.running ? 'ok' : 'warn',
          !x.appId ? 'ayarlı değil' : !x.device ? 'cihaz yok' : !x.installed ? 'kurulu değil' : x.running ? 'çalışıyor' : 'kapalı');
      }
      const mism = ['android', 'ios'].filter((p) => a[p].installed && a[p].latest && !a[p].latest.error && (a[p].installed.version !== a[p].latest.version || a[p].installed.build !== a[p].latest.build));
      const known = ['android', 'ios'].some((p) => a[p].installed && a[p].latest && !a[p].latest.error);
      setLamp('version', !known ? 'off' : mism.length ? 'warn' : 'ok', !known ? 'karşılaştırılamadı' : mism.length ? `${mism.map((p) => PL[p]).join(', ')} eski` : 'güncel');
      const crashed = ['android', 'ios'].filter((p) => a[p].crash);
      setLamp('crash', crashed.length ? 'bad' : (a.android.installed || a.ios.installed) ? 'ok' : 'off', crashed.length ? crashed.map((p) => PL[p]).join(', ') : 'yok');
      const al = a.android.appLinks || [];
      return al;
    }).catch((e) => { appBox.replaceChildren(h('div', { class: 'msg bad' }, e.message)); return []; }));

    const appLinksJob = jobs[1];
    jobs.push(Promise.all([appLinksJob, dls.some((d) => /^https:/i.test(d.url)) ? api('/api/cockpit/associations') : Promise.resolve({ domains: [] })]).then(([al, r]) => {
      const rows = r.domains.map((d) => h('div', { class: 'row stack' }, h('b', { class: 'mono' }, d.host),
        row(dotOf(d.android), 'Android · assetlinks.json', d.android.detail), row(dotOf(d.ios), 'iOS · apple-app-site-association', d.ios.detail)));
      const unverified = al.filter((x) => !x.ok);
      const bad = r.domains.some((d) => d.android.ok === false || d.ios.ok === false) || unverified.length;
      assocBox.replaceChildren(...(rows.length ? rows : [row('', 'Denetlenecek https bağlantısı yok', 'https ile başlayan deeplink eklersen sitenin uygulamayı tanıyıp tanımadığı burada görünür.')]),
        ...(unverified.length ? [row('warn', 'Emülatörde doğrulanmamış alan adları', `${unverified.map((x) => x.domain).join(', ')}: bu adreslerdeki bağlantılar uygulama yerine tarayıcıda açılabilir.`)] : []));
      setLamp('links', !rows.length && !al.length ? 'off' : bad ? 'warn' : 'ok', !rows.length && !al.length ? 'yok' : bad ? 'eksik var' : 'tamam');
    }).catch(() => setLamp('links', 'off', '—')));

    const eps = cfg.cockpit?.endpoints || [];
    if (!eps.length) {
      epBox.replaceChildren(row('', 'Adres tanımlı değil', 'Uygulamanın bağlı olduğu servislerin sağlık adreslerini ekle (ör. https://api.sirketin.com/health).', h('button', { class: 'btn plain sm', type: 'button', onclick: () => cockpitLinksSheet(() => showCockpit()) }, 'Ekle')));
      setLamp('endpoints', 'off', 'tanımlı değil');
    } else {
      const rows = eps.map((e) => row('', e.name || e.url, 'Bakılıyor…'));
      epBox.replaceChildren(...rows);
      jobs.push(Promise.all(eps.map((e, i) => send(`/api/cockpit/endpoints/${i}`, 'POST').catch((x) => ({ ok: false, detail: x.message })).then((r) => {
        rows[i].replaceWith(rows[i] = row(r.ok ? (r.ms > 3000 ? 'warn' : 'ok') : 'bad', e.name || e.url,
          `${e.name ? `${e.url} · ` : ''}${r.status ? `HTTP ${r.status}` : r.detail || 'yanıt yok'}${r.ms != null ? ` · ${r.ms} ms` : ''}`));
        return r;
      }))).then((rs) => {
        const down = rs.filter((r) => !r.ok).length;
        setLamp('endpoints', down ? 'bad' : rs.some((r) => r.ms > 3000) ? 'warn' : 'ok', down ? `${down}/${rs.length} yanıt vermiyor` : `${rs.length} ayakta`);
      }));
    }

    jobs.push(api('/api/cockpit/tools').then((t) => {
      const hl = state.health || {};
      toolBox.replaceChildren(
        row(dotOf(hl.claude), 'Claude Code', hl.claude?.detail),
        row(hl.jira ? (!hl.jira.configured ? 'warn' : dotOf(hl.jira)) : '', 'Jira', hl.jira?.detail),
        row(dotOf(hl.pdf), 'PDF', hl.pdf?.detail),
        row(dotOf(t.firebase), 'Firebase App Distribution', t.firebase.detail, t.firebase.ok ? null : fbLoginButton(load)),
        row(t.testmu.ok === null ? '' : dotOf(t.testmu), 'TestMu gerçek cihazlar', t.testmu.detail, t.testmu.ok === null ? h('button', { class: 'btn plain sm', type: 'button', onclick: openSettings }, 'Ayarla') : null),
        row(dotOf(t.adb), 'Android araçları', t.adb.detail),
        row(dotOf(t.xcode), 'Xcode simülatörü', t.xcode.detail),
        row(dotOf(t.maestro), 'Maestro', t.maestro.detail),
        row(t.proxyman.ok ? (t.proxyman.warn ? 'warn' : 'ok') : '', 'Proxyman', t.proxyman.detail),
        row(!t.meetingsEnabled ? '' : dotOf(t.meetingJoin), 'Toplantıya Claude ekleme görevi', t.meetingsEnabled ? t.meetingJoin.detail : 'Ayarlardan kapalı'),
        row(!t.meetingsEnabled ? '' : dotOf(t.meetingNotes), 'Toplantı notu görevi', t.meetingsEnabled ? t.meetingNotes.detail : 'Ayarlardan kapalı'),
        (() => { const u = state.update; const b = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
          b.disabled = true; b.textContent = 'Denetleniyor…';
          try { state.update = await api('/api/update?force=1'); if (state.update.behind) showUpdate(state.update); else { b.textContent = 'Güncel'; } } catch (e) { b.textContent = e.message; }
        } }, 'Yeni sürümü denetle');
        return row(!u ? '' : u.behind || u.error ? 'warn' : 'ok', 'qaHere sürümü', !u ? '—' : u.git === false ? 'git ile kurulmadı' : u.error || (u.behind ? `${u.version} · yeni sürüm var` : `${u.version || '—'} · güncel`), u?.git === false ? null : b); })(),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', {}, 'Slack, Notion, Figma gibi kaynak bağlantıları Claude Code üzerinden denetlenir.')),
          h('button', { class: 'btn plain sm', type: 'button', onclick: () => showStatus() }, 'Bağlantıları denetle')));
      setLamp('firebase', t.firebase.ok ? 'ok' : 'bad', t.firebase.ok ? 'giriş var' : 'giriş gerekli');
      setLamp('testmu', t.testmu.ok === null ? 'off' : t.testmu.ok ? 'ok' : 'bad', t.testmu.ok === null ? 'ayarlı değil' : t.testmu.ok ? 'bağlı' : 'bağlanamadı');
      setLamp('proxyman', t.proxyman.ok ? (t.proxyman.warn ? 'warn' : 'ok') : 'off', t.proxyman.ok ? (t.proxyman.warn ? 'kayıt kapalı' : 'kayıtta') : 'kapalı');
      const devTools = [t.adb, t.xcode, t.maestro].filter((x) => !x.ok).length;
      setLamp('tools', devTools ? 'warn' : 'ok', devTools ? `${devTools} eksik` : 'adb · Xcode · Maestro');
      const mt = [t.meetingJoin, t.meetingNotes];
      setLamp('meetings', !t.meetingsEnabled ? 'off' : mt.some((x) => !x.ok && !x.warn) ? 'bad' : mt.some((x) => x.warn) ? 'warn' : 'ok',
        !t.meetingsEnabled ? 'kapalı' : mt.some((x) => !x.ok) ? 'görev çalışmadı' : 'çalışıyor');
      return t;
    }).catch((e) => toolBox.replaceChildren(h('div', { class: 'msg bad' }, e.message))));

    await Promise.allSettled(jobs);
    stamp.textContent = `Son denetim ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
    refresh.disabled = false;
  }
  load();
}

// ---- Güncelleme ---------------------------------------------------------------------------

const UPDATE_LATER = 'qaHere.updateLater';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* yok say */ } } };

const REBUILD_NOTE = 'qaHere.rebuildNote';
let lastUpdateCheck = 0;
async function checkForUpdate() {
  lastUpdateCheck = Date.now();
  try { state.update = await api('/api/update'); } catch { return; }
  const u = state.update;
  // "Sonra" denen sürüm bir daha sorulmaz; daha yeni bir commit gelince yeniden sorulur.
  if (u.behind && u.commits?.[0]?.sha !== store.get(UPDATE_LATER) && !$('#sheet').open) showUpdate(u);
}

function showUpdate(u) {
  const list = h('ul', { class: 'changes' }, ...(u.commits || []).slice(0, 8).map((c) => h('li', {}, c.subject)));
  const more = (u.commits?.length || 0) > 8 ? h('p', { class: 'sub' }, `ve ${u.behind - 8} değişiklik daha`) : null;
  const msg = h('div', {});
  const go = h('button', { class: 'btn sm', type: 'button', disabled: Boolean(u.blocked), onclick: async () => {
    go.disabled = true; later.disabled = true; go.textContent = 'İndiriliyor…';
    try {
      const r = await send('/api/update', 'POST');
      if (r.restart === 'auto') {
        go.textContent = 'Yeniden başlatılıyor…';
        await waitForRestart(r.version);
        if (r.rebuild && isDesktop) store.set(REBUILD_NOTE, r.version);
        // Pencere/menü kodu da değiştiyse masaüstü uygulaması kendini baştan açar (desktop/main.js bu adresi yakalar).
        if (r.shell && isDesktop) location.href = '/__desktop/relaunch';
        else location.reload();
      } else {
        go.textContent = 'İndirildi';
        msg.replaceChildren(h('div', { class: 'msg ok' }, 'Yeni sürüm indirildi. Açmak için terminalde qaHere\'yi kapat (Ctrl+C) ve yeniden ', h('code', {}, 'npm start'), ' çalıştır. Bundan sonraki güncellemeler kendiliğinden yeniden başlar.'));
      }
    } catch (e) {
      go.disabled = false; later.disabled = false; go.textContent = 'Güncelle';
      msg.replaceChildren(h('div', { class: 'msg bad' }, e.message));
    }
  } }, 'Güncelle');
  const later = h('button', { class: 'btn plain sm', type: 'button', onclick: () => { store.set(UPDATE_LATER, u.commits?.[0]?.sha || ''); closeSheet(); } }, 'Sonra');
  openSheet('Yeni sürüm var', h('div', { class: 'update' },
    h('p', {}, `qaHere'nin yeni bir sürümü yayımlandı (${u.behind} değişiklik). Güncelleme birkaç saniye sürer; ayarların, rehberlerin ve işaretlerin olduğu gibi kalır.`),
    h('div', { class: 'group-title' }, 'Neler değişti'),
    list, more,
    u.blocked ? h('div', { class: 'msg bad' }, u.blocked) : null,
    msg,
  ), [later, go]);
}

async function waitForRestart(version) {
  await new Promise((r) => setTimeout(r, 800));
  for (let i = 0; i < 60; i += 1) {
    try {
      const u = await api('/api/update');
      if (!version || u.version === version) return;
    } catch { /* sunucu henüz açılmadı */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ---- Başlangıç --------------------------------------------------------------------------

(async function init() {
  $('.mark').replaceWith(mascot('mark'));
  applyConfig(await api('/api/config'));
  const startHash = location.hash;
  if (!/^#([A-Za-z][A-Za-z0-9]+-\d+|kokpit|cloud)$/.test(startHash)) showWelcome();
  if (!state.config.setupDone) startOnboarding();
  loadHealth().then(() => { if (!state.current && !document.querySelector('.cockpit, .home, .cloud')) showWelcome(); });
  await loadList();
  if (state.config.setupDone) checkForUpdate();
  // Uygulama uzun süre açık kalır: yarım saatte bir ve pencereye dönünce (en az 10 dk arayla) yeniden bakılır.
  const recheck = () => { if (state.config.setupDone && Date.now() - lastUpdateCheck > 10 * 60_000) checkForUpdate(); };
  setInterval(recheck, 30 * 60_000);
  window.addEventListener('focus', recheck);
  if (isDesktop && store.get(REBUILD_NOTE)) {
    openSheet('Uygulamayı yeniden kur', h('div', {},
      h('p', {}, 'Son güncelleme masaüstü uygulamasının altyapısını (Electron) da yeniledi. qaHere çalışmaya devam eder; yeni altyapıya geçmek için qaHere klasöründe bir kez şunu çalıştır:'),
      h('pre', {}, h('code', {}, 'npm run desktop'))),
    [h('button', { class: 'btn sm', type: 'button', onclick: () => { store.set(REBUILD_NOTE, ''); closeSheet(); } }, 'Tamam')]);
  }
  const key = (startHash.slice(1).toUpperCase().match(/^[A-Z][A-Z0-9]+-\d+$/) || [])[0];
  if (key) openIssue(key);
  else if (startHash === '#kokpit' && state.config.setupDone) showCockpit();
  else if (startHash === '#cloud' && state.config.setupDone) showCloud();
  else if (startHash && !document.querySelector('.home')) showWelcome();
})();

// Adres çubuğundaki anahtar elle değiştirilirse o işi aç.
window.addEventListener('hashchange', () => {
  const key = (location.hash.slice(1).toUpperCase().match(/^[A-Z][A-Z0-9]+-\d+$/) || [])[0];
  if (key && key !== state.current) openIssue(key);
  else if (location.hash === '#kokpit' && !document.querySelector('.cockpit')) showCockpit();
  else if (location.hash === '#cloud' && !document.querySelector('.cloud')) showCloud();
});
