// Rehber görüntüleyici. Uygulama bunu rehberin içine nonce'lu satır içi betik olarak koyar (bkz. app.js withViewer).
// Rehber dosyası değişmez: PDF ve "yeni sekmede aç" tam, sıralı raporu gösterir. Burada yalnızca ekrandaki düzen kurulur:
// QA için gerekenler öne, teknik ayrıntılar kapalı bölümlere; soldaki sütunda bölümler ve kontrol ilerlemesi.
(() => {
  const d = document;
  const body = d.body;
  const make = (tag, cls, text) => { const el = d.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };

  // Bölüm türleri: eşleşme sırası önemli ("Akış ve durumlar" başlığı "durum" da içerir).
  const KINDS = [
    { k: 'akis', re: /akış/i, tier: 'test' },
    { k: 'celiski', re: /çelişki|belirsiz/i, tier: 'test' },
    { k: 'kontrol', re: /kontrol/i, tier: 'test' },
    { k: 'hazirlik', re: /hazırl/i, tier: 'test' },
    { k: 'platform', re: /platform/i, tier: 'test' },
    { k: 'harita', re: /iş haritası|alt işler/, tier: 'detay' },
    { k: 'servis', re: /servis|kontrat|uç nokta|endpoint/i, tier: 'detay' },
    { k: 'otomasyon', re: /otomasyon|analyt[iı]cs|event/i, tier: 'detay' },
    { k: 'karar', re: /karar/i, tier: 'detay' },
    { k: 'kime', re: /kime|sorulmal/i, tier: 'detay' },
    { k: 'kaynak', re: /kaynak/i, tier: 'detay' },
    { k: 'durum', re: /durum/i, tier: 'test' },
  ];
  const ORDER = ['ozet', 'durum', 'hazirlik', 'akis', 'celiski', 'kontrol', 'platform', '?', 'kime', 'servis', 'otomasyon', 'harita', 'karar', 'kaynak'];
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
    li.querySelector(':scope > .pf')?.remove(); // PDF/yeni sekme etiketi; burada yerine düğmeler gelir
    const r = {};
    for (const p of ALL) if (OUT[li.dataset[p]]) r[p] = li.dataset[p];
    if (Object.keys(r).length) results[li.dataset.c] = r;
  }
  const res = (li) => results[li.dataset.c] || {};
  const isDone = (li) => platforms.every((p) => res(li)[p] === 'pass' || res(li)[p] === 'na');
  const isFail = (li) => platforms.some((p) => res(li)[p] === 'fail');
  const isOpen = (li) => platforms.some((p) => !res(li)[p]);
  const textOf = (li) => [...li.childNodes].filter((n) => !(n.nodeType === 1 && n.matches('.pfc, .tick'))).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();

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
  meter.append(nums, bar, plRow, next, only);
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
    for (const [v, label] of opts) {
      const o = make('button', `pmi ${v ? `o-${v}` : 'o-clear'}`);
      o.type = 'button';
      o.setAttribute('role', v ? 'menuitemradio' : 'menuitem');
      if (v) o.setAttribute('aria-checked', String(cur === v));
      o.append(make('span', 'pmk', v ? MARK[v] : ''), label);
      o.addEventListener('click', (e) => {
        e.stopPropagation();
        set(li, p, v || null);
        update(li);
        if (v === 'fail') parent.postMessage({ qa: 'fail', c: Number(li.dataset.c), platform: p, text: textOf(li) }, '*');
        closeMenu(true);
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
    const li = items.find(isOpen) || items.find((x) => !isDone(x));
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
  onlyBox.addEventListener('change', () => root.classList.toggle('only-open', onlyBox.checked));
  items.forEach(paintItem);
  paint();

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
