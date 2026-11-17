// qaHere.app'i bu bilgisayar için paketler. Uygulama ince bir kabuktur: sunucu kodunu paketin içine almaz,
// bu depodan çalıştırır (home.json depo yolunu tutar). Böylece "Güncelle" düğmesi uygulamayı da günceller.
//   npm run build            → desktop/dist/ içine qaHere.app
//   npm run build -- --install → ayrıca ~/Applications/qaHere.app olarak kopyalar
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const install = process.argv.includes('--install');

if (!fs.existsSync(path.join(root, 'server.js'))) {
  console.error('desktop klasörü qaHere deposunun içinde olmalı.');
  process.exit(1);
}

const homeFile = path.join(here, 'home.json');
fs.writeFileSync(homeFile, JSON.stringify({ root }, null, 2));

const [out] = await packager({
  dir: here,
  out: path.join(here, 'dist'),
  name: 'qaHere',
  executableName: 'qaHere',
  appBundleId: 'app.qahere.desktop',
  appCategoryType: 'public.app-category.developer-tools',
  icon: path.join(here, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.icns'),
  platform: process.platform,
  arch: process.arch,
  overwrite: true,
  asar: true,
  prune: true,
  ignore: [/^\/dist($|\/)/, /^\/build($|\/)/, /^\/build\.js$/],
  // Depo Belgeler/Masaüstü/İndirilenler altındaysa macOS ilk açılışta izin sorar; gerekçe Türkçe görünsün.
  extendInfo: {
    NSDocumentsFolderUsageDescription: 'qaHere, Belgeler klasöründeki qaHere deposunu çalıştırmak için erişim ister.',
    NSDesktopFolderUsageDescription: 'qaHere, Masaüstündeki qaHere deposunu çalıştırmak için erişim ister.',
    NSDownloadsFolderUsageDescription: 'qaHere, PDF rehberlerini İndirilenler klasörüne kaydeder.',
  },
});

const appPath = path.join(out, 'qaHere.app');
console.log(`Hazır: ${process.platform === 'darwin' ? appPath : out}`);

if (install && process.platform === 'darwin') {
  const dest = path.join(os.homedir(), 'Applications', 'qaHere.app');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  execFileSync('ditto', [appPath, dest]);
  console.log(`Kuruldu: ${dest} (Launchpad / Spotlight'ta "qaHere")`);
}
