// Proxyman ile doğrudan konuşma (Claude'suz): Proxyman'in kendi MCP sunucusunu stdio ile çalıştırıp araç çağırır.
// Okuma: durum, yakalanan istekler, istek ayrıntısı. Yazma: yalnızca kullanıcının qaHere'de bastığı düğmeyle
// Map Local (mock) kuralı açma, kapatma, silme. Dışarıya hiçbir şey gitmez; her şey bu bilgisayarda kalır.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const DEFAULT_BIN = '/Applications/Proxyman.app/Contents/MacOS/mcp-server';
export const proxymanBin = () => process.env.PROXYMAN_MCP_BIN || DEFAULT_BIN;
export const proxymanInstalled = () => fs.existsSync(proxymanBin());

const fail = (message, status = 502) => Object.assign(new Error(message), { status });

/** Tek araç çağrısı: süreç açılır, el sıkışılır, çağrılır, kapanır. */
function callTool(name, args = {}, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    if (!proxymanInstalled()) return reject(fail('Proxyman bulunamadı. Proxyman 5 ya da üstünü kur (macOS).', 400));
    const p = spawn(proxymanBin(), [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let settled = false;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); p.kill(); fn(v); };
    const timer = setTimeout(() => finish(reject, fail('Proxyman yanıt vermedi. Uygulama açık mı?')), timeoutMs);
    const send = (o) => p.stdin.write(`${JSON.stringify(o)}\n`);
    p.on('error', () => finish(reject, fail('Proxyman MCP sunucusu başlatılamadı.')));
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) {
          if (m.error) return finish(reject, fail(`Proxyman bağlantısı kurulamadı: ${m.error.message || ''}`));
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
        } else if (m.id === 2) {
          if (m.error) return finish(reject, fail(`Proxyman: ${m.error.message || 'hata'}`));
          const text = (m.result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
          if (m.result?.isError) return finish(reject, fail(`Proxyman: ${text.slice(0, 300) || 'hata'}`));
          finish(resolve, { text, structured: m.result?.structuredContent || null });
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qahere', version: '1' } } });
  });
}

export async function proxymanStatus() {
  if (!proxymanInstalled()) return { installed: false, ok: false, detail: 'Proxyman kurulu değil' };
  try {
    const { text } = await callTool('get_proxy_status', {}, 8_000);
    const recording = /Recording:\s*Active/i.test(text);
    return { installed: true, ok: true, recording, detail: recording ? 'Açık, kayıt yapıyor' : 'Açık ama kayıt kapalı' };
  } catch (e) {
    return { installed: true, ok: false, detail: e.message };
  }
}

/** "1. [GET] https://… → 200 (12ms)\n   ID: 123" satırlarını ayrıştırır; CONNECT tünelleri atlanır. */
function parseFlows(text) {
  const out = [];
  const re = /^\s*\d+\.\s*\[([A-Z]+)\]\s+(\S+)(?:\s*→\s*(\d{3}))?[^\n]*\n\s*ID:\s*(\S+)/gm;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] === 'CONNECT') continue;
    out.push({ id: m[4], method: m[1], url: m[2], status: m[3] ? Number(m[3]) : null });
  }
  return out;
}

export async function listFlows({ q = '', limit = 60 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 60, 1), 300);
  const query = String(q || '').trim().slice(0, 200);
  const { text } = query
    ? await callTool('filter_flows', { key: 'url', matching: 'contains', value: query, limit: lim })
    : await callTool('get_flows', { limit: lim });
  return parseFlows(text);
}

// İstek ayrıntısı hata kaydına eklenirken kimlik bilgileri gizlenir.
const SECRET_HEADER = /^(\s*)(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|[\w-]*token[\w-]*|[\w-]*secret[\w-]*|[\w-]*session[\w-]*)(\s*:\s*)(.+)$/gim;
const SECRET_JSON = /("(?:access_?token|refresh_?token|id_?token|token|password|passwd|secret|api_?key|authorization|cookie|session(?:_?id)?)"\s*:\s*)"[^"]*"/gi;
export const redact = (text) => String(text).replace(SECRET_HEADER, '$1$2$3[gizlendi]').replace(SECRET_JSON, '$1"[gizlendi]"');

export async function flowText(id) {
  const fid = String(id || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!fid) throw fail('Geçersiz istek kimliği.', 400);
  const { text } = await callTool('get_flow_detail', { flow_id: fid });
  // Ayrıntının düz metin kısmı ("=== Flow Details ===" … ); ardından gelen JSON kopyası atlanır.
  const plain = text.split(/\n\{\n/)[0];
  return redact(plain).slice(0, 60_000);
}

const ruleId = (text) => (text.match(/Rule ID:\s*([A-Za-z0-9-]+)/) || [])[1] || '';
const METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

export async function createMock({ name, url, method = 'ANY', status = 200, body = '{}', contentType = 'application/json' }) {
  const u = String(url || '').trim();
  if (!/^https?:\/\/\S+$/.test(u)) throw fail('Mock için geçerli bir adres gir (https://…).', 400);
  const args = {
    name: String(name || 'qaHere').slice(0, 120), url: u.slice(0, 2000),
    method: METHODS.includes(method) ? method : 'ANY',
    status_code: Math.min(Math.max(Number(status) || 200, 100), 599),
    response_body: String(body ?? '').slice(0, 2_000_000), content_type: String(contentType || 'application/json').slice(0, 100),
  };
  const { text } = await callTool('create_map_local', args);
  const id = ruleId(text);
  if (!id) throw fail(`Mock kuruldu mu anlaşılamadı: ${text.slice(0, 200)}`);
  return { id, url: args.url, method: args.method, status: args.status_code };
}

export async function createMockFromFlow({ name, flowId }) {
  const fid = String(flowId || '').replace(/[^\w-]/g, '').slice(0, 40);
  if (!fid) throw fail('Geçersiz istek kimliği.', 400);
  const { text } = await callTool('create_map_local_from_flow', { flow_id: fid, name: String(name || 'qaHere').slice(0, 120) });
  const id = ruleId(text);
  if (!id) throw fail(`Mock kuruldu mu anlaşılamadı: ${text.slice(0, 200)}`);
  return { id };
}

const safeRule = (id) => String(id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
export const setMockEnabled = (id, enabled) => callTool('toggle_rule', { id: safeRule(id), rule_type: 'maplocal', enabled: Boolean(enabled) });
export const deleteMock = (id) => callTool('delete_rule', { id: safeRule(id), rule_type: 'maplocal' });
