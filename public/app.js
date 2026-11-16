// qaHere arayüzü. Bağımlılık yok; dışarıdan gelen her metin textContent ile yazılır.
const $ = (s) => document.querySelector(s);

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
  openSheet('Durum', h('div', {},
    h('div', { class: 'group' },
      statusRow('Claude Code', hl.claude), statusRow('Jira', hl.jira && { ...hl.jira, ok: hl.jira.ok }), statusRow('PDF', hl.pdf)),
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
    projects: [...cfg.projects], sources: { ...cfg.sources }, model: cfg.model, accent: cfg.accent };
}

async function saveDraft(d, extra = {}) {
  const body = { workspace: d.workspace, jiraBaseUrl: d.jiraBaseUrl, jiraEmail: d.jiraEmail, projects: d.projects, sources: d.sources, model: d.model, accent: d.accent, ...extra };
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
      d.jiraBaseUrl = r.baseUrl; d.jiraOk = true; known = r.projects;
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
    h('div', { class: 'group-title' }, 'Kaynaklar'), sourcesSection(d),
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
    { title: 'Jira\'yı bağla', lead: 'Epic\'lerini listelemek ve içeriklerini okumak için.', body: () => jiraSection(d), skip: 'Token olmadan devam et' },
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
          h('button', { class: 'btn', type: 'button', onclick: () => { if (i === steps.length - 1) finish(); else { i += 1; render(); } } }, s.next || 'Devam')))));
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

async function loadList() {
  const list = $('#list');
  list.replaceChildren(h('div', { class: 'note' }, 'Yükleniyor…'));
  $('#project').hidden = state.tab !== 'epics' || state.config.projects.length < 2;
  try {
    if (state.tab === 'archive') {
      const { guides } = await api('/api/guides');
      if (!guides.length) return list.replaceChildren(h('div', { class: 'note' }, 'Henüz rehber yok. Bir iş açıp "Rehber oluştur"a bas.'));
      list.replaceChildren(...guides.map((g) => issueItem({ key: g.key, summary: g.title }, () => openIssue(g.key, g.id), h('span', {}, fmtDate(g.createdAt)))));
      return;
    }
    if (!state.config.jiraConfigured) return list.replaceChildren(settingsNote('Epic listesi için Jira\'yı bağla. Bağlamadan da yukarıya işin anahtarını yazıp açabilirsin.', 'Jira\'yı bağla'));
    if (!state.config.projects.length) return list.replaceChildren(settingsNote('Listelenecek proje seçilmedi.', 'Proje seç'));
    const { epics } = await api(`/api/epics?project=${encodeURIComponent($('#project').value)}`);
    list.replaceChildren(...(epics.length ? epics.map((e) => issueItem(e, () => openIssue(e.key))) : [h('div', { class: 'note' }, 'Bu projede epic bulunamadı.')]));
  } catch (e) {
    list.replaceChildren(h('div', { class: 'note' }, h('div', { class: 'msg bad', style: 'margin:0' }, e.message)));
  }
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  state.tab = t.dataset.tab;
  loadList();
}));
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
    h('p', {}, 'Soldan bir epic\'e tıkla ya da anahtarını yaz. Test etmeden önce okunacak rehber birkaç dakikada hazır olur.'),
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
    h('div', { class: 'sub' }, `${sourceNames.join(', ')} taranır${children.length ? ` · ${children.length} alt iş` : ''}. Genelde 3–8 dakika sürer ve Claude kullanım hakkından düşer.${hasGuide ? ' Mevcut rehber silinmez; önceki sürüm olarak kalır.' : ''}`),
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
  const paintProgress = (n, note) => {
    if (!g.checkTotal) return progress.replaceChildren();
    const all = n === g.checkTotal;
    progress.classList.toggle('all', all);
    progress.replaceChildren(
      h('span', { class: 'cnum' }, h('b', {}, String(n)), ` / ${g.checkTotal} kontrol`),
      h('span', { class: 'cbar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(g.checkTotal), 'aria-valuenow': String(n) },
        h('i', { style: `width:${(n / g.checkTotal) * 100}%` })),
      note ? h('span', { class: 'cnote bad' }, note) : h('span', { class: 'cnote' }, all ? 'Tamamı işaretli' : 'Otomatik kaydediliyor'));
  };
  paintProgress(g.checks?.length || 0);

  // Rehber korumalı bir çerçeveye srcdoc ile gömülür: ayrı köken (allow-same-origin yok), dış istek yok.
  // Çalışabilen tek betik, her açılışta üretilen nonce'lu viewer.js; rehber içeriğindeki betikler CSP'ye takılır.
  const frame = h('iframe', { class: 'viewer', title: `${g.key} QA rehberi`, sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox' });
  Promise.all([fetch(`${base}.html`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error('Rehber yüklenemedi.')))), viewerAssets()])
    .then(([html, assets]) => { frame.srcdoc = withViewer(html, assets); })
    .catch((e) => frame.replaceWith(h('div', { class: 'msg bad' }, e.message)));

  // Her tıklama hemen kaydedilir. keepalive: sekme o an kapansa da istek tamamlanır.
  // rev: ağdan geç dönen eski bir isteğin yeni durumu ezmesini önler (sunucu her seferinde tüm listeyi alır).
  let seq = 0;
  state.onChecks = (e) => {
    if (e.source !== frame.contentWindow || e.data?.qa !== 'checks' || !Array.isArray(e.data.checks)) return;
    const checks = e.data.checks.filter(Number.isInteger);
    g.checks = checks;
    paintProgress(checks.length);
    const mine = ++seq;
    fetch(`/api/guides/${g.key}/${g.id}/checks`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checks, rev: Date.now() * 1000 + (mine % 1000) }) })
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); })
      .catch((err) => { if (mine === seq) paintProgress(checks.length, `Kaydedilemedi (${err.message}). Yeniden tıkla.`); });
  };

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
      h('div', { class: 'gtitle' }, h('h2', {}, g.title), h('div', { class: 'sub' }, `${fmtDate(g.createdAt)} · ${stats}`)),
      progress,
      h('div', { class: 'acts' },
        version, kidsBtn, regen,
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
const DENIAL_SOURCES = [[/Claude_Docs/i, 'docs'], [/slack/i, 'slack'], [/notion/i, 'notion'], [/confluence/i, 'confluence']];
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

// ---- Başlangıç --------------------------------------------------------------------------

(async function init() {
  $('.mark').replaceWith(mascot('mark'));
  applyConfig(await api('/api/config'));
  showWelcome();
  if (!state.config.setupDone) startOnboarding();
  loadHealth().then(() => { if (!state.current) showWelcome(); });
  await loadList();
  const key = (location.hash.slice(1).toUpperCase().match(/^[A-Z][A-Z0-9]+-\d+$/) || [])[0];
  if (key) openIssue(key);
})();

// Adres çubuğundaki anahtar elle değiştirilirse o işi aç.
window.addEventListener('hashchange', () => {
  const key = (location.hash.slice(1).toUpperCase().match(/^[A-Z][A-Z0-9]+-\d+$/) || [])[0];
  if (key && key !== state.current) openIssue(key);
});
