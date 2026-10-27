// Uygulama içinden canlı test ortamı kurulumu (npm gerektirmez): portable XAMPP + WordPress + Elementor.
// scripts/setup-runtime.mjs ile aynı işi yapar; kurulu uygulamada Node/npm olmadığı için burada TypeScript'tir.
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage } from 'node:http'

export interface SetupProgress {
  step: string
  message: string
  /** 0-100; bilinmiyorsa null */
  percent: number | null
}

interface Manifest {
  xampp: Record<string, { version: string; url: string; root: string; exclude?: string[] }>
  wordpress: { url: string; root: string }
  plugins: { slug: string; url: string }[]
}

/** manifest.json okunamazsa kullanılacak varsayılanlar (runtime/manifest.json ile aynı) */
const DEFAULT_MANIFEST: Manifest = {
  xampp: {
    win32: {
      version: '8.2.12',
      url: 'https://downloads.sourceforge.net/project/xampp/XAMPP%20Windows/8.2.12/xampp-portable-windows-x64-8.2.12-0-VS16.zip',
      root: 'xampp',
      exclude: ['xampp/tomcat', 'xampp/perl', 'xampp/FileZillaFTP', 'xampp/MercuryMail', 'xampp/mailoutput', 'xampp/mailtodisk', 'xampp/phpMyAdmin', 'xampp/webalizer', 'xampp/webdav', 'xampp/sendmail', 'xampp/htdocs', 'xampp/install', 'xampp/licenses', 'xampp/contrib', 'xampp/src', 'xampp/cgi-bin', 'xampp/php/pear', 'xampp/php/docs', 'xampp/php/tests', 'xampp/apache/manual']
    }
  },
  wordpress: { url: 'https://wordpress.org/latest.zip', root: 'wordpress' },
  plugins: [{ slug: 'elementor', url: 'https://downloads.wordpress.org/plugin/elementor.latest-stable.zip' }]
}

/** Yönlendirmeleri izleyen GET (en fazla 10); fetch (undici) büyük indirmelerde sorun çıkardığı için node:https */
function fetchStream(url: string, hops = 10): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { 'User-Agent': 'Wget/1.21 (legt-ai)' } }, (res) => {
      const code = res.statusCode ?? 0
      if (code >= 300 && code < 400 && res.headers.location && hops > 0) {
        res.resume()
        resolve(fetchStream(new URL(res.headers.location, url).toString(), hops - 1))
      } else if (code !== 200) {
        res.resume()
        reject(new Error(`${url}: HTTP ${code}`))
      } else resolve(res)
    }).on('error', reject)
  })
}

function unzip(zip: string, destDir: string, exclude: string[], signal?: AbortSignal): Promise<void> {
  const win = process.platform === 'win32'
  const [cmd, args] = win
    ? [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', destDir, ...exclude.flatMap((e) => ['--exclude', e])]]
    : ['unzip', ['-q', '-o', zip, '-d', destDir, ...(exclude.length ? ['-x', ...exclude.map((e) => `${e}/*`)] : [])]]
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'ignore', windowsHide: true })
    p.on('error', (e) => reject(new Error(`${zip} açılamadı (${cmd}): ${e.message}`)))
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${zip} açılamadı (${cmd} kod ${code})`))))
    signal?.addEventListener('abort', () => p.kill(), { once: true })
  })
}

/** Sistem curl'ü (Windows 10+, macOS, Linux'ta var); yönlendirmeleri izler, hata kodunda başarısız sayılır */
function curlDownload(url: string, dest: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('curl', ['-L', '-f', '-sS', '--retry', '2', '--connect-timeout', '30', '-A', 'Wget/1.21 (legt-ai)', '-o', dest, url], { stdio: 'ignore', windowsHide: true })
    p.on('error', () => resolve(false))
    p.on('exit', (code) => resolve(code === 0))
    signal?.addEventListener('abort', () => p.kill(), { once: true })
  })
}

export interface SetupOptions {
  runtimeDir: string
  force?: boolean
  onProgress: (p: SetupProgress) => void
  signal?: AbortSignal
}

/** Portable XAMPP (yalnızca Windows), WordPress çekirdeği ve Elementor'u runtime/ altına kurar; mevcutlar atlanır */
export async function setupRuntime(opts: SetupOptions): Promise<void> {
  const { runtimeDir: runtime, onProgress, signal } = opts
  const cache = join(runtime, '.cache')
  await mkdir(runtime, { recursive: true })
  const manifest: Manifest = await readFile(join(runtime, 'manifest.json'), 'utf8')
    .then((t) => JSON.parse(t) as Manifest)
    .catch(() => DEFAULT_MANIFEST)

  const download = async (url: string, name: string, step: string): Promise<string> => {
    const dest = join(cache, name)
    if (!opts.force && existsSync(dest)) return dest
    await mkdir(cache, { recursive: true })
    onProgress({ step, message: `${name} indiriliyor…`, percent: 0 })
    let res: IncomingMessage | null = null
    let failure = ''
    // Node'un ağ yığını bazı CDN adreslerine (ETIMEDOUT) bağlanamazken sistem curl'ü bağlanabiliyor: önce iki deneme, sonra curl
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await fetchStream(url)
      } catch (e) {
        const err = e as Error & { errors?: Error[] }
        failure = err.message || err.errors?.map((x) => x.message).join('; ') || String(e)
      }
    }
    if (!res) {
      onProgress({ step, message: `${name}: Node bağlanamadı, sistem curl ile deneniyor…`, percent: null })
      const ok = await curlDownload(url, dest + '.part', signal)
      if (!ok) throw new Error(`${name} indirilemedi (${new URL(url).host}): ${failure}. İnternet bağlantınızı kontrol edip yeniden deneyin; kısmen inenler korunur.`)
      await rename(dest + '.part', dest)
      return dest
    }
    const total = Number(res.headers['content-length']) || 0
    let done = 0
    let last = 0
    res.on('data', (c: Buffer) => {
      done += c.length
      if (total && Date.now() - last > 500) {
        last = Date.now()
        onProgress({ step, message: `${name}: ${(done / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`, percent: Math.round((done / total) * 100) })
      }
    })
    signal?.addEventListener('abort', () => res.destroy(new Error('İptal edildi')), { once: true })
    await pipeline(res, createWriteStream(dest + '.part'))
    if (total && done !== total) throw new Error(`${url}: eksik indirme (${done}/${total} bayt)`)
    await rename(dest + '.part', dest)
    return dest
  }

  const install = async (url: string, name: string, parent: string, root: string, step: string, exclude: string[] = []): Promise<boolean> => {
    const target = join(parent, root)
    if (!opts.force && existsSync(target)) return false
    const zip = await download(url, name, step)
    await rm(target, { recursive: true, force: true })
    await mkdir(parent, { recursive: true })
    onProgress({ step, message: `${name} açılıyor…`, percent: null })
    await unzip(zip, parent, exclude, signal)
    if (!existsSync(target)) throw new Error(`${name} beklenen "${root}/" klasörünü içermiyor`)
    return true
  }

  const x = manifest.xampp[process.platform]
  if (!x) throw new Error(`Portable XAMPP ${process.platform} için yok; Apache, MariaDB ve PHP'yi kurup LEGT_XAMPP_DIR ile gösterin (runtime/README.md)`)
  const fresh = await install(x.url, `xampp-${x.version}.zip`, runtime, x.root, 'xampp', x.exclude)
  const template = join(runtime, 'mysql-data-template')
  if (fresh || !existsSync(template)) {
    // Kullanıcı XAMPP'ı ayrıca çalıştırsa bile testler hep temiz veriyle başlasın
    await rm(template, { recursive: true, force: true })
    await cp(join(runtime, x.root, 'mysql', 'data'), template, { recursive: true })
  }
  await install(manifest.wordpress.url, 'wordpress.zip', runtime, manifest.wordpress.root, 'wordpress')
  for (const p of manifest.plugins) await install(p.url, `${p.slug}.zip`, join(runtime, 'plugins'), p.slug, p.slug)
  onProgress({ step: 'done', message: 'Test ortamı hazır', percent: 100 })
}
