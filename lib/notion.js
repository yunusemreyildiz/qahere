// Herkese açık yayımlanmış Notion sayfalarını (ör. ajansın notion.site sayfasındaki event planı) okur.
// Claude'un Notion bağlantısı yalnızca kullanıcının kendi çalışma alanını görür; başka bir çalışma alanında yayımlanmış
// sayfayı açamaz. qaHere bu sayfaları, Notion'un web arayüzünün kullandığı herkese açık uçla bir kez okuyup rehber
// talimatına düz metin olarak koyar. Yalnızca okuma; giriş bilgisi gönderilmez; yalnızca notion.site / notion.so adresleri.

const MAX_CHUNKS = 8;
const MAX_TEXT = 40_000;

export function notionPageId(url) {
  const m = String(url).match(/([0-9a-f]{32})(?=[?#/]|$)/i) || String(url).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!m) return '';
  const h = m[1].replace(/-/g, '').toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function originOf(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (u.protocol !== 'https:') return '';
  if (/(^|\.)notion\.site$/i.test(u.hostname)) return u.origin;
  if (/^(www\.)?notion\.so$/i.test(u.hostname)) return 'https://www.notion.so';
  return '';
}

async function post(origin, endpoint, body, timeoutMs) {
  const r = await fetch(`${origin}/api/v3/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  if (!r.ok) throw new Error(`Notion ${r.status}`);
  return r.json();
}

// Kayıt biçimi sürümden sürüme { value } ya da { value: { value } } olabiliyor.
const valueOf = (rec) => { const v = rec?.value; return v?.value && typeof v.value === 'object' && v.value.id ? v.value : v; };

/** Notion zengin metni: [["metin", [["a","url"], ["b"]]], ...] */
function rich(prop) {
  if (!Array.isArray(prop)) return '';
  return prop.map(([t, ann]) => {
    const text = String(t ?? '');
    const link = Array.isArray(ann) ? ann.find((a) => a[0] === 'a')?.[1] : null;
    if (text === '‣') return '';
    return link && /^https:\/\//.test(link) && !text.includes(link) ? `${text} <${link}>` : text;
  }).join('');
}

function render(blocks, rootId) {
  const out = [];
  const seen = new Set();
  const walk = (id, depth) => {
    if (seen.has(id) || out.length > 4000) return;
    seen.add(id);
    const b = valueOf(blocks[id]);
    if (!b || b.alive === false) return;
    const pad = '  '.repeat(depth);
    const title = rich(b.properties?.title);
    const kids = () => (b.content || []).forEach((c) => walk(c, depth + 1));
    switch (b.type) {
      case 'page':
        if (id === rootId) { out.push(`# ${title}`); (b.content || []).forEach((c) => walk(c, 0)); }
        else out.push(`${pad}[Alt sayfa: ${title}]`);
        return;
      case 'header': out.push('', `## ${title}`); return kids();
      case 'sub_header': out.push('', `### ${title}`); return kids();
      case 'sub_sub_header': out.push('', `#### ${title}`); return kids();
      case 'bulleted_list': out.push(`${pad}- ${title}`); return kids();
      case 'numbered_list': out.push(`${pad}1. ${title}`); return kids();
      case 'to_do': out.push(`${pad}- [${b.properties?.checked?.[0]?.[0] === 'Yes' ? 'x' : ' '}] ${title}`); return kids();
      case 'toggle': out.push(`${pad}▸ ${title}`); return kids();
      case 'quote': out.push(`${pad}> ${title}`); return kids();
      case 'callout': out.push(`${pad}[Not] ${title}`); return kids();
      case 'code': out.push(`${pad}\`\`\`${rich(b.properties?.language).toLowerCase()}`, title, `${pad}\`\`\``); return;
      case 'divider': out.push('---'); return;
      case 'image': case 'file': case 'pdf': case 'video': out.push(`${pad}[${b.type === 'image' ? 'Görsel' : 'Dosya'}]`); return;
      case 'bookmark': out.push(`${pad}${title || ''} <${rich(b.properties?.link)}>`); return;
      case 'collection_view': case 'collection_view_page': out.push(`${pad}[Notion veritabanı: bu yolla okunamadı]`); return;
      case 'table': {
        const order = b.format?.table_block_column_order || [];
        const rows = (b.content || []).map((r) => valueOf(blocks[r])).filter(Boolean);
        out.push('');
        rows.forEach((r, i) => {
          const cols = order.length ? order : Object.keys(r.properties || {});
          out.push(`| ${cols.map((c) => rich(r.properties?.[c]).replace(/\n/g, ' ').replace(/\|/g, '/')).join(' | ')} |`);
          if (i === 0 && b.format?.table_block_column_header) out.push(`|${cols.map(() => ' --- ').join('|')}|`);
        });
        out.push('');
        return;
      }
      case 'column_list': case 'column': case 'synced_block': case 'transclusion_container': case 'transclusion_reference':
        return (b.content || []).forEach((c) => walk(c, depth));
      default:
        if (title) out.push(`${pad}${title}`);
        return kids();
    }
  };
  walk(rootId, 0);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Herkese açık bir Notion sayfasını düz metne çevirir. Okunamazsa (gizli sayfa, ağ hatası) null döner.
 * @returns {Promise<{ url, title, text } | null>}
 */
export async function readPublicNotion(url, { timeoutMs = 15_000 } = {}) {
  const origin = originOf(url);
  const pageId = notionPageId(url);
  if (!origin || !pageId) return null;
  try {
    const blocks = {};
    let cursor = { stack: [] };
    for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
      const d = await post(origin, 'loadPageChunk', { pageId, limit: 100, cursor, chunkNumber: chunk, verticalColumns: false }, timeoutMs);
      Object.assign(blocks, d.recordMap?.block || {});
      cursor = d.cursor;
      if (!cursor?.stack?.length) break;
    }
    const root = valueOf(blocks[pageId]);
    if (!root) return null;
    const text = render(blocks, pageId);
    if (text.length < 40) return null;
    return { url, title: rich(root.properties?.title), text: text.slice(0, MAX_TEXT) };
  } catch {
    return null;
  }
}
