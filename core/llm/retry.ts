/** Geçici sağlayıcı hataları: zaman aşımı, hız sınırı, 5xx, bağlantı kopması; yeniden denenir */
export function isTransientError(e: unknown): boolean {
  return /zaman aşımı|timeout|timed out|etimedout|econnreset|econnrefused|socket|fetch failed|network|overload|rate.?limit|too many|\b(408|425|429|500|502|503|504|529)\b|yanıt vermiyor|kota|quota/i.test((e as Error).message ?? '')
}

/** Kimlik / yetki hatası: her dosya aynı hatayı alır; işi sürdürmenin anlamı yok */
export function isFatalError(e: unknown): boolean {
  return /\b(401|403)\b|unauthorized|forbidden|invalid.{0,20}api.?key|api.?key.{0,20}(invalid|missing)|anahtar/i.test((e as Error).message ?? '')
}

export const RETRY_DELAYS_MS = [3000, 9000, 20000]

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
  })

/** Geçici hatada bekleyip yeniden dener (en fazla RETRY_DELAYS_MS.length kez); diğer hatalar hemen fırlatılır */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, onRetry?: (message: string, waitMs: number) => void): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await fn()
    } catch (e) {
      if (signal?.aborted || retry >= RETRY_DELAYS_MS.length || !isTransientError(e) || isFatalError(e)) throw e
      onRetry?.((e as Error).message.split('\n')[0], RETRY_DELAYS_MS[retry])
      await sleep(RETRY_DELAYS_MS[retry], signal)
    }
  }
}
