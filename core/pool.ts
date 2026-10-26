/** Paralel LLM ajanı sayısı sınırları (Ayarlar > Paralel ajan) */
export const CONCURRENCY = { min: 1, max: 10, default: 3 } as const

export function clampConcurrency(n: unknown): number {
  const v = Math.round(Number(n))
  return Number.isFinite(v) && v > 0 ? Math.min(CONCURRENCY.max, Math.max(CONCURRENCY.min, v)) : CONCURRENCY.default
}

/**
 * En fazla `concurrency` iş aynı anda. `ready(item, done)` false dönen iş, bağımlılıkları
 * bitene kadar bekler (verilmezse hepsi hazır). Bir iş hata verirse yeni iş başlatılmaz,
 * çalışanlar bitince ilk hata fırlatılır.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  ready: (item: T, done: Set<T>) => boolean = () => true
): Promise<void> {
  const queue = [...items]
  const done = new Set<T>()
  const running = new Set<Promise<void>>()
  // Geri çağrılarda atanır; TS daraltmasın diye tür açıkça genişletilir
  let failure = null as { error: unknown } | null

  const start = (item: T): void => {
    const p: Promise<void> = worker(item)
      .catch((e) => {
        failure ??= { error: e }
      })
      .finally(() => {
        done.add(item)
        running.delete(p)
      })
    running.add(p)
  }

  while (queue.length || running.size) {
    while (!failure && running.size < concurrency) {
      const i = queue.findIndex((it) => ready(it, done))
      if (i < 0) break
      start(queue.splice(i, 1)[0])
    }
    if (!running.size) {
      // Hiçbiri hazır değil ve çalışan yok: döngüsel bağımlılık; kalanlar verilen sırayla
      if (failure || !queue.length) break
      start(queue.shift()!)
      continue
    }
    await Promise.race(running)
  }
  if (failure) throw failure.error
}
