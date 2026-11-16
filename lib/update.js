// Güncelleme denetimi: qaHere git ile kurulduysa (README → Kurulum) origin/main'deki yeni commit'leri bulur
// ve istenirse "git pull --ff-only" ile uygular. Dışarıya yalnızca git'in kendi fetch isteği gider; kullanıcı
// verisi gönderilmez. QAHERE_UPDATE_CHECK=off ile kapatılır.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'main';
const CACHE_MS = 10 * 60_000;
export const RESTART_CODE = 75;

const git = (args, timeout = 20_000) => new Promise((resolve) => {
  execFile('git', args, { cwd: root, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() });
  });
});
const npm = (args, timeout = 300_000) => new Promise((resolve) => {
  execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, timeout, shell: process.platform === 'win32' }, (err, _o, stderr) => {
    resolve({ ok: !err, err: String(stderr || err?.message || '').trim() });
  });
});

export const updatesEnabled = () => !/^(0|off|false|no)$/i.test(process.env.QAHERE_UPDATE_CHECK || '');
const isGitCheckout = () => fs.existsSync(path.join(root, '.git'));

let cache = null; // { at, result }

/** @returns {Promise<{enabled:boolean, git:boolean, version?:string, behind?:number, ahead?:number, commits?:{sha,subject}[], blocked?:string, error?:string, supervised:boolean}>} */
export async function checkUpdate({ force = false } = {}) {
  const base = { enabled: updatesEnabled(), git: isGitCheckout(), supervised: process.env.QAHERE_SUPERVISED === '1' };
  if (!base.enabled || !base.git) return base;
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.result;

  const head = await git(['rev-parse', '--short', 'HEAD']);
  const result = { ...base, version: head.out || undefined };
  const fetched = await git(['fetch', '--quiet', 'origin', BRANCH]);
  if (!fetched.ok) {
    result.error = 'Yeni sürüm denetlenemedi (internet ya da GitHub erişimi yok).';
  } else {
    const remote = `origin/${BRANCH}`;
    const [behind, ahead, log, dirty] = await Promise.all([
      git(['rev-list', '--count', `HEAD..${remote}`]),
      git(['rev-list', '--count', `${remote}..HEAD`]),
      git(['log', '--format=%h%x09%s', '-n', '30', `HEAD..${remote}`]),
      git(['status', '--porcelain', '--untracked-files=no']),
    ]);
    result.behind = Number(behind.out) || 0;
    result.ahead = Number(ahead.out) || 0;
    result.commits = log.out ? log.out.split('\n').map((l) => { const [sha, ...s] = l.split('\t'); return { sha, subject: s.join('\t') }; }) : [];
    if (result.behind) {
      if (result.ahead) result.blocked = 'Bu kurulumda GitHub\'da olmayan commit\'ler var; güncellemeyi elle yap (git pull).';
      else if (dirty.out) result.blocked = 'Bu kurulumdaki dosyalarda kaydedilmemiş değişiklik var; güncellemeyi elle yap ya da değişiklikleri geri al.';
    }
  }
  cache = { at: Date.now(), result };
  return result;
}

/** Yeni sürümü indirir. Başarılıysa çağıran sunucuyu RESTART_CODE ile kapatır. */
export async function applyUpdate() {
  const st = await checkUpdate({ force: true });
  if (!st.enabled || !st.git) throw Object.assign(new Error('Bu kurulum git ile yapılmadığı için uygulama içinden güncellenemiyor.'), { status: 400 });
  if (st.error) throw Object.assign(new Error(st.error), { status: 502 });
  if (!st.behind) return { updated: false };
  if (st.blocked) throw Object.assign(new Error(st.blocked), { status: 409 });

  const before = (await git(['rev-parse', 'HEAD'])).out;
  const pull = await git(['pull', '--ff-only', '--quiet', 'origin', BRANCH], 120_000);
  if (!pull.ok) throw Object.assign(new Error(`Güncelleme indirilemedi: ${pull.err.slice(0, 300)}`), { status: 500 });
  const changed = (await git(['diff', '--name-only', before, 'HEAD'])).out.split('\n').filter(Boolean);
  if (changed.some((f) => f === 'package.json' || f === 'package-lock.json')) {
    const inst = await npm(['install', '--no-audit', '--no-fund']);
    if (!inst.ok) throw Object.assign(new Error(`Yeni sürüm indirildi ama paketler kurulamadı. Terminalde "npm install" çalıştırıp qaHere'yi yeniden başlat. (${inst.err.slice(0, 200)})`), { status: 500 });
  }
  cache = null;
  const version = (await git(['rev-parse', '--short', 'HEAD'])).out;
  // Eski "node server.js" ile başlatıldıysa yeniden başlatacak bir başlatıcı yok: kullanıcı elle açar.
  return { updated: true, version, restart: process.env.QAHERE_SUPERVISED === '1' ? 'auto' : 'manual' };
}
