// electron-vite'ı Electron'un düzgün açılacağı bir ortamda çalıştırır.
// Kullanım: node scripts/electron-run.mjs <dev|preview|build> [ek argümanlar]
//
// 1) ELECTRON_RUN_AS_NODE temizlenir. VS Code (ve diğer Electron tabanlı editörlerin)
//    terminalleri bu değişkeni devralır; ayarlıyken Electron düz Node gibi çalışır
//    ve main süreçte `electron.app` tanımsız olur.
// 2) Electron ikili dosyası yoksa (postinstall indirmesi sessizce başarısız olduysa)
//    indirilir; aksi halde electron-vite "Electron uninstall" hatası verir.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronDir = dirname(require.resolve('electron/package.json'))
if (!existsSync(join(electronDir, 'path.txt'))) {
  console.log('>> Electron ikili dosyası eksik, indiriliyor...')
  const r = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit', env })
  if (r.status !== 0 || !existsSync(join(electronDir, 'path.txt'))) {
    console.error('HATA: Electron indirilemedi. İnternet bağlantısını kontrol edip "node node_modules/electron/install.js" komutunu deneyin.')
    process.exit(1)
  }
}

const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js')
const r = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env })
process.exit(r.status ?? 1)
