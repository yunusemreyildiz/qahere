// Rehber üretimi: Claude Code'u arka planda (headless) çalıştırır, ilerlemeyi olay olarak yayar.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectForGuide, jiraConfigured, jiraBaseUrl } from './jira.js';
import { getSettings, enabledSources, SOURCE_LABELS, ROLES } from './config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Yalnızca OKUMA araçları. Sunucu adı kişiden kişiye değişebildiği için bilinen önekler denenir.
const ATLASSIAN_PREFIXES = ['mcp__claude_ai_Atlassian_MCP__', 'mcp__claude_ai_Atlassian__', 'mcp__atlassian__', 'mcp__plugin_atlassian_atlassian__'];
const READ_TOOLS = {
  jira: {
    prefixes: ATLASSIAN_PREFIXES,
    tools: ['getJiraIssue', 'searchJiraIssuesUsingJql', 'listJiraIssueComments', 'getAccessibleAtlassianResources'],
  },
  confluence: {
    prefixes: ATLASSIAN_PREFIXES,
    tools: ['getConfluenceContent', 'searchConfluence', 'getAccessibleAtlassianResources'],
  },
  slack: {
    prefixes: ['mcp__claude_ai_Slack__', 'mcp__slack__', 'mcp__plugin_slack_slack__'],
    tools: ['slack_search_public_and_private', 'slack_search_public', 'slack_read_thread', 'slack_read_channel', 'slack_read_file', 'slack_read_canvas', 'slack_search_channels', 'slack_search_users'],
  },
  docs: {
    prefixes: ['mcp__claude_ai_Claude_Docs__'],
    tools: ['read'],
  },
  notion: {
    prefixes: ['mcp__claude_ai_Notion__', 'mcp__notion__', 'mcp__plugin_Notion_notion__'],
    tools: ['notion-fetch', 'notion-search'],
  },
  // Proxyman'in kendi MCP sunucusu (claude mcp add -s user proxyman -- …/mcp-server). Yalnızca okuma araçları.
  proxyman: {
    prefixes: ['mcp__proxyman__', 'mcp__Proxyman__'],
    tools: ['get_proxy_status', 'get_flows', 'filter_flows', 'get_flow_detail'],
  },
};

/** Jira her zaman açıktır; diğer kaynaklar Ayarlar'da açık olanlarla sınırlıdır. */
export function allowedTools() {
  const extra = (process.env.CLAUDE_EXTRA_ALLOWED_TOOLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = new Set();
  for (const k of ['jira', ...enabledSources()]) {
    const g = READ_TOOLS[k];
    if (g) for (const p of g.prefixes) for (const t of g.tools) list.add(p + t);
  }
  return [...list, ...extra];
}

const RESEARCH = {
  slack: '**Slack.** Şunları ara (özel kanallar dahil): hedef işin anahtarı, her alt işin anahtarı, ve özelliği ayırt eden 2–4 anahtar kelime (özelliğin adı, uç nokta yolu, ekran adı gibi). Anahtar kelime aramalarını işin oluşturulma tarihinden sonrasıyla sınırla. Yanıtı olan ilgili mesajların thread\'ini oku. Mesaja eklenmiş metin dosyası (md, txt) varsa oku. Derleme (build), canlıya alma ve duyuru kanallarındaki ilgili mesajlara da bak.',
  notion: '**Notion.** Jira açıklamalarında, yorumlarda ya da yazışmalarda geçen Notion bağlantılarını aç ve oku. Bağlantı yoksa özelliğin adıyla bir kez ara.',
  docs: '**Claude Docs.** Jira açıklamalarında, yorumlarda ya da yazışmalarda geçen claude.ai doküman ve artifact bağlantılarını (kontrat, analiz, tasarım notu gibi) oku. Arama yapma; yalnızca bağlantısı verilenleri aç.',
  proxyman: '**Proxyman.** Proxyman açıksa yakalanmış trafiğe bak: rehberde geçen her uç nokta yolu için filter_flows ile (url içerir) en fazla 5 istek listele, her uç nokta için yalnızca en yeni 1 isteğin ayrıntısını oku. Gerçek istek/yanıt alanlarını, durum kodlarını ve hata yanıtlarını kontrat bölümüyle karşılaştır; farkları Çelişkiler bölümüne, örnek yanıtları servis bölümüne kısaca yaz. Kimlik bilgisi (token, cookie, Authorization) yazma. Trafik yoksa bunu bir cümleyle belirt ve devam et.',
  confluence: '**Confluence.** Jira açıklamalarında ya da yorumlarda geçen Confluence sayfalarını oku. Bağlantı yoksa hedef işin anahtarı ve özelliğin adıyla ara; analiz, teknik tasarım ve kontrat sayfalarına öncelik ver.',
};

function researchSteps() {
  const on = enabledSources();
  if (!on.length) return 'Jira dışında açık kaynak yok. Yalnızca Jira içeriğiyle çalış ve rehberin sonunda bunu belirt.';
  return on.map((k, i) => `${i + 1}. ${RESEARCH[k]}`).join('\n');
}

function describeTool(name, input = {}) {
  const short = name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '');
  const q = (v) => (Array.isArray(v) ? v.join(' ') : String(v ?? '')).replace(/"/g, '').slice(0, 70);
  if (/slack_search/.test(name)) return `Slack'te aranıyor: ${q(input.keywords) || q(input.filters) || q(input.natural_language_query)}`;
  if (/slack_read_thread/.test(name)) return 'Slack thread\'i okunuyor';
  if (/slack_read_channel/.test(name)) return 'Slack kanalı okunuyor';
  if (/slack_read_file|slack_read_canvas/.test(name)) return 'Slack\'teki dosya okunuyor';
  if (/notion-fetch/.test(name)) return `Notion sayfası okunuyor: ${q(input.id).replace(/^https?:\/\//, '')}`;
  if (/notion-search/.test(name)) return `Notion'da aranıyor: ${q(input.query)}`;
  if (/getJiraIssue|listJiraIssueComments/.test(name)) return `Jira okunuyor: ${q(input.issueIdOrKey || input.issueKey || input.issue_key)}`;
  if (/searchJiraIssuesUsingJql/.test(name)) return `Jira'da aranıyor: ${q(input.jql)}`;
  if (/Claude_Docs__read/.test(name)) return 'Claude dokümanı okunuyor';
  if (/proxyman__(filter_flows|get_flows)/i.test(name)) return `Proxyman trafiğine bakılıyor${input.value ? `: ${q(input.value)}` : ''}`;
  if (/proxyman__get_flow_detail/i.test(name)) return 'Proxyman isteği okunuyor';
  if (/proxyman__get_proxy_status/i.test(name)) return null;
  if (/getConfluenceContent/.test(name)) return 'Confluence sayfası okunuyor';
  if (/searchConfluence/.test(name)) return `Confluence'ta aranıyor: ${q(input.query || input.cql)}`;
  if (/getAccessibleAtlassianResources/.test(name)) return null;
  if (name === 'ToolSearch') return null;
  if (/__authenticate$|__complete_authentication$/.test(name)) {
    const src = /slack/i.test(name) ? 'Slack' : /notion/i.test(name) ? 'Notion' : /atlassian/i.test(name) ? 'Atlassian (Jira/Confluence)' : /docs/i.test(name) ? 'Claude Docs' : /proxyman/i.test(name) ? 'Proxyman' : short.split('__')[0] || 'Bir kaynak';
    return `${src} bağlantısı oturum açmamış; bu kaynak atlanıyor. Bağlamak için: Durum → Bağlantıları denetle`;
  }
  if (name === 'Read') return 'Büyük bir sonuç parça parça okunuyor';
  if (name === 'Grep' || name === 'Glob') return 'Okunan sonuçların içinde aranıyor';
  return `Araç: ${short}`;
}

/** Rehberi okuyacak kişi: rolü, test ettiği platformlar ve takımı. Boşsa satır eklenmez. */
export function readerLine(profile = getSettings().profile) {
  const parts = [];
  if (profile?.role) parts.push(`rolü: ${ROLES[profile.role]}`);
  const names = { ios: 'iOS', android: 'Android' };
  if (profile?.platforms?.length) parts.push(`test ettiği platform: ${profile.platforms.map((p) => names[p]).join(' ve ')}`);
  if (profile?.boards?.length) parts.push(`takımı: ${profile.boards.map((b) => b.name).join(', ')}`);
  if (!parts.length) return '';
  const one = profile.platforms?.length === 1 ? ` Kontrol listesini ${names[profile.platforms[0]]} için yaz; diğer platformu yalnızca fark varsa "Platform farkları"nda kısaca geç.` : '';
  return `Rehberi okuyacak kişi (${parts.join('; ')}).${one}`;
}

export async function buildPrompt({ key, notes, jiraText, kind = 'feature' }) {
  const tpl = await fs.readFile(path.join(root, 'prompts', 'rehber.md'), 'utf8');
  const bug = kind === 'bug';
  const sections = await fs.readFile(path.join(root, 'prompts', bug ? 'bolumler-hata.md' : 'bolumler-ozellik.md'), 'utf8');
  const jiraSection = jiraText
    ? `Hedef işin ve alt işlerinin Jira içeriği (açıklama, yorumlar, bağlantılar) aşağıda hazır verildi; Jira'dan tekrar çekme. Yalnızca burada adı geçen ama içeriği olmayan bağlı işlere (ör. "şu işteki gibi") ihtiyaç duyarsan Jira aracıyla bak.\n\n<jira_verisi>\n${jiraText}\n</jira_verisi>`
    : `Önce Jira aracıyla ${key} işini oku. Epic ise JQL ile alt işlerini bul (\`parent = ${key}\`) ve her birinin açıklamasını ve yorumlarını oku.`;
  return tpl
    .replaceAll('{{TASK}}', bug
      ? 'Görevin, aşağıdaki hata kaydı için QA ekibinin düzeltmeyi test etmeden önce okuyacağı kısa bir **QA rehberi** hazırlamak: hatayı nasıl yeniden üreteceğini, düzeltmenin nasıl doğrulanacağını ve neyin bozulmuş olabileceğini bilmeli.'
      : 'Görevin, aşağıdaki Jira işi için QA ekibinin test etmeden önce okuyacağı tek bir **QA rehberi** hazırlamak. Okuyan kişi konuyu hiç bilmiyor olabilir; rehberi okuyunca neyi, nasıl, hangi sırayla test edeceğini ve nerede tuzak olduğunu bilmeli.')
    .replaceAll('{{READER}}', readerLine())
    .replaceAll('{{BUDGET}}', bug ? '15' : '30')
    .replaceAll('{{SECTIONS}}', sections.trim())
    .replaceAll('{{KEY}}', key)
    .replaceAll('{{TODAY}}', new Date().toLocaleDateString('tr-TR'))
    .replaceAll('{{NOTES}}', notes ? `Rehberi isteyen kişinin ek notu (içerik tercihi olarak dikkate al): """${notes.slice(0, 600)}"""` : '')
    .replaceAll('{{SOURCE_NAMES}}', ['Jira', ...enabledSources().map((k) => SOURCE_LABELS[k])].join(', '))
    .replaceAll('{{RESEARCH_STEPS}}', researchSteps())
    .replaceAll('{{LINK_RULE}}', jiraBaseUrl()
      ? `Jira işlerine bağlantı ver: \`<a href="${jiraBaseUrl()}/browse/ANAHTAR">ANAHTAR</a>\`. Başka bağlantı ekleme.`
      : 'Bağlantı (`<a>`) ekleme; Jira işlerini yalnızca anahtarıyla yaz.')
    .replaceAll('{{JIRA_SECTION}}', jiraSection);
}

export function extractGuide(text) {
  let body = String(text || '');
  const s = body.indexOf('<!--REHBER-BASLANGIC-->');
  const e = body.lastIndexOf('<!--REHBER-BITIS-->');
  if (s !== -1) body = body.slice(s + '<!--REHBER-BASLANGIC-->'.length, e > s ? e : undefined);
  else body = body.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '');
  let meta = {};
  const m = body.match(/<!--META\s*(\{[\s\S]*?\})\s*-->/);
  if (m) { try { meta = JSON.parse(m[1]); } catch { /* yok say */ } body = body.replace(m[0], ''); }
  return { body: body.trim(), meta };
}

/** Model çıktısı güvenilmez içerikten türediği için: betik, gömülü içerik ve olay özniteliklerini at. */
export function sanitize(html) {
  return String(html)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|svg|img|video|audio)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|svg|img|video|audio)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(?!https:\/\/|#)[^"']*\2/gi, '$1="#"');
}

/**
 * @returns {{ child, done: Promise<{body, meta, stats}> }}
 */
export function runClaude(prompt, { cwd, onEvent }) {
  const bin = process.env.CLAUDE_BIN || 'claude';
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--model', getSettings().model,
    '--allowedTools', ...allowedTools(),
    '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch',
  ];
  const child = spawn(bin, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const timeoutMs = (Number(process.env.GENERATE_TIMEOUT_MIN) || 20) * 60_000;

  const done = new Promise((resolve, reject) => {
    let buf = '';
    let stderr = '';
    let result = null;
    let toolCalls = 0;
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Süre doldu; üretim durduruldu.')); }, timeoutMs);

    const handle = (line) => {
      if (!line.trim()) return;
      let ev; try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'system' && ev.subtype === 'init') {
        const servers = (ev.mcp_servers || []).map((s) => `${s.name}:${s.status}`);
        onEvent({ type: 'init', servers, model: ev.model });
      } else if (ev.type === 'assistant') {
        for (const c of ev.message?.content || []) {
          if (c.type === 'tool_use') {
            toolCalls += 1;
            const msg = describeTool(c.name, c.input);
            if (msg) onEvent({ type: 'step', message: msg });
          } else if (c.type === 'text' && c.text?.includes('REHBER-BASLANGIC')) {
            onEvent({ type: 'step', message: 'Rehber yazılıyor' });
          }
        }
      } else if (ev.type === 'result') {
        result = ev;
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(err.code === 'ENOENT'
        ? 'Claude Code bulunamadı. Kurulu olduğundan ve "claude" komutunun çalıştığından emin ol (README → Kurulum).'
        : err.message));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      handle(buf);
      if (signal) return reject(new Error('Üretim iptal edildi.'));
      if (!result) return reject(new Error(`Claude Code yanıt vermeden kapandı (kod ${code}). ${stderr.slice(-400)}`.trim()));
      if (result.is_error) return reject(new Error(`Claude Code hata döndü: ${String(result.result || result.subtype).slice(0, 400)}`));
      const { body, meta } = extractGuide(result.result);
      if (body.length < 400) return reject(new Error('Claude beklenen biçimde rehber üretmedi. Tekrar dene; sürerse bağlantıları denetle.'));
      resolve({
        body: sanitize(body),
        meta,
        stats: {
          durationMs: result.duration_ms, turns: result.num_turns, toolCalls,
          costUsd: result.total_cost_usd, denials: (result.permission_denials || []).map((d) => d.tool_name),
        },
      });
    });

    child.stdin.end(prompt);
  });

  return { child, done };
}

export async function generateGuide({ key, notes, jobDir, onEvent }) {
  let jiraText = '';
  let tree = null;
  if (jiraConfigured()) {
    try {
      const col = await collectForGuide(key, (m) => onEvent({ type: 'step', message: m }));
      jiraText = col.text;
      tree = { issue: col.issue, children: col.children };
    } catch (e) {
      onEvent({ type: 'step', message: `Jira'dan ön veri alınamadı (${e.message}); Claude kendi bağlantısıyla deneyecek` });
    }
  } else {
    onEvent({ type: 'step', message: 'Jira token\'ı yok; Jira içeriğini Claude kendi bağlantısıyla okuyacak' });
  }
  const kind = tree?.issue?.isBug ? 'bug' : 'feature';
  if (kind === 'bug') onEvent({ type: 'step', message: 'Hata kaydı: yeniden üretme, düzeltme doğrulaması ve regresyon odaklı kısa rehber yazılacak' });
  const prompt = await buildPrompt({ key, notes, jiraText, kind });
  await fs.mkdir(jobDir, { recursive: true });
  onEvent({ type: 'step', message: 'Claude Code başlatılıyor' });
  const run = runClaude(prompt, { cwd: jobDir, onEvent });
  return { ...run, tree };
}
