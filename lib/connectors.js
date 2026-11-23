// Kullanıcının Claude'daki diğer bağlantıları (Google Sheets, Linear, Miro…) qaHere'ye ek kaynak olarak eklenir.
// Kural yine aynı: Claude'a yalnızca OKUMA araçları açılır. Bir bağlantının araçları ToolSearch'ün döndürdüğü
// tanımlardan (Claude'un yazdığı metinden değil) okunur; adı ve açıklaması okuma işi anlatan araçlar açılır, yazan /
// gönderen / silen her araç kapalı kalır. Kullanıcı hangi araçların açılacağını görür ve onaylar.
import { spawn } from 'node:child_process';
import os from 'node:os';

// qaHere'nin kendi kaynakları ve yerel araçlar ayrıca yönetilir; listede gösterilmez.
// Meetings da listelenmez: Claude Code'da "user:projects:read" izni olmadığı için araçları qaHere'den çalışmıyor.
const BUILT_IN = /^(claude\.ai )?(slack|notion|atlassian( mcp)?|figma|meetings|claude docs|proxyman)$/i;

const READ_NAME = /(^|[_\-.])(get|list|read|search|fetch|query|find|view|describe|show|whoami|lookup|retrieve|download|export|preview|summar)/i;
const WRITE_NAME = /(create|update|delete|remove|send|post|write|edit|add|insert|upload|move|share|set_|_set|transition|publish|archive|trash|label|reply|forward|schedule|cancel|complete|resolve|restore|duplicate|copy|append|clear|execute|run|react|invite|assign|merge|approve|close|open_|start|stop|import|sync|save|mark|pin|rename|comment)/i;
const WRITE_DESC = /\b(creates?|updates?|deletes?|removes?|sends?|posts?|writes?|edits?|modif(y|ies)|uploads?|moves?|shares?|publishes?|archives?|schedules?|cancels?)\b/i;

export const prefixOf = (server) => `mcp__${String(server).replace(/[^A-Za-z0-9]/g, '_')}__`;

/** "claude mcp list" çıktısından ek bağlantılar: [{ name, connected, needsAuth }] */
export function parseMcpList(out) {
  const list = [];
  for (const line of String(out).split('\n')) {
    const m = line.match(/^(.+?):\s+\S.*\s-\s+(.*)$/);
    if (!m) continue;
    const name = m[1].trim();
    if (BUILT_IN.test(name)) continue;
    list.push({ name, connected: /✔|✓|connected/i.test(m[2]) && !/auth/i.test(m[2]), needsAuth: /auth/i.test(m[2]) });
  }
  return list;
}

export function classify(tools) {
  const read = [];
  const skipped = [];
  for (const t of tools) {
    const short = t.name.split('__').pop();
    const isRead = READ_NAME.test(short) && !WRITE_NAME.test(short) && !WRITE_DESC.test((t.description || '').split(/[.\n]/)[0]);
    (isRead ? read : skipped).push(short);
  }
  return { read, skipped };
}

/** Bir bağlantının araçlarını ToolSearch sonucundan okur. Hiçbir bağlantı aracı çağrılmaz. */
export function inspectConnector(server, { timeoutMs = 180_000 } = {}) {
  const prefix = prefixOf(server);
  const token = prefix.slice(5, -2); // mcp__X__ → X
  return new Promise((resolve, reject) => {
    const bin = process.env.CLAUDE_BIN || 'claude';
    // --effort low: aksi hâlde model aramayı çağırmadan dakikalarca düşünme döngüsünde kalabiliyor.
    const child = spawn(bin, ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--effort', 'low',
      '--allowedTools', 'ToolSearch', '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'], {
      cwd: os.tmpdir(), env: { ...process.env, MAX_THINKING_TOKENS: '0' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const found = new Map();
    let buf = '';
    let settled = false;
    const seen = []; // zaman aşımında neyin beklendiğini anlatmak için
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const tools = [...found.values()];
      if (!tools.length) return reject(new Error(`${server} bağlantısının araçları bulunamadı. Bağlantı claude.ai'de açık ve girişli mi?`));
      resolve({ server, prefix, ...classify(tools) });
    };
    const timer = setTimeout(() => { child.kill('SIGTERM'); settled = true; reject(new Error(`Bağlantı zamanında listelenemedi (${seen.slice(-4).join(' → ') || 'Claude yanıt vermedi'}).`)); }, timeoutMs);
    const handle = (line) => {
      let ev; try { ev = JSON.parse(line); } catch { return; }
      seen.push(ev.subtype ? `${ev.type}:${ev.subtype}` : ev.type);
      // Güvenlik: ToolSearch dışında bir araç çağrısı görülürse hemen durdurulur ve başarısız sayılır.
      for (const c of ev.message?.content || []) if (c.type === 'tool_use' && c.name !== 'ToolSearch') { child.kill('SIGKILL'); settled = true; clearTimeout(timer); reject(new Error(`Beklenmeyen araç çağrısı (${c.name}); durduruldu.`)); return; }
      for (const c of ev.message?.content || []) {
        if (c.type !== 'tool_result') continue;
        const text = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('\n') : String(c.content || '');
        // Yeni sürümler araçları metin değil "tool_reference" bloğu olarak döner (yalnızca ad).
        if (Array.isArray(c.content)) for (const x of c.content) if (x?.type === 'tool_reference' && String(x.tool_name || '').startsWith(prefix)) found.set(x.tool_name, { name: x.tool_name, description: '' });
        for (const m of text.matchAll(/<function>(\{[\s\S]*?\})<\/function>/g)) {
          try { const d = JSON.parse(m[1]); if (d.name?.startsWith(prefix)) found.set(d.name, { name: d.name, description: d.description || '' }); } catch { /* yok say */ }
        }
        // Araç listesi geldi: Claude'un devam etmesini beklemeden bitir. Boşsa bağlantı henüz yükleniyor olabilir; Claude yeniden arar.
        if (found.size) { child.kill('SIGTERM'); finish(); }
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) !== -1) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => { handle(buf); finish(); });
    child.stdin.end(`Call the ToolSearch tool with query "${token.replace(/^claude_ai_/, '').replace(/_/g, ' ').toLowerCase()}" and max_results 100. Connectors load in the background, so if it finds nothing, call ToolSearch again with the same query; repeat up to 10 times until it returns tools. Do not call any other tool and do nothing else.`);
  });
}
