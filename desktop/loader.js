// qaHere.app'in giriş noktası. Pencere/menü kodunu (main.js) paketten değil depodan yükler:
// uygulama içindeki "Güncelle" depoyu yeniler, uygulama kendini yeniden açınca yeni kabuk da devreye girer.
// Depo bulunamazsa paketteki kopyaya düşer (o da "qaHere klasörü bulunamadı" ekranını gösterir).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function repoMain() {
  const roots = [process.env.QAHERE_HOME];
  try { roots.push(JSON.parse(fs.readFileSync(path.join(here, 'home.json'), 'utf8')).root); } catch { /* paketlenmemiş */ }
  roots.push(path.resolve(here, '..'));
  for (const r of roots) {
    const p = r && path.join(r, 'desktop', 'main.js');
    if (p && fs.existsSync(p) && fs.existsSync(path.join(r, 'server.js'))) return p;
  }
  return '';
}

const target = repoMain() || path.join(here, 'main.js');
await import(pathToFileURL(target).href);
