// Ollama kurulumu / başlatma / model indirme / paralel ayar. UI ve Electron'dan bağımsız (yalnızca Node).
import { execFile, spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { get } from 'node:https'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { clampConcurrency } from '../pool'

const run = promisify(execFile)

export const WINDOWS_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe'
export const DOWNLOAD_PAGE = 'https://ollama.com/download'

/** Paralel ajanlar için Ollama ortamı: eşzamanlı istek + daha az bellek kullanan KV önbelleği */
export function ollamaEnv(parallel: number): Record<string, string> {
  return {
    OLLAMA_NUM_PARALLEL: String(clampConcurrency(parallel)),
    OLLAMA_FLASH_ATTENTION: '1',
    OLLAMA_KV_CACHE_TYPE: 'q8_0'
  }
}

/** `where`/`which` ve bilinen kurulum yerleri */
export async function findOllama(): Promise<string | null> {
  const win = process.platform === 'win32'
  try {
    const { stdout } = await run(win ? 'where' : 'which', ['ollama'])
    const first = stdout.split(/\r?\n/).find((l) => l.trim())
    if (first) return first.trim()
  } catch {
    // PATH'te yok
  }
  const candidates = win
    ? [join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'Ollama', 'ollama.exe')]
    : ['/usr/local/bin/ollama', '/usr/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama']
  return candidates.find((p) => existsSync(p)) ?? null
}

/** Kurulu modeller; sunucuya ulaşılamıyorsa null */
export async function listInstalledModels(baseUrl: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return null
    const json = (await res.json()) as { models?: { name: string }[] }
    return (json.models ?? []).map((m) => m.name)
  } catch {
    return null
  }
}

/** Kullanıcı ortamındaki OLLAMA_NUM_PARALLEL (Windows: kayıt defteri; diğerlerinde bu sürecin ortamı) */
export async function readParallel(): Promise<number | null> {
  let raw: string | undefined = process.env.OLLAMA_NUM_PARALLEL
  if (process.platform === 'win32') {
    try {
      const { stdout } = await run('reg', ['query', 'HKCU\\Environment', '/v', 'OLLAMA_NUM_PARALLEL'])
      raw = /OLLAMA_NUM_PARALLEL\s+REG_\w+\s+(\S+)/.exec(stdout)?.[1] ?? raw
    } catch {
      // değer tanımlı değil
    }
  }
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Windows'ta kalıcı kullanıcı ortam değişkeni (setx); diğerlerinde yalnızca başlatılan sürece verilir */
async function persistEnv(env: Record<string, string>): Promise<boolean> {
  if (process.platform !== 'win32') return false
  for (const [k, v] of Object.entries(env)) await run('setx', [k, v])
  return true
}

async function stopOllama(): Promise<void> {
  try {
    if (process.platform === 'win32') await run('taskkill', ['/F', '/IM', 'ollama app.exe', '/IM', 'ollama.exe'])
    else await run('pkill', ['-x', 'ollama'])
  } catch {
    // çalışmıyordu
  }
}

async function waitUp(baseUrl: string, ms: number, signal?: AbortSignal): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (signal?.aborted) throw new Error('İptal edildi')
    if ((await listInstalledModels(baseUrl)) !== null) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/** `ollama serve` başlatır (arka planda; uygulama kapanınca yaşamaya devam eder) */
export async function startOllama(baseUrl: string, parallel: number, signal?: AbortSignal): Promise<void> {
  const exe = await findOllama()
  if (!exe) throw new Error('Ollama kurulu değil')
  if ((await listInstalledModels(baseUrl)) !== null) return
  const child = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...ollamaEnv(parallel) } })
  child.unref()
  if (!(await waitUp(baseUrl, 30000, signal))) throw new Error('Ollama başlatıldı ama 30 sn içinde yanıt vermedi')
}

/**
 * OLLAMA_NUM_PARALLEL'ı paralel ajan sayısına getirir. Değer zaten yeterliyse dokunmaz;
 * değilse kalıcı yazar (Windows) ve Ollama'yı yeni ortamla yeniden başlatır.
 * @returns true: değer uygulandı ya da zaten yeterliydi; false: Ollama dışarıdan yönetiliyor, elle ayar gerekir
 */
export async function ensureParallel(baseUrl: string, parallel: number, signal?: AbortSignal): Promise<boolean> {
  const wanted = clampConcurrency(parallel)
  if (wanted <= 1) return true
  if (!(await findOllama())) return false
  const current = await readParallel()
  const running = (await listInstalledModels(baseUrl)) !== null
  if (current !== null && current >= wanted) {
    if (!running) await startOllama(baseUrl, wanted, signal)
    return true
  }
  if (running && process.platform !== 'win32') return false
  await persistEnv(ollamaEnv(wanted))
  return restart(baseUrl, wanted, signal)
}

async function restart(baseUrl: string, wanted: number, signal?: AbortSignal): Promise<boolean> {
  await stopOllama()
  await new Promise((r) => setTimeout(r, 800))
  await startOllama(baseUrl, wanted, signal)
  return true
}

/** Elle uygulanacak komut (kalıcı yazılamayan sistemler için) */
export function manualParallelCommand(parallel: number): string {
  const env = ollamaEnv(parallel)
  if (process.platform === 'win32') return Object.entries(env).map(([k, v]) => `setx ${k} ${v}`).join('\n')
  if (process.platform === 'darwin') return Object.entries(env).map(([k, v]) => `launchctl setenv ${k} ${v}`).join('\n') + '\n# ardından Ollama uygulamasını yeniden başlatın'
  return `sudo systemctl edit ollama.service\n[Service]\n${Object.entries(env).map(([k, v]) => `Environment="${k}=${v}"`).join('\n')}\n# ardından: sudo systemctl restart ollama`
}

/** node:https ile indirir (yönlendirmeleri izler); undici büyük indirmelerde sorun çıkardı */
function download(url: string, dest: string, onProgress: (percent: number) => void, signal?: AbortSignal, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Çok fazla yönlendirme'))
    const req = get(url, { headers: { 'User-Agent': 'legt-ai' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return download(new URL(res.headers.location, url).toString(), dest, onProgress, signal, redirects + 1).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`İndirme başarısız: HTTP ${res.statusCode}`))
      }
      const total = Number(res.headers['content-length'] ?? 0)
      let got = 0
      const out = createWriteStream(dest)
      res.on('data', (c: Buffer) => {
        got += c.length
        if (total) onProgress(Math.round((got / total) * 100))
      })
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve()))
      out.on('error', reject)
      res.on('error', reject)
    })
    req.on('error', reject)
    signal?.addEventListener('abort', () => req.destroy(new Error('İptal edildi')), { once: true })
  })
}

/** Windows: resmi yükleyiciyi indirip sessiz kurar. Diğer sistemlerde false döner (indirme sayfası açılmalı). */
export async function installOllama(onProgress: (percent: number) => void, signal?: AbortSignal): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const dir = join(tmpdir(), 'legt-ai-ollama')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'OllamaSetup.exe')
  try {
    await download(WINDOWS_INSTALLER_URL, file, onProgress, signal)
    await new Promise<void>((resolve, reject) => {
      const p = spawn(file, ['/SILENT'], { stdio: 'ignore' })
      p.on('error', reject)
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Kurulum kodu ${code} ile bitti`))))
      signal?.addEventListener('abort', () => p.kill(), { once: true })
    })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  return (await findOllama()) !== null
}

/** /api/pull akışı: yüzde ilerleme */
export async function pullModel(baseUrl: string, model: string, onProgress: (percent: number, status: string) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
    signal
  })
  if (!res.ok || !res.body) throw new Error(`Model indirilemedi: HTTP ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const j = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string }
      if (j.error) throw new Error(j.error)
      onProgress(j.total ? Math.round(((j.completed ?? 0) / j.total) * 100) : 0, j.status ?? '')
    }
  }
}
