// Rehber görüntüleyici. Uygulama bunu rehberin içine nonce'lu satır içi betik olarak koyar (bkz. app.js withViewer).
// Rehber dosyası değişmez: PDF ve "yeni sekmede aç" tam, sıralı raporu gösterir. Burada yalnızca ekrandaki düzen kurulur:
// QA için gerekenler öne, teknik ayrıntılar kapalı bölümlere; soldaki sütunda bölümler ve kontrol ilerlemesi.
(() => {
  const d = document;
  const body = d.body;
  const make = (tag, cls, text) => { const el = d.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };

  // Bölüm türleri: eşleşme sırası önemli ("Akış ve durumlar" başlığı "durum" da içerir).
  const KINDS = [
    { k: 'uretme', re: /yeniden üret|nasıl üretilir/i, tier: 'test' },
    { k: 'koken', re: /kök neden/i, tier: 'detay' },
    { k: 'sira', re: /test sırası|iş sırası|hangi sırayla/i, tier: 'test' },
    { k: 'akis', re: /akış/i, tier: 'test' },
    { k: 'celiski', re: /çelişki|belirsiz/i, tier: 'test' },
    { k: 'kontrol', re: /kontrol/i, tier: 'test' },
    { k: 'ortam', re: /ortam hazırl|ortam ve|cihaz|paket/i, tier: 'test' },
    { k: 'hazirlik', re: /hazırl/i, tier: 'test' },
    { k: 'platform', re: /platform/i, tier: 'test' },
    { k: 'harita', re: /iş haritası|alt işler/, tier: 'detay' },
    { k: 'servis', re: /servis|kontrat|uç nokta|endpoint/i, tier: 'detay' },
    { k: 'event', re: /analytics event|event plan|eventler/i, tier: 'test' },
    { k: 'otomasyon', re: /otomasyon|analyt[iı]cs|event/i, tier: 'detay' },
    { k: 'karar', re: /karar/i, tier: 'detay' },
    { k: 'kime', re: /kime|sorulmal/i, tier: 'detay' },
    { k: 'kaynak', re: /kaynak/i, tier: 'detay' },
    { k: 'durum', re: /durum/i, tier: 'test' },
  ];
  const ORDER = ['ozet', 'durum', 'ortam', 'hazirlik', 'uretme', 'celiski', 'sira', 'akis', 'kontrol', 'event', 'platform', '?', 'kime', 'servis', 'otomasyon', 'harita', 'koken', 'karar', 'kaynak'];
  const clean = (t) => t.replace(/\s+/g, ' ').trim().replace(/^\d+[.)]\s*/, '');

  const cover = body.querySelector(':scope > .cover');
  const foot = body.querySelector(':scope > .foot');
  const nodes = [...body.children].filter((n) => n !== cover && n !== foot && n.tagName !== 'SCRIPT');

  // 1) Başlıklara göre böl
  const sections = [];
  let cur = { k: 'ozet', tier: 'test', title: 'Özet', nodes: [] };
  for (const n of nodes) {
    if (n.tagName === 'H2') {
      if (cur.nodes.length) sections.push(cur);
      const title = clean(n.textContent);
      const kind = KINDS.find((x) => x.re.test(title.toLocaleLowerCase('tr')));
      const tierAttr = (n.getAttribute('data-tier') || '').toLowerCase();
      cur = { k: kind ? kind.k : '?', tier: tierAttr === 'detay' || tierAttr === 'test' ? tierAttr : (kind ? kind.tier : 'test'), title, h2: n, nodes: [] };
      n.textContent = title;
    } else cur.nodes.push(n);
  }
  if (cur.nodes.length || cur.h2) sections.push(cur);
  if (!sections.length) return;
  sections.forEach((s, i) => { s.id = `s-${s.k === '?' ? 'b' : s.k}-${i}`; s.rank = ORDER.indexOf(s.k); s.i = i; });
  sections.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'test' ? -1 : 1) || a.rank - b.rank || a.i - b.i);

  // 2) Ekran düzeni
  d.documentElement.classList.add('live');
  const shell = make('div', 'vw');
  const rail = make('nav', 'rail');
  rail.setAttribute('aria-label', 'Rehber bölümleri');
  const doc = make('main', 'doc');
  if (cover) doc.append(cover);

  const testWrap = make('div', 'tier-test');
  const detailWrap = make('div', 'tier-detail');
  for (const s of sections) {
    if (s.tier === 'test') {
      const sec = make('section', `sec k-${s.k}`);
      sec.id = s.id;
      if (s.h2) sec.append(s.h2);
      sec.append(...s.nodes);
      s.el = sec;
      testWrap.append(sec);
    } else {
      const det = make('details', `more k-${s.k}`);
      det.id = s.id;
      const sum = make('summary');
      sum.append(make('span', 'more-t', s.title));
      const tables = s.nodes.flatMap((x) => (x.matches?.('table') ? [x] : [...(x.querySelectorAll?.('table') || [])]));
      const rows = tables.reduce((n, t) => n + t.querySelectorAll('tr').length - (t.querySelector('th') ? 1 : 0), 0);
      const items = s.nodes.reduce((n, x) => n + (x.matches?.('ul,ol') ? x.children.length : 0), 0);
      const hint = rows > 0 ? `${rows} satır` : items > 0 ? `${items} madde` : '';
      if (hint) sum.append(make('span', 'more-n', hint));
      det.append(sum);
      const inner = make('div', 'more-b');
      inner.append(...s.nodes);
      det.append(inner);
      if (s.h2) s.h2.remove();
      s.el = det;
      detailWrap.append(det);
    }
  }
  doc.append(testWrap);
  if (detailWrap.children.length) {
    const head = make('div', 'detail-head');
    head.append(make('h2', '', 'Ayrıntılar'), make('p', '', 'Teknik arka plan ve kayıtlar. Testi bunlar olmadan da yürütebilirsin; bir yerde takılırsan aç.'));
    doc.append(head, detailWrap);
  }
  if (foot) doc.append(foot);
  shell.append(rail, doc);
  body.append(shell);

  // 3) Okumayı kolaylaştıran küçük dönüşümler
  for (const s of sections.filter((x) => x.k === 'akis')) {
    s.el.querySelector(':scope > ol')?.classList.add('steps');
    s.el.querySelectorAll('table').forEach((t) => { if ((t.rows[0]?.cells.length || 0) === 2) t.classList.add('pairs'); });
  }
  const summary = sections.find((x) => x.k === 'ozet');
  summary?.el?.classList.add('lead');

  // 4) Kontrol maddeleri: her madde platform başına Geçti / Kaldı / Uygulanmaz taşır.
  // Madde, rehberin tüm platformlarında geçti ya da uygulanmaz olunca biter (üstü çizilir).
  const root = d.documentElement;
  const ALL = ['ios', 'android'];
  const PL = {
    ios: { label: 'iOS', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.5-3.7zM14.1 5.9c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z"/></svg>' },
    android: { label: 'Android', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.5 18a8.5 8.5 0 0 1 17 0z"/><path d="M7.2 10.8 5.4 7.6M16.8 10.8l1.8-3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8.6" cy="14.6" r="1.15" fill="#fff"/><circle cx="15.4" cy="14.6" r="1.15" fill="#fff"/></svg>' },
  };
  const OUT = { pass: 'Geçti', fail: 'Kaldı', na: 'Uygulanmaz' };
  const MARK = { pass: '✓', fail: '✕', na: '–' };
  let platforms = (root.dataset.platforms || '').split(/\s+/).filter((p) => ALL.includes(p));
  if (!platforms.length) platforms = [...ALL];

  const items = [...d.querySelectorAll('.chk li[data-c]')];
  const results = {};
  for (const li of items) {
    // PDF/yeni sekme etiketi; burada yerine düğmeler gelir. Hata kaydı bağlantıları korunur.
    const pf = li.querySelector(':scope > .pf');
    const refs = pf ? [...pf.querySelectorAll('a.bugref')] : [];
    pf?.remove();
    if (refs.length) { const bx = make('span', 'bugs'); bx.append(...refs); li.append(bx); }
    const r = {};
    for (const p of ALL) if (OUT[li.dataset[p]]) r[p] = li.dataset[p];
    if (Object.keys(r).length) results[li.dataset.c] = r;
  }
  const res = (li) => results[li.dataset.c] || {};
  const isDone = (li) => platforms.every((p) => res(li)[p] === 'pass' || res(li)[p] === 'na');
  const isFail = (li) => platforms.some((p) => res(li)[p] === 'fail');
  const isOpen = (li) => platforms.some((p) => !res(li)[p]);
  const textOf = (li) => [...li.childNodes].filter((n) => !(n.nodeType === 1 && n.matches('.pfc, .tick, .bugs, .upd-tag, .upd-why'))).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
  const sectionOf = (li) => {
    let h = null;
    for (const el of (li.closest('.sec, details') || d).querySelectorAll('h3, .chk li[data-c]')) { if (el === li) break; if (el.tagName === 'H3') h = el; }
    if (!h) return '';
    const t = h.cloneNode(true); // başlığa eklenen koşu düğmeleri metne karışmasın
    t.querySelectorAll('.grun').forEach((x) => x.remove());
    return clean(t.textContent);
  };
  const askBug = (li, p) => parent.postMessage({ qa: 'fail', c: Number(li.dataset.c), platform: p, text: textOf(li), section: sectionOf(li) }, '*');

  const groupsOf = (sec) => {
    const out = [];
    let g = null;
    for (const el of sec.querySelectorAll('h3, .chk li[data-c]')) {
      if (el.tagName === 'H3') { g = { h3: el, title: clean(el.textContent), items: [] }; out.push(g); continue; }
      if (!g) { g = { h3: null, title: 'Maddeler', items: [] }; out.push(g); }
      g.items.push(el);
    }
    return out.filter((x) => x.items.length);
  };

  // 5) Sol sütun
  const meter = make('div', 'meter');
  const num = make('b');
  const of = make('span');
  const failN = make('span', 'failn');
  const bar = make('div', 'bar');
  const fill = make('i');
  bar.append(fill);
  const next = make('button', 'next', 'Sıradaki kontrole git');
  next.type = 'button';
  const only = make('label', 'only');
  const onlyBox = make('input');
  onlyBox.type = 'checkbox';
  only.append(onlyBox, ' Yalnız bitmemişler');
  const nums = make('div', 'nums');
  nums.append(num, of, failN);
  const plRow = make('div', 'plrow');
  plRow.append(make('span', 'pll', 'Platformlar'));
  const plBtns = ALL.map((p) => {
    const b = make('button', `plt p-${p}`);
    b.type = 'button';
    b.innerHTML = PL[p].icon;
    b.append(PL[p].label);
    b.addEventListener('click', () => {
      const on = platforms.includes(p);
      if (on && platforms.length === 1) return; // en az bir platform kalır
      platforms = ALL.filter((x) => (x === p ? !on : platforms.includes(x)));
      root.dataset.platforms = platforms.join(' ');
      items.forEach(paintItem); paint(); report();
    });
    plRow.append(b);
    return b;
  });
  // Epic'te iş iş ilerleme: kontrol listesinin "ANAHTAR · iş adı" alt başlıkları, Test sırası bölümündeki sırayla.
  const curBtn = make('button', 'curtask');
  curBtn.type = 'button';
  curBtn.hidden = true;
  meter.append(nums, bar, curBtn, plRow, next, only);
  if (items.length) rail.append(meter);

  const counters = [];
  const links = new Map();
  const addLink = (list, s, label, target, extra) => {
    const li = make('li');
    const b = make('button', 'to');
    b.type = 'button';
    b.append(make('span', 't', label));
    if (extra) b.append(extra);
    b.addEventListener('click', () => go(target));
    li.append(b);
    list.append(li);
    return li;
  };
  const go = (el) => {
    const det = el.closest('details');
    if (det) det.open = true;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  const buildGroup = (label, tier) => {
    const secs = sections.filter((x) => x.tier === tier);
    if (!secs.length) return;
    rail.append(make('p', 'grp', label));
    const ul = make('ul', 'links');
    for (const s of secs) {
      const its = [...s.el.querySelectorAll('.chk li[data-c]')];
      let extra = null;
      if (its.length) { extra = make('span', 'n'); counters.push({ el: extra, items: its }); } else if (s.k === 'celiski') {
        const c = s.el.querySelectorAll('.box.bad li, .box.warn li').length || s.el.querySelectorAll('.box.bad, .box.warn').length;
        if (c) { extra = make('span', 'n warn', String(c)); extra.title = `${c} açık nokta`; }
      }
      const li = addLink(ul, s, s.title, s.el, extra);
      links.set(s.el, li.firstChild);
      if (s.k === 'kontrol') {
        const sub = make('ul', 'subs');
        for (const g of groupsOf(s.el)) {
          const n = make('span', 'n');
          counters.push({ el: n, items: g.items });
          addLink(sub, s, g.title, g.h3 || g.items[0], n);
        }
        if (sub.children.length) li.append(sub);
      }
    }
    rail.append(ul);
  };
  buildGroup('Test için', 'test');
  buildGroup('Ayrıntılar', 'detay');

  const KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;
  const kontrolSec = sections.find((s) => s.k === 'kontrol');
  const taskGroups = kontrolSec ? groupsOf(kontrolSec.el).filter((g) => KEY.test(g.title)).map((g) => ({ ...g, key: g.title.match(KEY)[0], keys: g.title.match(new RegExp(KEY.source, 'g')) })) : [];
  const orderEls = [...d.querySelectorAll('ol.order > li[data-key]')];
  const orderKeys = orderEls.map((li) => li.dataset.key);
  // Test sırası varsa o sırayla; yoksa kontrol listesindeki sırayla.
  const tasks = orderKeys.length
    ? [...orderKeys.map((k) => taskGroups.find((g) => g.key === k)).filter(Boolean), ...taskGroups.filter((g) => !orderKeys.includes(g.key))]
    : taskGroups;
  const orderBadges = orderEls.map((li) => {
    const g = taskGroups.find((x) => x.key === li.dataset.key);
    if (!g) return null;
    const n = make('button', 'n ord');
    n.type = 'button';
    n.title = 'Bu işin kontrollerine git';
    n.addEventListener('click', () => go(g.h3 || g.items[0]));
    li.append(' ', n);
    return { li, g, n };
  }).filter(Boolean);
  // Şu anki iş: işaretlenmemiş maddesi olan ilk iş. "Kaldı" işaretli madde düzeltme bekler; sırayı tutmaz.
  const currentTask = () => tasks.find((g) => g.items.some(isOpen));

  // İş (ya da alt başlık) başına toplu simülatör koşusu: maddeler sırayla koşturulur (uygulama yönetir).
  const runGroup = (g, p) => parent.postMessage({ qa: 'runGroup', platform: p, title: g.title, items: g.items.map((li) => ({
    c: Number(li.dataset.c), text: textOf(li), section: sectionOf(li), state: res(li)[p] || '' })) }, '*');
  const runButtons = (g) => {
    const box = make('span', 'grun');
    for (const p of ALL) {
      const b = make('button', `grun-b p-${p}`);
      b.type = 'button';
      b.dataset.p = p;
      b.title = `${g.title}: maddeleri ${p === 'ios' ? 'iOS simülatöründe' : 'Android emülatöründe'} sırayla koş`;
      b.innerHTML = PL[p].icon;
      b.append(make('span', '', '▶'));
      b.addEventListener('click', (e) => { e.stopPropagation(); runGroup(g, p); });
      box.append(b);
    }
    return box;
  };
  const runBoxes = [];
  if (kontrolSec) for (const g of groupsOf(kontrolSec.el)) if (g.h3 && g.items.length) { const bx = runButtons(g); g.h3.append(bx); runBoxes.push(bx); }
  for (const o of orderBadges) { const bx = runButtons(o.g); o.li.append(bx); runBoxes.push(bx); }
  // Firebase'deki sürümler: uygulama iş anahtarlarına göre gönderir; iş başlıklarında, Test sırasında ve kartta görünür.
  const buildTargets = [...tasks.map((g) => ({ keys: g.keys, el: g.h3 })), ...orderBadges.map((o) => ({ keys: [o.li.dataset.key], el: o.li }))].filter((x) => x.el);
  parent.postMessage({ qa: 'taskKeys', keys: [...new Set(tasks.flatMap((g) => g.keys))] }, '*');
  let builds = null;
  const buildChip = (keysIn) => {
    if (!builds?.platforms?.length) return null;
    const keys = [].concat(keysIn).filter(Boolean);
    const box = make('span', 'bld');
    const shown = builds.platforms.filter((x) => platforms.includes(x));
    // Başlıkta birden fazla iş olabilir (ör. iOS işi / Android işi): her platform için o platformda bulunan anahtar.
    const findIn = (p) => keys.map((k) => ({ k, b: builds[p]?.[k] })).find((x) => x.b);
    // Tek anahtarlı başlıkta iş platforma özel olabilir: bulunduğu platform gösterilir, diğeri için uyarı verilmez.
    // Birden fazla anahtar varsa (ör. "iOS işi / Android işi") bulunamayan platform "sürümde yok" diye gösterilir.
    const anyFound = keys.length < 2 && shown.some((p) => findIn(p));
    const key = keys.join(' / ');
    for (const p of shown) {
      const hit = findIn(p);
      const b = hit?.b;
      if (!b && anyFound) continue;
      const s = make('span', `bld-p${b ? '' : ' none'}`);
      s.innerHTML = PL[p].icon;
      s.append(b ? `${b.latest.version} (${b.latest.build})` : 'sürümde yok');
      s.title = b ? `${PL[p].label}: ${hit.k} ilk kez ${b.first.version} (${b.first.build}) ile geldi; en son ${b.latest.version} (${b.latest.build})` : `${PL[p].label}: ${key} henüz bir Firebase sürümünün notunda yok`;
      box.append(s);
    }
    return box.children.length ? box : null;
  };
  const paintBuilds = () => {
    d.querySelectorAll('.bld').forEach((x) => x.remove());
    for (const t of buildTargets) { const c = buildChip(t.keys); if (c) t.el.append(c); }
    if (!tasks.length && builds?.guideKey) { const c = buildChip(builds.guideKey); if (c) { c.classList.add('bld-meter'); meter.insertBefore(c, plRow); } }
  };
  addEventListener('message', (e) => { if (e.source === parent && e.data?.qa === 'builds' && e.data.data) { builds = e.data.data; paintBuilds(); paint(); } });

  const paintRunBoxes = () => runBoxes.forEach((bx) => bx.querySelectorAll('button').forEach((b) => { b.hidden = !platforms.includes(b.dataset.p); }));
  curBtn.addEventListener('click', () => { const g = currentTask(); if (g) go(g.h3 || g.items[0]); });

  const paint = () => {
    const done = items.filter(isDone).length;
    const failed = items.filter(isFail).length;
    num.textContent = String(done);
    of.textContent = ` / ${items.length} kontrol`;
    failN.textContent = failed ? `${failed} kaldı` : '';
    fill.style.width = `${items.length ? (done / items.length) * 100 : 0}%`;
    meter.classList.toggle('all', items.length > 0 && done === items.length);
    next.disabled = done === items.length;
    plBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(platforms.includes(ALL[i]))));
    paintRunBoxes();
    if (tasks.length > 1) {
      const g = currentTask();
      const i = g ? tasks.indexOf(g) : tasks.length;
      curBtn.hidden = false;
      curBtn.classList.toggle('all', !g);
      const failedAll = items.filter(isFail).length;
      curBtn.replaceChildren(make('span', 'ct-l', g ? `Şu anki iş · ${i + 1}/${tasks.length}` : failedAll ? `${tasks.length} iş test edildi · ${failedAll} madde düzeltme bekliyor` : `${tasks.length} işin hepsi bitti`),
        ...(g ? [make('span', 'ct-t', g.title), make('span', 'ct-n', `${g.items.filter(isDone).length}/${g.items.length} kontrol`)] : []));
      const chip = g && buildChip(g.keys || g.key);
      if (chip) curBtn.append(chip);
    }
    for (const o of orderBadges) {
      const k = o.g.items.filter(isDone).length;
      const f = o.g.items.filter(isFail).length;
      const marked = !o.g.items.some(isOpen);
      o.n.textContent = k === o.g.items.length ? '✓ bitti' : marked && f ? `${f} kaldı` : `${k}/${o.g.items.length}`;
      o.n.classList.toggle('all', k === o.g.items.length);
      o.n.classList.toggle('warn', marked && f > 0);
      o.li.classList.toggle('done', marked);
      o.li.classList.toggle('now', o.g === currentTask());
    }
    for (const c of counters) {
      const k = c.items.filter(isDone).length;
      const f = c.items.filter(isFail).length;
      c.el.textContent = `${k}/${c.items.length}`;
      c.el.classList.toggle('all', k === c.items.length);
      c.el.classList.toggle('warn', f > 0);
      c.el.title = f ? `${f} madde kaldı` : '';
    }
  };

  // Madde düzeni: solda "hepsi geçti" kutusu, sağda platform düğmeleri.
  const chips = new Map();
  for (const li of items) {
    const tick = make('button', 'tick');
    tick.type = 'button';
    li.prepend(tick);
    const box = make('span', 'pfc');
    const map = {};
    for (const p of ALL) {
      const b = make('button', `pl p-${p}`);
      b.type = 'button';
      b.dataset.p = p;
      b.setAttribute('aria-haspopup', 'menu');
      b.innerHTML = PL[p].icon;
      b.append(make('span', 'mk'));
      b.addEventListener('click', (e) => { e.stopPropagation(); openMenu(li, p, b); });
      map[p] = b;
      box.append(b);
    }
    chips.set(li, { tick, map });
    li.append(box);
    tick.addEventListener('click', (e) => { e.stopPropagation(); toggleAll(li); });
  }

  function paintItem(li) {
    const r = res(li);
    li.toggleAttribute('data-done', isDone(li));
    li.toggleAttribute('data-fail', isFail(li));
    li.style.setProperty('--pls', String(platforms.length));
    const { tick, map } = chips.get(li);
    tick.setAttribute('aria-pressed', String(isDone(li)));
    tick.setAttribute('aria-label', isDone(li) ? 'Bitti; işaretleri kaldır' : 'Tüm platformlarda geçti olarak işaretle');
    for (const p of ALL) {
      const b = map[p];
      b.hidden = !platforms.includes(p);
      const st = r[p] || '';
      b.dataset.s = st;
      b.querySelector('.mk').textContent = st ? MARK[st] : '';
      const label = `${PL[p].label}: ${st ? OUT[st].toLocaleLowerCase('tr') : 'işaretlenmedi'}`;
      b.setAttribute('aria-label', label);
      b.title = label;
    }
  }

  const report = () => parent.postMessage({ qa: 'results', platforms, results }, '*');
  const set = (li, p, v) => {
    const n = li.dataset.c;
    const r = { ...(results[n] || {}) };
    if (v) r[p] = v; else delete r[p];
    if (Object.keys(r).length) results[n] = r; else delete results[n];
  };
  const update = (li) => { paintItem(li); paint(); report(); };
  function toggleAll(li) {
    const allPass = platforms.every((p) => res(li)[p] === 'pass' || res(li)[p] === 'na') && platforms.some((p) => res(li)[p] === 'pass');
    for (const p of platforms) {
      if (allPass) { if (res(li)[p] === 'pass') set(li, p, null); }
      else if (res(li)[p] !== 'na') set(li, p, 'pass');
    }
    update(li);
  }

  // Platform menüsü
  const menu = make('div', 'pmenu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  body.append(menu);
  let menuFor = null;
  const closeMenu = (focus) => {
    if (menu.hidden) return;
    menu.hidden = true;
    if (focus && menuFor) menuFor.btn.focus();
    menuFor = null;
  };
  function openMenu(li, p, btn) {
    if (menuFor && menuFor.btn === btn) return closeMenu(true);
    menuFor = { li, p, btn };
    const cur = res(li)[p] || '';
    menu.replaceChildren(make('div', 'pmh', PL[p].label));
    const opts = [['pass', 'Geçti'], ['fail', 'Kaldı'], ['na', 'Bu platformda uygulanmaz']];
    if (cur) opts.push(['', 'İşareti kaldır']);
    opts.push(['run', p === 'ios' ? 'iOS simülatöründe koş…' : 'Android emülatöründe koş…']);
    if (cur === 'fail') opts.push(['bug', 'Hata kaydı aç']);
    opts.push(['mock', 'Mock ile test et…']);
    for (const [v, label] of opts) {
      const o = make('button', `pmi ${v ? `o-${v}` : 'o-clear'}`);
      o.type = 'button';
      const isState = v && !['bug', 'mock', 'run'].includes(v);
      o.setAttribute('role', isState ? 'menuitemradio' : 'menuitem');
      if (isState) o.setAttribute('aria-checked', String(cur === v));
      o.append(make('span', 'pmk', MARK[v] || ({ bug: '+', mock: '⇄', run: '▶' }[v] || '')), label);
      o.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu(true);
        if (v === 'bug') return askBug(li, p);
        if (v === 'mock') return parent.postMessage({ qa: 'mock', c: Number(li.dataset.c), text: textOf(li) }, '*');
        if (v === 'run') return parent.postMessage({ qa: 'run', c: Number(li.dataset.c), platform: p, text: textOf(li), section: sectionOf(li) }, '*');
        set(li, p, v || null);
        update(li);
        if (v === 'fail') askBug(li, p);
      });
      menu.append(o);
    }
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + scrollX}px`;
    menu.style.top = `${r.bottom + 6 + scrollY}px`;
    menu.querySelector('[aria-checked="true"]')?.focus() || menu.querySelector('.pmi')?.focus();
  }
  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll('.pmi')];
    const i = list.indexOf(d.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Tab') closeMenu(false);
  });
  d.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(false); });
  addEventListener('resize', () => closeMenu(false));

  // Maddenin metnine tıklamak da "hepsi geçti" kısayoludur (bağlantı ve metin seçimi hariç).
  d.addEventListener('click', (e) => {
    const li = e.target.closest('.chk li[data-c]');
    if (!li || e.target.closest('a, button') || String(getSelection()).trim()) return;
    toggleAll(li);
  });
  next.addEventListener('click', () => {
    // İş sırası varsa önce şu anki işin bitmemiş maddesi; işler tek tek biter.
    const g = tasks.length > 1 ? currentTask() : null;
    const li = (g && (g.items.find(isOpen) || g.items.find((x) => !isDone(x)))) || items.find(isOpen) || items.find((x) => !isDone(x));
    if (!li) return;
    const det = li.closest('details');
    if (det) det.open = true;
    li.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    const first = platforms.find((p) => !res(li)[p]) || platforms[0];
    chips.get(li).map[first].focus({ preventScroll: true });
    li.classList.remove('flash');
    void li.offsetWidth;
    li.classList.add('flash');
  });
  // Uygulama, açılan hata kaydını bildirir: maddeye bağlantısı eklenir.
  // Uygulama, simülatör koşusunun sonucunu işler.
  addEventListener('message', (e) => {
    if (e.source !== parent || e.data?.qa !== 'set') return;
    const { c, platform: p, value } = e.data;
    const li = items.find((x) => Number(x.dataset.c) === c);
    if (!li || !ALL.includes(p) || !['pass', 'fail', 'na', null].includes(value)) return;
    set(li, p, value);
    update(li);
  });
  addEventListener('message', (e) => {
    if (e.source !== parent || e.data?.qa !== 'bug') return;
    const { c, key, url } = e.data;
    const li = items.find((x) => Number(x.dataset.c) === c);
    if (!li || !/^[A-Z][A-Z0-9]+-\d+$/.test(key) || !/^https:\/\//.test(url)) return;
    let bx = li.querySelector(':scope > .bugs');
    if (!bx) { bx = make('span', 'bugs'); li.insertBefore(bx, chips.get(li).map.ios.parentNode); }
    if ([...bx.children].some((a) => a.textContent === key)) return;
    const a = make('a', 'bugref', key);
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.title = 'Hata kaydı';
    bx.append(a);
  });
  onlyBox.addEventListener('change', () => root.classList.toggle('only-open', onlyBox.checked));
  items.forEach(paintItem);
  paint();

  // Mock yanıtı blokları: tek tıkla qaHere'nin "Mock ile test" penceresine dolu gider (Proxyman kuralını qaHere kurar).
  d.querySelectorAll('pre.mock').forEach((pre) => {
    let h = pre.previousElementSibling;
    while (h && !/^H[2-4]$/.test(h.tagName)) h = h.previousElementSibling;
    const btn = make('button', 'mockgo', "Proxyman'e kur");
    btn.type = 'button';
    btn.addEventListener('click', () => parent.postMessage({ qa: 'mockblock', title: (h?.textContent || '').trim().slice(0, 300), text: pre.textContent.slice(0, 20000) }, '*'));
    pre.after(btn);
  });

  // 6) Hangi bölümdeyim
  const spy = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      links.forEach((b) => b.removeAttribute('aria-current'));
      links.get(en.target)?.setAttribute('aria-current', 'true');
    }
  }, { rootMargin: '-8% 0px -75% 0px' });
  sections.forEach((s) => spy.observe(s.el));
})();
