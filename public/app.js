// qaHere arayüzü. Bağımlılık yok; dışarıdan gelen her metin textContent ile yazılır.
const $ = (s) => document.querySelector(s);

// Masaüstü uygulamasında (desktop/main.js kullanıcı ajanına "qaHereDesktop" ekler) üst çubuk pencerenin başlığı olur.
if (/\bqaHereDesktop\b/.test(navigator.userAgent)) {
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
  { key: 'docs', name: 'Claude Docs', desc: 'İşlerde bağlantısı verilen claude.ai doküman ve artifact\'leri' },
  { key: 'proxyman', name: 'Proxyman', desc: 'Yakalanan gerçek istek ve yanıtlar (kontratla karşılaştırma). Claude Code\'a bir kez eklenir: claude mcp add -s user proxyman -- /Applications/Proxyman.app/Contents/MacOS/mcp-server' },
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
  const dot = $('#statusBtn .dot');
  try {
    const hl = await api('/api/health');
    state.health = hl;
    const bad = !hl.claude.ok || (hl.jira.configured && !hl.jira.ok);
    const warn = !hl.jira.configured || !hl.pdf.ok;
    dot.className = `dot ${bad ? 'bad' : warn ? 'warn' : 'ok'}`;
    $('#statusText').textContent = !hl.claude.ok ? 'Claude Code bulunamadı' : hl.jira.configured && !hl.jira.ok ? 'Jira\'ya bağlanılamadı' : !hl.jira.configured ? 'Jira bağlı değil' : 'Hazır';
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

function statusRow(name, x) {
  return h('div', { class: 'row' },
    h('span', { class: `dot ${x ? (x.ok ? 'ok' : 'bad') : ''}` }),
    h('div', { class: 'grow' }, h('b', {}, name)),
    h('div', { class: 'val' }, x?.detail || '—'));
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
      ...(extra ? [...on.map((s) => statusRow(s.name, extra[s.key])), statusRow('Atlassian', extra.atlassian)]
        : [h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', {}, 'Bağlantılar Claude Code üzerinden denetlenir. Yarım dakika sürebilir.')), btn)])),
    extra ? h('div', { class: 'group-foot' }, 'Bir kaynak "Giriş gerekiyor" diyorsa terminalde claude yazıp /mcp ile giriş yap. Atlassian bağlantısı yalnızca Jira token\'ı girilmediyse gerekir.') : null,
  ), [h('button', { class: 'btn sm', type: 'button', onclick: closeSheet }, 'Bitti')]);
}
$('#statusBtn').addEventListener('click', () => showStatus());

// ---- Ayar bölümleri (kurulum ve Ayarlar sayfası ortak kullanır) ------------------------

function draftFrom(cfg) {
  return { workspace: cfg.workspace, jiraBaseUrl: cfg.jiraBaseUrl, jiraEmail: cfg.jiraEmail, jiraApiToken: '', hasToken: cfg.hasToken,
    projects: [...cfg.projects], sources: { ...cfg.sources }, model: cfg.model, accent: cfg.accent,
    bug: JSON.parse(JSON.stringify(cfg.bug || {})), run: JSON.parse(JSON.stringify(cfg.run || { ios: {}, android: {} })),
    profile: JSON.parse(JSON.stringify(cfg.profile || { role: '', platforms: [], boards: [] })) };
}

async function saveDraft(d, extra = {}) {
  const body = { workspace: d.workspace, jiraBaseUrl: d.jiraBaseUrl, jiraEmail: d.jiraEmail, projects: d.projects, sources: d.sources, model: d.model, accent: d.accent, bug: d.bug, run: d.run, profile: d.profile, ...extra };
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
  const btn = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Denetleniyor…';
    try {
      const r = await api('/api/health/connectors');
      for (const s of SOURCES) { marks[s.key].textContent = r[s.key]?.detail || ''; marks[s.key].style.color = r[s.key]?.ok ? 'var(--ok)' : 'var(--warn)'; }
      btn.textContent = 'Yeniden denetle';
    } catch (e) { btn.textContent = 'Denetlenemedi'; }
    btn.disabled = false;
  } }, 'Bağlantıları denetle');
  return h('div', {},
    h('div', { class: 'group' }, ...SOURCES.map((s) => {
      marks[s.key] = h('span', {}, '');
      const sw = h('input', { type: 'checkbox', class: 'switch', 'aria-label': s.name, onchange: () => { d.sources[s.key] = sw.checked; } });
      sw.checked = Boolean(d.sources[s.key]);
      return h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', {}, s.name), h('span', {}, s.desc), marks[s.key]), sw);
    })),
    h('div', { class: 'group-foot' }, 'Bu kaynaklara Claude hesabındaki bağlantılarla ulaşılır. Açmak için claude.ai → Ayarlar → Bağlayıcılar bölümünden ilgili uygulamayı bağla. Araç yalnızca senin görebildiğin içeriği okur; hiçbir yere yazmaz.'),
    h('div', { class: 'group' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', {}, 'Seçtiklerinin Claude Code\'da bağlı olup olmadığını gör. Yarım dakika sürebilir.')), btn)),
  );
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
    h('div', { class: 'group-title' }, 'Hata kaydı'), bugSection(d),
    h('div', { class: 'group-title' }, 'Simülatörde koşu'), runSection(d),
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

function showWelcome() {
  state.current = null;
  const cfg = state.config;
  const hl = state.health;
  $('#main').replaceChildren(wrap(h('div', { class: 'hero' }, h('div', { class: 'hero-in' },
    h('h1', {}, 'Bir iş seç'),
    h('p', {}, 'Soldan bir epic\'e ya da hataya tıkla, ya da anahtarını yaz. Test etmeden önce okunacak rehber birkaç dakikada hazır olur.'),
    hl && !hl.claude.ok ? h('div', { class: 'callout' }, h('div', {}, h('b', {}, 'Claude Code bulunamadı'), h('span', {}, 'Rehber üretimi onsuz çalışmaz.')), h('button', { class: 'btn sm', type: 'button', onclick: startOnboarding }, 'Kurulumu aç')) : null,
    !cfg.jiraConfigured ? h('div', { class: 'callout' }, h('div', {}, h('b', {}, 'Jira bağlı değil'), h('span', {}, 'Epic listesi ve başlıkla arama için bağla.')), h('button', { class: 'btn sm', type: 'button', onclick: openSettings }, 'Bağla')) : null,
  ))));
}

async function openIssue(key, guideId) {
  state.current = key;
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

  box.replaceChildren(
    h('div', { class: 'gbar' },
      // İşin başlığı hemen üstte ve rehberin kendisinde yazıyor; burada rehberin ne zaman, nasıl üretildiği.
      h('div', { class: 'gtitle' }, h('h2', {}, `${fmtDate(g.createdAt)} tarihli rehber`), h('div', { class: 'sub' }, stats)),
      progress,
      h('div', { class: 'acts' },
        version, kidsBtn, mocksBtn, regen,
        h('a', { class: 'btn plain sm', href: `${base}.html`, target: '_blank', rel: 'noopener', title: 'Tam rapor, düz sırayla' }, 'Yeni sekmede aç'),
        h('a', { class: 'btn sm', href: `${base}.pdf` }, 'PDF indir'),
        del)),
    ...denialNotes(g),
    frame);
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
const DENIAL_SOURCES = [[/Claude_Docs/i, 'docs'], [/slack/i, 'slack'], [/notion/i, 'notion'], [/confluence/i, 'confluence'], [/proxyman/i, 'proxyman']];
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
  try {
    const { jobId } = await send('/api/guides', 'POST', { key, notes: $('#notes')?.value || '' });
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
  const finish = () => { clearInterval(tick); es.close(); if ($('#genBtn')) $('#genBtn').disabled = false; };
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

function openBugSheet({ g, frame, c, platform, item, section, preset = {} }) {
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
    const err = h('div', {});
    const back = h('button', { class: 'btn link sm', type: 'button', onclick: step1 }, 'Geri');
    const copy = h('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(`${title.value}\n\n${desc.value}`); copy.textContent = 'Kopyalandı'; } catch { copy.textContent = 'Kopyalanamadı'; }
    } }, 'Metni kopyala');
    const go = h('button', { class: 'btn sm', type: 'button', disabled: !state.config.jiraConfigured, onclick: async () => {
      go.disabled = true; back.disabled = true; go.textContent = 'Açılıyor…'; err.replaceChildren();
      try {
        const r = await send('/api/bugs', 'POST', { storyKey: g.key, guideId: g.id, c, platform: pl, summary: title.value, description: desc.value, images: f.images, flows: f.flows.map((x) => x.id) });
        frame.contentWindow?.postMessage({ qa: 'bug', c, key: r.key, url: r.url }, '*');
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

function openMockSheet({ g, c, item, onChange }) {
  const f = { url: '', method: 'GET', status: 200, body: '', flow: null };
  const urlIn = h('input', { class: 'input', placeholder: 'https://api.ornek.com/v1/kuponlar', spellcheck: 'false', oninput: () => { f.url = urlIn.value.trim(); f.flow = null; paintSrc(); } });
  const methodSel = h('select', { class: 'input', onchange: () => { f.method = methodSel.value; } }, ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'].map((m) => h('option', { value: m }, m)));
  const statusIn = h('input', { class: 'input', type: 'number', min: '100', max: '599', value: '200', oninput: () => { f.status = Number(statusIn.value) || 200; } });
  const body = h('textarea', { class: 'input mono', rows: '10', spellcheck: 'false', placeholder: '{ "items": [] }', oninput: () => { f.body = body.value; } });
  let sample = '';
  const srcBox = h('div', {});
  const useCaptured = h('label', { class: 'only-row' }, h('input', { type: 'checkbox' }), ' Yakalanan yanıtı olduğu gibi kullan (gövde yazmadan)');
  const paintSrc = () => {
    useCaptured.hidden = !f.flow;
    srcBox.replaceChildren(...(f.flow ? [h('div', { class: 'msg ok' }, `Seçilen istek: ${f.flow.method} ${f.flow.url.replace(/^https?:\/\//, '')}${f.flow.status ? ` → ${f.flow.status}` : ''}`)] : []));
  };
  const picker = flowPicker({ q: guessPath(item), pickLabel: 'Seç', onPick: async (fl) => {
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
    h('div', { class: 'f' }, 'Hangi istek? Uygulamada ekranı açtıysan yakalanan istekten seç.', picker),
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
  api('/api/devices').then((x) => { dev.textContent = x[platform] ? `Cihaz: ${x[platform].name}` : (platform === 'ios' ? 'Açık iOS simülatörü yok.' : 'Bağlı Android cihaz yok.'); }).catch(() => {});
  const note = h('div', {});
  const out = h('div', {});
  const setNote = (cls, text) => note.replaceChildren(...(text ? [h('div', { class: `msg ${cls}` }, text)] : []));

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
    try { job = await send('/api/runs', 'POST', ids); } catch (e) { setNote('bad', e.message); runBtn.disabled = false; write.disabled = false; runBtn.textContent = 'Koş'; return; }
    const log = h('pre', { class: 'runlog' });
    const stop = h('button', { class: 'btn plain sm', type: 'button', onclick: () => send(`/api/runs/${job.id}/cancel`, 'POST').catch(() => {}) }, 'Durdur');
    out.replaceChildren(h('div', { class: 'runhead' }, h('span', { class: 'spinner' }), h('b', {}, `${PLN} üzerinde koşuyor`), stop), log);
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
    if (job.status === 'pass') {
      frame.contentWindow?.postMessage({ qa: 'set', c, platform, value: 'pass' }, '*');
      out.replaceChildren(h('div', { class: 'msg ok' }, `Geçti (${secs} sn). Madde ${PLN} için "geçti" olarak işaretlendi.`), log);
    } else if (job.status === 'fail') {
      frame.contentWindow?.postMessage({ qa: 'set', c, platform, value: 'fail' }, '*');
      const bugBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => openBugSheet({ g, frame, c, platform, item, section,
        preset: { happened: `Otomasyon koşusunda (Maestro, ${PLN}) adım başarısız oldu:\n${job.message}`, images: job.image ? [job.image] : [] } }) }, 'Hata kaydı aç');
      out.replaceChildren(
        h('div', { class: 'msg bad' }, h('b', {}, `Kaldı (${secs} sn).`), h('pre', { class: 'runmsg' }, job.message)),
        job.image ? h('figure', { class: 'shot big' }, h('img', { src: `data:${job.image.type};base64,${job.image.data}`, alt: 'Koşu bittiğindeki ekran' })) : null,
        h('div', { class: 'runacts' }, bugBtn, h('span', { class: 'hint' }, 'Akış hatalıysa (yanlış kimlik gibi) yukarıda düzeltip yeniden koş; madde işaretini de elle değiştirebilirsin.')),
        log);
    } else {
      out.replaceChildren(h('div', { class: 'msg warn' }, job.message || 'Koşu tamamlanamadı.'), log);
    }
  } }, 'Koş');

  openSheet(platform === 'ios' ? 'iOS simülatöründe koş' : 'Android emülatöründe koş', h('div', { class: 'bugform' },
    h('p', { class: 'bug-item run' }, h('span', {}, section || 'Test maddesi'), item),
    h('div', { class: 'between' }, h('div', { class: 'grow' }, dev), write),
    h('label', { class: 'f' }, 'Maestro akışı', yaml),
    h('p', { class: 'hint' }, 'Akış bu madde ve platform için saklanır; sonraki koşular Claude kullanmaz. Uygulama kimliği ve ön akış Ayarlar → Simülatörde koşu bölümünden gelir.'),
    note, out,
  ), [h('button', { class: 'btn link sm', type: 'button', onclick: closeSheet }, 'Kapat'), runBtn]);

  api(`/api/flows?${q}`).then((r) => {
    yaml.value = r.yaml || ''; saved = yaml.value;
    if (!r.yaml) setNote('', state.config.run?.[platform]?.appId ? 'Bu madde için henüz akış yok. "Claude yazsın" rehberdeki otomasyon kimliklerinden kısa bir akış yazar; ya da kendin yaz.'
      : `Önce Ayarlar → Simülatörde koşu bölümünde ${platform === 'ios' ? 'iOS bundle id' : 'Android paket adı'} gir.`);
  }).catch((e) => setNote('bad', e.message));
}

// ---- Güncelleme ---------------------------------------------------------------------------

const UPDATE_LATER = 'qaHere.updateLater';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* yok say */ } } };

async function checkForUpdate() {
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
        location.reload();
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
  showWelcome();
  if (!state.config.setupDone) startOnboarding();
  loadHealth().then(() => { if (!state.current) showWelcome(); });
  await loadList();
  if (state.config.setupDone) checkForUpdate();
  const key = (location.hash.slice(1).toUpperCase().match(/^[A-Z][A-Z0-9]+-\d+$/) || [])[0];
  if (key) openIssue(key);
})();

// Adres çubuğundaki anahtar elle değiştirilirse o işi aç.
window.addEventListener('hashchange', () => {
  const key = (location.hash.slice(1).toUpperCase().match(/^[A-Z][A-Z0-9]+-\d+$/) || [])[0];
  if (key && key !== state.current) openIssue(key);
});
