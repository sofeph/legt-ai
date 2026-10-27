// Widget CSS'i LLM'siz: örnek tasarımın ilgili CSS kuralları widget kapsamına alınarak AYNEN taşınır.
// Böylece görünüm kaynakla birebir aynıdır ve widget başına bir LLM çağrısı (en pahalı çıktılardan biri) harcanmaz.
// Koşul: widget PHP'si kaynak HTML'in sınıf adlarını korur (plan.cssMode === 'source').
import { relevantRules, serializeRules, type CssRule } from '../html/relevantCss'

/** Üst düzey virgülle ayırır (parantez içindeki virgüller bölünmez) */
function splitSelectors(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** html / body / :root kapsam dışı: genel kurallar tema CSS'indedir */
const GLOBAL_LEAD = /^(:root|html|body)(?![\w-])/i

/** Seçiciyi widget kapsamına alır; kapsamlanamayanlar null */
export function scopeSelector(selector: string, wrapper: string): string | null {
  const s = selector.trim()
  if (!s || /^[>+~]/.test(s)) return null
  // `body .hero` / `html.dark .hero` gibi sayfa bağlamına bağlı kurallar widget içinde karşılıksızdır
  if (GLOBAL_LEAD.test(s)) {
    const rest = s.replace(GLOBAL_LEAD, '').replace(/^[.:#[][^\s>+~]*/, '').trim()
    return rest ? scopeSelector(rest.replace(/^[>+~]\s*/, ''), wrapper) : null
  }
  return `${wrapper} ${s}`
}

/** Kural gövdesinde kullanılan animasyon adları için kaynaktaki @keyframes bloklarını bulur */
function keyframes(css: string, bodies: string): string[] {
  const names = new Set<string>()
  for (const m of bodies.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/gi)) {
    for (const token of m[1].split(/[\s,]+/)) if (/^[a-zA-Z_-][\w-]*$/.test(token) && !/^(infinite|alternate|reverse|forwards|backwards|both|none|normal|linear|ease|ease-in|ease-out|ease-in-out|paused|running|initial|inherit)$/i.test(token)) names.add(token)
  }
  const out: string[] = []
  for (const name of names) {
    const start = new RegExp(`@(?:-webkit-)?keyframes\\s+${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\{`).exec(css)
    if (!start) continue
    let depth = 1
    let i = start.index + start[0].length
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    out.push(css.slice(start.index, i))
  }
  return out
}

/**
 * Bölümün CSS'i: kaynak kurallar `.elementor-widget-{ad}` altına alınır, @media korunur, kullanılan
 * @keyframes eklenir. Bölümle ilgili kural yoksa boş bir yorum döner.
 */
export function buildWidgetCss(css: string, sectionHtml: string, widgetName: string): string {
  const wrapper = `.elementor-widget-${widgetName}`
  const scoped: CssRule[] = []
  for (const r of relevantRules(css, { html: sectionHtml })) {
    const selectors = splitSelectors(r.selector)
      .map((s) => scopeSelector(s, wrapper))
      .filter((s): s is string => !!s)
    if (selectors.length) scoped.push({ ...r, selector: selectors.join(', ') })
  }
  const head = `/* ${widgetName}: örnek tasarımın CSS kuralları widget kapsamına alındı (LEGT AI, otomatik) */`
  if (!scoped.length) return `${head}\n`
  const frames = keyframes(css, scoped.map((r) => r.body).join(';'))
  return [head, serializeRules(scoped), ...frames].join('\n') + '\n'
}
