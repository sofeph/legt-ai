import type { LLMSettings, ModelInfo } from '../types'
import { parseParamsB, readLines, type ChatRequest, type LLMProvider } from './provider'
import { imageMime } from './vision'

/** LM Studio, llama.cpp server, vLLM vb. /v1 uyumlu yerel endpoint'ler */
export class OpenAICompatProvider implements LLMProvider {
  constructor(private settings: LLMSettings) {}

  private url(p: string): string {
    const base = this.settings.baseUrl.replace(/\/+$/, '')
    return (base.endsWith('/v1') ? base : base + '/v1') + p
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.settings.apiKey) h.Authorization = `Bearer ${this.settings.apiKey}`
    return h
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await fetch(this.url('/models'), { headers: this.headers(), signal })
    if (!res.ok) throw new Error(`/v1/models: HTTP ${res.status}`)
    const data = (await res.json()) as { data?: { id: string }[] }
    return (data.data ?? []).map((m) => ({ name: m.id, paramsB: parseParamsB(m.id) }))
  }

  async chat(req: ChatRequest): Promise<string> {
    const res = await fetch(this.url('/chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      signal: req.signal,
      body: JSON.stringify({
        model: this.settings.model,
        messages: req.messages.map((m) =>
          m.images?.length
            ? { role: m.role, content: [{ type: 'text', text: m.content }, ...m.images.map((b64) => ({ type: 'image_url', image_url: { url: `data:${imageMime(b64)};base64,${b64}` } }))] }
            : { role: m.role, content: m.content }
        ),
        temperature: req.temperature,
        stream: true,
        ...(req.json ? { response_format: { type: 'json_object' } } : {})
      })
    })
    if (!res.ok || !res.body) {
      throw new Error(`/v1/chat/completions: HTTP ${res.status} ${await res.text().catch(() => '')}`)
    }
    let out = ''
    for await (const line of readLines(res.body)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') break
      const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
      const piece = chunk.choices?.[0]?.delta?.content ?? ''
      if (piece) {
        out += piece
        req.onToken?.(piece)
      }
    }
    return out
  }
}
