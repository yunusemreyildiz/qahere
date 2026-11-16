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

  // 4) Kontrol maddeleri
  const items = [...d.querySelectorAll('.chk li[data-c]')];
  const isDone = (li) => li.hasAttribute('data-done');
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
  const bar = make('div', 'bar');
  const fill = make('i');
  bar.append(fill);
  const next = make('button', 'next', 'Sıradaki kontrole git');
  next.type = 'button';
  const only = make('label', 'only');
  const onlyBox = make('input');
  onlyBox.type = 'checkbox';
  only.append(onlyBox, ' Yalnız işaretlenmemişler');
  const nums = make('div', 'nums');
  nums.append(num, of);
  meter.append(nums, bar, next, only);
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
    num.textContent = String(done);
    of.textContent = ` / ${items.length} kontrol`;
    fill.style.width = `${items.length ? (done / items.length) * 100 : 0}%`;
    meter.classList.toggle('all', items.length > 0 && done === items.length);
    next.disabled = done === items.length;
    for (const c of counters) {
      const k = c.items.filter(isDone).length;
      c.el.textContent = `${k}/${c.items.length}`;
      c.el.classList.toggle('all', k === c.items.length);
    }
  };

  const mark = (li) => li.setAttribute('aria-checked', isDone(li) ? 'true' : 'false');
  for (const li of items) { li.tabIndex = 0; li.setAttribute('role', 'checkbox'); mark(li); }
  const report = () => parent.postMessage({ qa: 'checks', checks: items.filter(isDone).map((li) => Number(li.dataset.c)) }, '*');
  const toggle = (li) => { li.toggleAttribute('data-done'); mark(li); paint(); report(); };
  d.addEventListener('click', (e) => {
    const li = e.target.closest('.chk li[data-c]');
    if (!li || e.target.closest('a') || String(getSelection()).trim()) return;
    toggle(li);
  });
  d.addEventListener('keydown', (e) => {
    const li = e.target.closest && e.target.closest('.chk li[data-c]');
    if (li && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggle(li); }
  });
  next.addEventListener('click', () => {
    const li = items.find((x) => !isDone(x));
    if (!li) return;
    const det = li.closest('details');
    if (det) det.open = true;
    li.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    li.focus({ preventScroll: true });
    li.classList.remove('flash');
    void li.offsetWidth;
    li.classList.add('flash');
  });
  onlyBox.addEventListener('change', () => d.documentElement.classList.toggle('only-open', onlyBox.checked));
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
