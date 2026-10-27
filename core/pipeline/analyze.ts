import { summarizeForPrompt } from '../html/splitSections'
import { TEMPERATURE, type ChatMessage, type LLMProvider } from '../llm/provider'
import { withRetry } from '../llm/retry'
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

/**
 * Modeller sık sık htmlRef'e bölüm adını yazar ("hero", "footer") ya da "Section 3" biçimini kullanır.
 * Anlamı belli olanlar yeniden istek (3+ dakika, token) harcanmadan kodla düzeltilir:
 * 1) section-N biçimi, 2) ad / sınıf / başlık eşleşmesi, 3) bölüm sayısı eşitse sıra.
 * @returns düzeltilen htmlRef sayısı
 */
export function repairRefs(raw: unknown, pre: PreAnalysis): number {
  const p = raw as { sections?: { id?: string; htmlRef?: string; widget?: string; slug?: string }[] }
  if (!p || !Array.isArray(p.sections)) return 0
  const valid = new Set(pre.sections.map((s) => s.id))
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  let fixed = 0
  const equalCount = p.sections.length === pre.sections.length
  p.sections.forEach((s, i) => {
    if (!s || (s.htmlRef && valid.has(s.htmlRef))) return
    let target: string | undefined
    const num = /(d+)s*$/.exec(String(s.htmlRef ?? ''))
    if (num && valid.has(`section-${num[1]}`) && /sec/i.test(String(s.htmlRef))) target = `section-${num[1]}`
    if (!target) {
      const keys = [s.htmlRef, s.id, s.widget?.replace(/^[a-z0-9_]+-/, ''), s.slug?.split('/').pop()].filter((k): k is string => !!k).map(norm).filter(Boolean)
      let best = 0
      for (const sec of pre.sections) {
        const hay = norm([sec.role, sec.tag, ...sec.classes, ...sec.headings.slice(0, 2)].join(' '))
        const words = new Set(hay.split(' '))
        let score = 0
        for (const k of keys) {
          if (words.has(k)) score += 2
          else if (k.length >= 3 && hay.includes(k)) score += 1
        }
        if (score > best) {
          best = score
          target = sec.id
        }
      }
    }
    if (!target && equalCount) target = pre.sections[i].id
    if (target) {
      s.htmlRef = target
      fixed++
    }
  })
  return fixed
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
    // Geçici sağlayıcı hatasında (zaman aşımı, 429, 5xx) plan çağrısı yeniden denenir
    lastResponse = await withRetry(
      () => opts.provider.chat({ messages, temperature: TEMPERATURE.analyze, json: true, signal: opts.signal, onToken: opts.onToken }),
      opts.signal
    )
    let parsed: unknown
    try {
      parsed = extractJson(lastResponse)
      repairRefs(parsed, opts.pre)
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
      // Elementor: widget CSS'i kaynaktan LLM'siz ve birebir üretilir (yeni projeler)
      if (plan.mode === 'elementor-free') plan.cssMode = 'source'
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
