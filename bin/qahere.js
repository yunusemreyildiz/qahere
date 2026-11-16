#!/usr/bin/env node
// qaHere başlatıcısı: sunucuyu alt süreç olarak çalıştırır. Sunucu güncellemeden sonra 75 koduyla
// çıkarsa yeniden başlatır; böylece arayüzdeki "Güncelle" düğmesi terminale dokunmadan yeni sürümü açar.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../server.js', import.meta.url));
const RESTART = 75;
let child = null;
let stopping = false;

function start() {
  child = spawn(process.execPath, [server, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, QAHERE_SUPERVISED: '1' },
  });
  child.on('exit', (code, signal) => {
    if (code === RESTART && !stopping) {
      console.log('qaHere güncellendi, yeniden başlatılıyor…');
      start();
      return;
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

// Ctrl+C terminalde ikisine birden gider; başlatıcı alt sürecin kapanmasını bekler.
// Yalnızca başlatıcıya gelen sonlandırma sinyali de alt sürece iletilir.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { stopping = true; child?.kill(sig); });
}

start();
