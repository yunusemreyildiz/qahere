// Bu bilgisayardaki iOS simülatörü ve Android emülatörü/cihazı: bulma ve ekran görüntüsü. Dışarıya bir şey gitmez.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const run = (bin, args, { timeout = 15_000, buffer = false } = {}) => new Promise((resolve) => {
  execFile(bin, args, { timeout, encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 60 * 1024 * 1024 }, (err, stdout) => resolve({ ok: !err, out: stdout }));
});

/** Açık iOS simülatörü (ilk "Booted"). */
export async function iosDevice() {
  const r = await run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']);
  if (!r.ok) return null;
  try {
    const all = Object.values(JSON.parse(r.out).devices || {}).flat();
    const d = all.find((x) => x.state === 'Booted');
    return d ? { id: d.udid, name: d.name } : null;
  } catch { return null; }
}

/** Bağlı Android emülatörü ya da cihazı (ilk "device" durumundaki). */
export async function androidDevice() {
  const r = await run('adb', ['devices']);
  if (!r.ok) return null;
  const line = String(r.out).split('\n').slice(1).map((l) => l.trim().split(/\s+/)).find((p) => p[1] === 'device');
  return line ? { id: line[0], name: line[0].startsWith('emulator-') ? `Emülatör (${line[0]})` : line[0] } : null;
}

export async function devices() {
  const [ios, android] = await Promise.all([iosDevice(), androidDevice()]);
  return { ios, android };
}

export async function screenshot(platform, deviceId) {
  if (platform === 'ios') {
    const id = deviceId || (await iosDevice())?.id;
    if (!id) throw Object.assign(new Error('Açık bir iOS simülatörü bulunamadı.'), { status: 400 });
    const tmp = path.join(os.tmpdir(), `qahere-shot-${crypto.randomUUID()}.png`);
    try {
      const r = await run('xcrun', ['simctl', 'io', id, 'screenshot', '--type=png', tmp], { timeout: 20_000 });
      if (!r.ok) throw Object.assign(new Error('iOS simülatöründen ekran görüntüsü alınamadı.'), { status: 400 });
      return { name: 'ios-ekran.png', type: 'image/png', data: (await fs.readFile(tmp)).toString('base64') };
    } finally { fs.rm(tmp, { force: true }).catch(() => {}); }
  }
  if (platform === 'android') {
    const id = deviceId || (await androidDevice())?.id;
    if (!id) throw Object.assign(new Error('Bağlı bir Android emülatörü ya da cihazı bulunamadı.'), { status: 400 });
    const r = await run('adb', ['-s', id, 'exec-out', 'screencap', '-p'], { timeout: 20_000, buffer: true });
    if (!r.ok || !r.out || r.out.length < 100) throw Object.assign(new Error('Android cihazdan ekran görüntüsü alınamadı.'), { status: 400 });
    return { name: 'android-ekran.png', type: 'image/png', data: Buffer.from(r.out).toString('base64') };
  }
  throw Object.assign(new Error('Platform ios ya da android olmalı.'), { status: 400 });
}
