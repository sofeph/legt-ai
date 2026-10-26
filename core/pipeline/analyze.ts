import { summarizeForPrompt } from '../html/splitSections'
import { TEMPERATURE, type ChatMessage, type LLMProvider } from '../llm/provider'
import { loadPrompt, renderTemplate } from '../prompts/render'
import { scaffoldPaths } from '../scaffold'
import { buildFiles, normalizePlan } from './layout'
import type { IntakeInput, Plan, PreAnalysis } from '../types'

const MAX_RETRIES = 2

export function identityVars(input: IntakeInput): Record<string, string> {
  const { name, slug, prefix, textdomain, language } = input.theme
  return { name, slug, prefix, textdomain, language }
}

export function describeRequests(input: IntakeInput): string {
  const r = input.requests
  const lines = [
    `- Blog: ${r.blog ? 'evet' : 'hayır'}`,
    `- WooCommerce: ${r.woocommerce ? 'evet' : 'hayır'}`,
    `- Çok sayfa: ${r.multiPage ? 'evet' : 'hayır'}`
  ]
  if (r.notes.trim()) lines.push(`- Ek notlar: ${r.notes.trim()}`)
  return lines.join('\n')
}

export async function buildAnalyzeMessages(promptsDir: string, input: IntakeInput, pre: PreAnalysis): Promise<ChatMessage[]> {
  const vars = identityVars(input)
  const system = renderTemplate(await loadPrompt(promptsDir, input.mode, 'system'), { ...vars, path: '(plan.json)' })
  const user = renderTemplate(await loadPrompt(promptsDir, input.mode, 'analyze'), {
    ...vars,
    requests: describeRequests(input),
    tokens: pre.tokens,
    sections: summarizeForPrompt(pre.sections)
  })
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

/** Modelin JSON'unu çıkarır (ön/son metin ve ``` işaretleri tolere edilir) */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(t)
  } catch {
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('Yanıtta JSON nesnesi bulunamadı')
    return JSON.parse(t.slice(start, end + 1))
  }
}

/** plan.json yapısal kontrolü; boş liste = geçerli */
export function validatePlan(raw: unknown, input: IntakeInput, pre: PreAnalysis): string[] {
  const errs: string[] = []
  const p = raw as Partial<Plan> & Record<string, unknown>
  if (!p || typeof p !== 'object') return ['Kök değer bir JSON nesnesi olmalı']
  if (p.mode !== input.mode) errs.push(`"mode" "${input.mode}" olmalı`)
  if (!p.tokens || typeof p.tokens !== 'object') errs.push('"tokens" nesnesi eksik')
  if (!Array.isArray(p.sections) || p.sections.length === 0) errs.push('"sections" boş olmayan bir dizi olmalı')
  if (errs.length) return errs

  const prefix = input.theme.prefix
  const refs = new Set(pre.sections.map((s) => s.id))
  const seenRefs = new Set<string>()
  p.sections!.forEach((s, i) => {
    const where = `sections[${i}]`
    if (!s.id) errs.push(`${where}.id eksik`)
    if (!s.htmlRef || !refs.has(s.htmlRef)) errs.push(`${where}.htmlRef geçersiz: "${s.htmlRef}" (geçerli: ${[...refs].join(', ')})`)
    else seenRefs.add(s.htmlRef)
    if (input.mode === 'elementor-free') {
      const w = (s as { widget?: string }).widget
      if (!w || !w.startsWith(`${prefix}-`)) errs.push(`${where}.widget "${prefix}-" ile başlamalı: "${w ?? ''}"`)
      if (!Array.isArray((s as { contentControls?: unknown }).contentControls)) errs.push(`${where}.contentControls dizi olmalı`)
    } else {
      const slug = (s as { slug?: string }).slug
      if (!slug) errs.push(`${where}.slug eksik`)
    }
  })
  const missing = [...refs].filter((r) => !seenRefs.has(r))
  if (missing.length) errs.push(`Şu HTML bölümleri hiçbir ${input.mode === 'elementor-free' ? "widget'a" : "pattern'e"} eşlenmedi: ${missing.join(', ')}`)

  return errs
}

export interface AnalyzeOptions {
  provider: LLMProvider
  promptsDir: string
  scaffoldDir: string
  input: IntakeInput
  pre: PreAnalysis
  signal?: AbortSignal
  onToken?: (chunk: string) => void
  onAttempt?: (attempt: number, errors: string[]) => void
  log?: (label: string, entry: { system: string; user: string; response: string; error?: string }) => Promise<void>
}

/** ADIM 2: plan.json üretir. Şemaya uymazsa en fazla 2 kez hata mesajıyla tekrar ister. */
export async function analyze(opts: AnalyzeOptions): Promise<Plan> {
  const [system, user] = await buildAnalyzeMessages(opts.promptsDir, opts.input, opts.pre)
  let errors: string[] = []
  let lastResponse = ''
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Her çağrı bağımsız: tekrar denemede hatalar user mesajının sonuna eklenir, sohbet geçmişi yok
    const messages: ChatMessage[] = [
      system,
      attempt === 0
        ? user
        : {
            role: 'user',
            content: `${user.content}\n\n## Önceki denemenin hataları (deneme ${attempt + 1} / ${MAX_RETRIES + 1})\nÖnceki yanıt şemaya uymadı. Bu hataları yapmadan plan.json'un TAMAMINI yalnızca geçerli JSON olarak yaz:\n- ${errors.join('\n- ')}`
          }
    ]
    opts.onAttempt?.(attempt, errors)
    lastResponse = await opts.provider.chat({
      messages,
      temperature: TEMPERATURE.analyze,
      json: true,
      signal: opts.signal,
      onToken: opts.onToken
    })
    let parsed: unknown
    try {
      parsed = extractJson(lastResponse)
      errors = validatePlan(parsed, opts.input, opts.pre)
    } catch (e) {
      errors = [`JSON ayrıştırılamadı: ${(e as Error).message}`]
    }
    await opts.log?.(`analyze-${attempt + 1}`, {
      system: system.content,
      user: messages[1].content,
      response: lastResponse,
      error: errors.length ? errors.join('\n') : undefined
    })
    if (!errors.length) {
      const plan = parsed as Plan
      plan.theme = { ...opts.input.theme } // kimlik her zaman kullanıcının girdiğidir
      normalizePlan(plan)
      // Dosya listesi deterministik: LLM'in önerisi yerine plan bölümlerinden üretilir
      plan.files = buildFiles(plan, opts.pre, await scaffoldPaths(opts.scaffoldDir, plan, opts.pre))
      return plan
    }
  }
  throw new PlanValidationError(errors, lastResponse)
}

export class PlanValidationError extends Error {
  constructor(public errors: string[], public response: string) {
    super(`Plan ${MAX_RETRIES + 1} denemede de şemaya uymadı:\n- ${errors.join('\n- ')}`)
  }
}
