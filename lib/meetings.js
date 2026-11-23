// Toplantı notları: Claude Meetings'in kararlarını rehbere taşır.
// qaHere'nin arkasındaki Claude Code, Claude Meetings'i okuyamaz (izin yok). Notları, Claude Desktop'taki zamanlanmış
// görev ("qaHere toplantı notları") okuyup data/meetings/ altına yerel Markdown dosyası olarak yazar; qaHere burada
// yalnızca bu dosyaları okur. Dosyalar git'e girmez ve hiçbir yere gönderilmez.
//
// Dosya biçimi (görev yazar):
// ---
// toplanti: [Desk-Check] Çark
// tarih: 2026-11-19T12:00:00Z
// isler: PROJ-12, PROJ-13
// konular: Çark, Gamification
// kaynak: claude-meetings:<uuid>
// ---
// ## Özet … ## Kararlar … ## Açık sorular … ## Aksiyonlar …
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './config.js';

export const meetingsDir = path.join(dataDir, 'meetings');
const MAX_NOTE = 8000;

function parse(text, file) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const head = {};
  if (m) for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) head[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return {
    file,
    title: head.toplanti || path.basename(file, '.md'),
    date: head.tarih || '',
    keys: (head.isler || '').split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z][A-Z0-9]+-\d+$/.test(s)),
    topics: (head.konular || '').split(',').map((s) => s.trim()).filter(Boolean),
    body: (m ? m[2] : text).trim().slice(0, MAX_NOTE),
  };
}

export async function allNotes() {
  let files = [];
  try { files = (await fs.readdir(meetingsDir)).filter((f) => f.endsWith('.md')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const p = path.join(meetingsDir, f);
      const [text, st] = await Promise.all([fs.readFile(p, 'utf8'), fs.stat(p)]);
      out.push({ ...parse(text, f), writtenAt: st.mtime.toISOString() });
    } catch { /* bozuk dosya */ }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

const norm = (s) => String(s || '').toLocaleLowerCase('tr');

/** İşe (anahtarlar ya da başlıktaki konu) ait notlar; since verilirse yalnızca o tarihten sonra yazılanlar. */
export async function notesFor({ keys = [], title = '', since = '' } = {}) {
  const want = new Set(keys.map((k) => String(k).toUpperCase()));
  const t = norm(title);
  const t0 = since ? Date.parse(since) : 0;
  return (await allNotes()).filter((n) => {
    const related = n.keys.some((k) => want.has(k)) || (t && n.topics.some((x) => x.length > 2 && (t.includes(norm(x)) || norm(x).includes(t))));
    return related && (!t0 || Date.parse(n.writtenAt) > t0 || Date.parse(n.date) > t0);
  });
}

export function notesPrompt(notes) {
  if (!notes.length) return '';
  return `\n\nBu işle ilgili toplantıların notları (Claude Meetings'ten, Claude Desktop'taki görev çıkardı). Toplantı kararları en güncel ve en etkili bilgidir: kararları Kararlar'a tarih ve "toplantı: <ad>" kaynağıyla yaz; Jira ya da dokümanlarla çelişeni Çelişkiler'e, teste etkisi olanı kontrol listesine işle. Karar mı fikir mi belli değilse belirt.\n${notes.map((n) => `\n<toplanti_notu ad="${n.title.replace(/"/g, "'")}" tarih="${n.date}" isler="${n.keys.join(', ')}">\n${n.body}\n</toplanti_notu>`).join('\n')}`;
}

// ---- Toplantılara Claude'u ekleme görevi ---------------------------------------------------
// Claude Desktop'taki "qaHere toplantılara Claude ekle" görevi her çalışmada yaklaşan toplantıları ve kararını
// data/meetings/.yaklasan.json'a yazar: { guncellendi, toplantilar: [{ id, baslik, baslangic, karar, neden }] }.
// karar: eklendi | eklenecek | atlandi | kaldirildi | hata. Kullanıcının seçimleri settings.json → meetings.overrides.
const readJson = async (f) => { try { return JSON.parse(await fs.readFile(path.join(meetingsDir, f), 'utf8')); } catch { return null; } };
const mtime = async (f) => { try { return (await fs.stat(path.join(meetingsDir, f))).mtime.toISOString(); } catch { return ''; } };

export async function meetingsOverview() {
  const [up, durum, joinAt, notes] = await Promise.all([readJson('.yaklasan.json'), readJson('.durum.json'), mtime('.yaklasan.json'), allNotes()]);
  const list = Array.isArray(up?.toplantilar) ? up.toplantilar : [];
  return {
    upcoming: list.filter((m) => m && m.id && m.baslik).slice(0, 60).map((m) => ({
      id: String(m.id).slice(0, 200), title: String(m.baslik).slice(0, 200), start: String(m.baslangic || ''),
      decision: String(m.karar || ''), reason: String(m.neden || '').slice(0, 200),
    })),
    joinRunAt: up?.guncellendi || joinAt,
    notesRunAt: durum?.sonCalisma || '',
    notes: notes.slice(0, 10).map((n) => ({ title: n.title, date: n.date, keys: n.keys, file: n.file })),
  };
}
