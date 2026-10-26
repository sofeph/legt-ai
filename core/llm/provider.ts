import type { LLMSettings, ModelInfo } from '../types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  temperature: number
  /** Ollama `format: "json"` / OpenAI `response_format: json_object` */
  json?: boolean
  signal?: AbortSignal
  onToken?: (chunk: string) => void
}

export interface LLMProvider {
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  /** Stream eder, tam yanıtı döndürür */
  chat(req: ChatRequest): Promise<string>
}

export const TEMPERATURE = { analyze: 0.1, code: 0.2 } as const

/** "7B", "14.8B", "500M" → milyar; model adından "qwen2.5-coder:7b" gibi de çıkarır */
export function parseParamsB(text: string | undefined): number | null {
  if (!text) return null
  const m = /(\d+(?:\.\d+)?)\s*([bm])\b/i.exec(text)
  if (!m) return null
  const n = parseFloat(m[1])
  return m[2].toLowerCase() === 'm' ? n / 1000 : n
}

/** Satır satır gelen stream gövdesini okur */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
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
      if (line) yield line
    }
  }
  const rest = (buf + decoder.decode()).trim()
  if (rest) yield rest
}

let pluginFactory: ((settings: LLMSettings) => Promise<LLMProvider>) | null = null

/** Eklenti sağlayıcıları için fabrika (core/plugins/manager yüklenince kendini kaydeder) */
export function setPluginProviderFactory(factory: (settings: LLMSettings) => Promise<LLMProvider>): void {
  pluginFactory = factory
}

export async function createProvider(settings: LLMSettings): Promise<LLMProvider> {
  if (settings.provider === 'ollama') {
    const { OllamaProvider } = await import('./ollama')
    return new OllamaProvider(settings)
  }
  if (settings.provider === 'openai-compat') {
    const { OpenAICompatProvider } = await import('./openaiCompat')
    return new OpenAICompatProvider(settings)
  }
  // Eklentinin kaydettiği sağlayıcı (Ayarlar > Eklentiler)
  if (!pluginFactory) throw new Error(`Bilinmeyen sağlayıcı: ${settings.provider}`)
  return pluginFactory(settings)
}
