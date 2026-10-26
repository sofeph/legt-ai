/**
 * LLM'in yazdığı etkileşim senaryoları. Model Playwright kodu YAZMAZ: yalnızca bu küçük JSON
 * dilini üretir, uygulama yorumlar. Böylece yerel modelin çıktısı ana süreçte kod olarak
 * çalışmaz ve kaçış/sözdizimi hataları JSON.parse ile yakalanır.
 *
 * Seçiciler bölümün kök elemanına göredir; "&" kökün kendisidir.
 */
export type ViewportName = 'desktop' | 'tablet' | 'mobile'

export type ScenarioStep =
  | { do: 'click' | 'hover' | 'focus'; selector: string }
  | { do: 'fill'; selector: string; value: string }
  | { do: 'press'; key: string }
  | { do: 'wait'; ms: number }
  | { do: 'viewport'; name: ViewportName }
  | { expect: 'visible' | 'hidden' | 'exists'; selector: string }
  | { expect: 'text'; selector: string; contains: string }
  | { expect: 'class'; selector: string; contains: string }
  | { expect: 'attr'; selector: string; name: string; contains: string }
  | { expect: 'count'; selector: string; min: number }

export interface Scenario {
  sectionId: string
  name: string
  steps: ScenarioStep[]
}

const ACTIONS = new Set(['click', 'hover', 'focus', 'fill', 'press', 'wait', 'viewport'])
const EXPECTS = new Set(['visible', 'hidden', 'exists', 'text', 'class', 'attr', 'count'])
const KEYS = /^(Enter|Escape|Tab|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End)$/
export const MAX_SCENARIOS_PER_SECTION = 4
export const MAX_STEPS = 12

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null)

function parseStep(raw: unknown): ScenarioStep | string {
  if (!raw || typeof raw !== 'object') return 'adım nesne değil'
  const s = raw as Record<string, unknown>
  const selector = str(s.selector)
  if (typeof s.do === 'string') {
    if (!ACTIONS.has(s.do)) return `bilinmeyen eylem "${s.do}"`
    switch (s.do) {
      case 'press': {
        const key = str(s.key, 20)
        return key && KEYS.test(key) ? { do: 'press', key } : `geçersiz tuş "${String(s.key)}"`
      }
      case 'wait': {
        const ms = Number(s.ms)
        return Number.isFinite(ms) && ms >= 0 ? { do: 'wait', ms: Math.min(ms, 2000) } : 'wait.ms sayı olmalı'
      }
      case 'viewport':
        return s.name === 'desktop' || s.name === 'tablet' || s.name === 'mobile' ? { do: 'viewport', name: s.name } : `geçersiz viewport "${String(s.name)}"`
      case 'fill': {
        const value = typeof s.value === 'string' ? s.value.slice(0, 200) : null
        return selector && value !== null ? { do: 'fill', selector, value } : 'fill için selector ve value gerekli'
      }
      default:
        return selector ? { do: s.do as 'click' | 'hover' | 'focus', selector } : `${s.do} için selector gerekli`
    }
  }
  if (typeof s.expect === 'string') {
    if (!EXPECTS.has(s.expect)) return `bilinmeyen beklenti "${s.expect}"`
    if (!selector) return `${s.expect} için selector gerekli`
    switch (s.expect) {
      case 'text':
      case 'class': {
        const contains = str(s.contains)
        return contains ? { expect: s.expect, selector, contains } : `${s.expect} için contains gerekli`
      }
      case 'attr': {
        const name = str(s.name, 60)
        const contains = typeof s.contains === 'string' ? s.contains.slice(0, 200) : null
        return name && contains !== null && /^[\w:-]+$/.test(name) ? { expect: 'attr', selector, name, contains } : 'attr için name ve contains gerekli'
      }
      case 'count': {
        const min = Number(s.min)
        return Number.isInteger(min) && min >= 0 ? { expect: 'count', selector, min } : 'count.min tam sayı olmalı'
      }
      default:
        return { expect: s.expect as 'visible' | 'hidden' | 'exists', selector }
    }
  }
  return 'adımda "do" ya da "expect" yok'
}

/**
 * Modelin JSON çıktısı → senaryolar. Hatalı adım içeren senaryo atılır ve hata listesine
 * yazılır (bu liste yeniden deneme çağrısında modele geri verilir).
 */
export function parseScenarios(raw: string, sectionId: string): { scenarios: Scenario[]; errors: string[] } {
  let data: unknown
  try {
    data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch (e) {
    return { scenarios: [], errors: [`JSON.parse: ${(e as Error).message}`] }
  }
  const list = Array.isArray(data) ? data : (data as { scenarios?: unknown })?.scenarios
  if (!Array.isArray(list)) return { scenarios: [], errors: ['Kök nesnede "scenarios" dizisi yok'] }
  const scenarios: Scenario[] = []
  const errors: string[] = []
  list.slice(0, MAX_SCENARIOS_PER_SECTION).forEach((item, i) => {
    const sc = item as { name?: unknown; steps?: unknown }
    const name = str(sc?.name, 120) ?? `senaryo ${i + 1}`
    if (!Array.isArray(sc?.steps) || !sc.steps.length) return void errors.push(`${name}: "steps" boş ya da dizi değil`)
    const steps: ScenarioStep[] = []
    for (const [j, st] of sc.steps.slice(0, MAX_STEPS).entries()) {
      const parsed = parseStep(st)
      if (typeof parsed === 'string') return void errors.push(`${name}, adım ${j + 1}: ${parsed}`)
      steps.push(parsed)
    }
    if (!steps.some((s) => 'expect' in s)) return void errors.push(`${name}: en az bir "expect" adımı olmalı`)
    scenarios.push({ sectionId, name, steps })
  })
  return { scenarios, errors }
}

export function describeStep(s: ScenarioStep): string {
  if ('do' in s) {
    switch (s.do) {
      case 'press':
        return `press ${s.key}`
      case 'wait':
        return `wait ${s.ms}ms`
      case 'viewport':
        return `viewport ${s.name}`
      case 'fill':
        return `fill ${s.selector} = "${s.value}"`
      default:
        return `${s.do} ${s.selector}`
    }
  }
  switch (s.expect) {
    case 'text':
    case 'class':
      return `expect ${s.expect} ${s.selector} ∋ "${s.contains}"`
    case 'attr':
      return `expect attr ${s.selector}[${s.name}] ∋ "${s.contains}"`
    case 'count':
      return `expect count ${s.selector} ≥ ${s.min}`
    default:
      return `expect ${s.expect} ${s.selector}`
  }
}

/** Senaryonun kullandığı seçiciler (çalıştırmadan önce DOM'da var mı diye bakılır) */
export const stepSelectors = (sc: Scenario): string[] => [...new Set(sc.steps.flatMap((s) => ('selector' in s ? [s.selector] : [])))]
