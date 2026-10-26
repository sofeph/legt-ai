import { createServer, Socket } from 'node:net'

export const PORT_RANGE = { min: 20000, max: 60999 } as const

/** Portta dinlenebiliyor mu? (127.0.0.1) */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const srv = createServer()
    srv.once('error', () => res(false))
    srv.listen({ port, host: '127.0.0.1', exclusive: true }, () => srv.close(() => res(true)))
  })
}

/**
 * Aralıktan rastgele ve boş bir port. `taken` aynı oturumda zaten verilmiş portlardır
 * (ör. HTTP ve MySQL aynı portu almasın). Her test farklı portlarla çalışır,
 * kullanıcının XAMPP'ı ya da başka bir sunucusu 80/3306'yı tutsa bile çakışmaz.
 */
export async function randomPort(taken: Iterable<number> = [], random: () => number = Math.random): Promise<number> {
  const used = new Set(taken)
  for (let i = 0; i < 50; i++) {
    const port = PORT_RANGE.min + Math.floor(random() * (PORT_RANGE.max - PORT_RANGE.min + 1))
    if (used.has(port)) continue
    if (await isPortFree(port)) return port
    used.add(port)
  }
  throw new Error(`${PORT_RANGE.min}-${PORT_RANGE.max} aralığında boş port bulunamadı`)
}

/** Port bağlantı kabul edene kadar bekler; süreç erken çıkarsa `alive` false döner */
export async function waitForPort(port: number, opts: { timeoutMs: number; alive?: () => boolean; signal?: AbortSignal }): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs
  for (;;) {
    if (opts.signal?.aborted) throw new Error('İptal edildi')
    if (opts.alive && !opts.alive()) throw new Error(`Süreç ${port} portunu açmadan kapandı`)
    const ok = await new Promise<boolean>((res) => {
      const s = new Socket()
      s.setTimeout(500)
      s.once('connect', () => (s.destroy(), res(true)))
      s.once('timeout', () => (s.destroy(), res(false)))
      s.once('error', () => (s.destroy(), res(false)))
      s.connect(port, '127.0.0.1')
    })
    if (ok) return
    if (Date.now() > deadline) throw new Error(`${port} portu ${Math.round(opts.timeoutMs / 1000)} sn içinde açılmadı`)
    await new Promise((r) => setTimeout(r, 250))
  }
}
