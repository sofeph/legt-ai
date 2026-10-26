// Canlı WordPress testi için taşınabilir çalışma ortamını runtime/ altına kurar.
// Kullanım: node scripts/setup-runtime.mjs [--force] [--no-browser] [--only=xampp,wordpress,plugins,browser]
//
//   runtime/xampp/                   Portable XAMPP (Apache + MariaDB + PHP), yalnızca Windows
//   runtime/mysql-data-template/     Bozulmamış MariaDB veri klasörü (her test bunun kopyasıyla başlar)
//   runtime/wordpress/               WordPress çekirdeği
//   runtime/plugins/elementor/       Elementor (ücretsiz)
//   runtime/browsers/                Playwright Chromium (yoksa sistemdeki Edge / Chrome kullanılır)
//
// İndirilen arşivler runtime/.cache/ altında tutulur; --force ile yeniden kurulur.
import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import https from 'node:https'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const want = (part) => (only ? only.includes(part) : part !== 'browser' || !flag('no-browser'))
const runtime = resolve(process.env.LEGT_RUNTIME_DIR || join(root, 'runtime'))
const cache = join(runtime, '.cache')
const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'))
const isWin = process.platform === 'win32'

function fail(msg) {
  console.error(`HATA: ${msg}`)
  process.exit(1)
}

/** Yönlendirmeleri izleyen GET (en fazla 10) */
function get(url, hops = 10) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Wget/1.21 (legt-ai)' } }, (res) => {
        const { statusCode = 0, headers } = res
        if (statusCode >= 300 && statusCode < 400 && headers.location && hops > 0) {
          res.resume()
          resolve(get(new URL(headers.location, url).toString(), hops - 1))
        } else if (statusCode !== 200) {
          res.resume()
          reject(new Error(`${url}: HTTP ${statusCode}`))
        } else resolve(res)
      })
      .on('error', reject)
  })
}

async function download(url, name) {
  const dest = join(cache, name)
  if (!flag('force') && existsSync(dest)) {
    console.log(`>> Önbellekte: ${name}`)
    return dest
  }
  await mkdir(cache, { recursive: true })
  console.log(`>> İndiriliyor: ${url}`)
  // SourceForge tarayıcı olmayan istemcileri doğrudan aynaya yönlendirir.
  // fetch (undici) wordpress.org bağlantıyı kapatınca Node 24'te çöküyor; node:https kullanılır.
  const res = await get(url)
  const total = Number(res.headers['content-length']) || 0
  let done = 0
  let last = 0
  res.on('data', (c) => {
    done += c.length
    if (total && Date.now() - last > 1000) {
      last = Date.now()
      process.stdout.write(`   ${((done / total) * 100).toFixed(0)}% (${(done / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB)`)
    }
  })
  await pipeline(res, createWriteStream(dest + '.part'))
  if (total && done !== total) fail(`${url}: eksik indirme (${done}/${total} bayt)`)
  if (total) process.stdout.write(`\r   100% (${(total / 1e6).toFixed(0)} MB)\n`)
  await rename(dest + '.part', dest)
  return dest
}

/** Windows'ta yerleşik bsdtar zip açabilir; diğer sistemlerde unzip */
function unzip(zip, destDir, exclude = []) {
  const [cmd, cmdArgs] = isWin
    ? [join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', destDir, ...exclude.flatMap((e) => ['--exclude', e])]]
    : ['unzip', ['-q', '-o', zip, '-d', destDir, ...(exclude.length ? ['-x', ...exclude.map((e) => `${e}/*`)] : [])]]
  console.log(`>> Açılıyor: ${zip}`)
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit' })
  if (r.status !== 0) fail(`${zip} açılamadı (${cmd})`)
}

async function installZip(url, name, parent, rootName, exclude) {
  const target = join(parent, rootName)
  if (!flag('force') && existsSync(target)) {
    console.log(`>> Zaten kurulu: ${target}`)
    return false
  }
  const zip = await download(url, name)
  await rm(target, { recursive: true, force: true })
  await mkdir(parent, { recursive: true })
  unzip(zip, parent, exclude)
  if (!existsSync(target)) fail(`${zip} beklenen "${rootName}/" klasörünü içermiyor`)
  return true
}

await mkdir(runtime, { recursive: true })

if (want('xampp')) {
  const x = manifest.xampp[process.platform]
  if (!x) {
    console.log(`>> Portable XAMPP ${process.platform} için yok. Apache, MariaDB ve PHP'yi kurup LEGT_XAMPP_DIR ile`)
    console.log('   apache/, mysql/, php/ alt klasörlerini içeren bir dizini gösterin (README: runtime/README.md).')
  } else {
    const fresh = await installZip(x.url, `xampp-${x.version}.zip`, runtime, x.root, x.exclude)
    const template = join(runtime, 'mysql-data-template')
    if (fresh || !existsSync(template)) {
      // Kullanıcı XAMPP'ı ayrıca çalıştırsa bile testler hep temiz veriyle başlasın
      await rm(template, { recursive: true, force: true })
      await cp(join(runtime, x.root, 'mysql', 'data'), template, { recursive: true })
      console.log('>> MariaDB veri şablonu hazır')
    }
  }
}

if (want('wordpress')) {
  await installZip(manifest.wordpress.url, 'wordpress.zip', runtime, manifest.wordpress.root)
  const version = /\$wp_version\s*=\s*'([^']+)'/.exec(await readFile(join(runtime, 'wordpress', 'wp-includes', 'version.php'), 'utf8'))?.[1]
  console.log(`>> WordPress ${version ?? '?'}`)
}

if (want('plugins')) {
  for (const p of manifest.plugins) await installZip(p.url, `${p.slug}.zip`, join(runtime, 'plugins'), p.slug)
}

if (want('browser')) {
  const browsers = join(runtime, 'browsers')
  const exists = await stat(browsers).then((s) => s.isDirectory()).catch(() => false)
  if (exists && !flag('force')) console.log(`>> Zaten kurulu: ${browsers}`)
  else {
    const require = createRequire(import.meta.url)
    const cli = join(dirname(require.resolve('playwright-core/package.json')), 'cli.js')
    console.log('>> Playwright Chromium kuruluyor...')
    const r = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers } })
    if (r.status !== 0) console.log('>> Chromium kurulamadı; testlerde sistemdeki Edge / Chrome denenecek.')
  }
}

console.log('>> Çalışma ortamı hazır:', runtime)
