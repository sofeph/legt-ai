// Görsel (ekran görüntüsü) girdisi destekleyen model tespiti. Ollama /api/show "vision" yeteneğini bildirir;
// OpenAI uyumlu uçlarda böyle bir alan olmadığı için model adından tahmin edilir.

const VISION_NAME_RE = /(llava|bakllava|vision|[-_:.]vl\b|qwen\d*(\.\d+)?-?vl|minicpm-v|moondream|gemma3|pixtral|llama3\.2-vision|granite3\.\d-vision|mistral-small3)/i

/** base64 görüntünün türü (başlık baytlarından) */
export function imageMime(b64: string): string {
  if (b64.startsWith('/9j/')) return 'image/jpeg'
  if (b64.startsWith('UklGR')) return 'image/webp'
  if (b64.startsWith('R0lGO')) return 'image/gif'
  return 'image/png'
}

export const isVisionName = (model: string): boolean => VISION_NAME_RE.test(model)

/** Önerilen yerel görsel modeller (Ollama), küçükten büyüğe */
export const VISION_MODELS = [
  { name: 'qwen2.5vl:7b', label: 'Qwen2.5-VL 7B', note: '~6 GB · önerilen: arayüz ekran görüntülerini iyi okur' },
  { name: 'qwen2.5vl:3b', label: 'Qwen2.5-VL 3B', note: '~3,2 GB · zayıf bilgisayarlar için' },
  { name: 'llama3.2-vision:11b', label: 'Llama 3.2 Vision 11B', note: '~8 GB · 12 GB+ ekran kartı' }
]

/** Ollama'da modelin görsel yeteneği var mı; sunucuya ulaşılamazsa ad tahmini */
export async function ollamaModelHasVision(baseUrl: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(4000)
    })
    if (res.ok) {
      const j = (await res.json()) as { capabilities?: string[] }
      if (Array.isArray(j.capabilities)) return j.capabilities.includes('vision')
    }
  } catch {
    // ad tahminine düş
  }
  return isVisionName(model)
}
