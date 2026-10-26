import type { LLMSettings, ModelInfo } from '../types'
import { parseParamsB, readLines, type ChatRequest, type LLMProvider } from './provider'

export class OllamaProvider implements LLMProvider {
  constructor(private settings: LLMSettings) {}

  private url(p: string): string {
    return this.settings.baseUrl.replace(/\/+$/, '') + p
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await fetch(this.url('/api/tags'), { signal })
    if (!res.ok) throw new Error(`Ollama /api/tags: HTTP ${res.status}`)
    const data = (await res.json()) as {
      models?: { name: string; details?: { parameter_size?: string } }[]
    }
    return (data.models ?? []).map((m) => ({
      name: m.name,
      paramsB: parseParamsB(m.details?.parameter_size) ?? parseParamsB(m.name)
    }))
  }

  async chat(req: ChatRequest): Promise<string> {
    const res = await fetch(this.url('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: req.signal,
      body: JSON.stringify({
        model: this.settings.model,
        messages: req.messages,
        stream: true,
        ...(req.json ? { format: 'json' } : {}),
        options: { temperature: req.temperature, num_ctx: this.settings.numCtx }
      })
    })
    if (!res.ok || !res.body) {
      throw new Error(`Ollama /api/chat: HTTP ${res.status} ${await res.text().catch(() => '')}`)
    }
    let out = ''
    for await (const line of readLines(res.body)) {
      const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string; done?: boolean }
      if (chunk.error) throw new Error(`Ollama: ${chunk.error}`)
      const piece = chunk.message?.content ?? ''
      if (piece) {
        out += piece
        req.onToken?.(piece)
      }
      if (chunk.done) break
    }
    return out
  }
}
