import * as cheerio from 'cheerio'
import type { IntakeSource } from '../types'

export interface CssRule {
  selector: string
  body: string
  /** "@media (max-width: 767px)" gibi; üst düzey kurallar için null */
  media: string | null
}

/** Kaynaklardaki tüm CSS: ayrı .css dosyaları + HTML içindeki <style> etiketleri */
export function collectCss(sources: IntakeSource[]): string {
  const parts: string[] = []
  for (const s of sources) {
    if (s.kind === 'css') parts.push(s.content)
    if (s.kind === 'html') {
      const $ = cheerio.load(s.content)
      $('style').each((_, el) => {
        parts.push($(el).html() ?? '')
      })
    }
  }
  return parts.join('\n')
}

/** Basit CSS ayrıştırıcı: üst düzey kurallar ve bir seviye @media/@supports içi */
export function parseCss(css: string): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  const walk = (text: string, media: string | null): void => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      const head = text.slice(i, open).trim()
      // eşleşen kapanışı bul
      let depth = 1
      let j = open + 1
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
        j++
      }
      const body = text.slice(open + 1, j - 1)
      const headClean = head.replace(/^[;\s]+/, '').replace(/@import[^;]*;/g, '').replace(/@charset[^;]*;/g, '').trim()
      if (/^@(media|supports|container)/i.test(headClean)) walk(body, headClean)
      else if (headClean && !headClean.startsWith('@')) rules.push({ selector: headClean, body: body.trim(), media })
      else if (/^@font-face/i.test(headClean)) rules.push({ selector: '@font-face', body: body.trim(), media })
      i = j
    }
  }
  walk(src, null)
  return rules
}

function serialize(rules: CssRule[]): string {
  const out: string[] = []
  let currentMedia: string | null = null
  for (const r of rules) {
    if (r.media !== currentMedia) {
      if (currentMedia) out.push('}')
      if (r.media) out.push(`${r.media} {`)
      currentMedia = r.media
    }
    out.push(`${r.media ? '  ' : ''}${r.selector} { ${r.body.replace(/\s+/g, ' ')} }`)
  }
  if (currentMedia) out.push('}')
  return out.join('\n')
}

const GLOBAL_SELECTOR = /^(:root|html|body|\*|[a-z][a-z0-9]*|h[1-6]|::?[a-z-]+|\*::?(before|after))([\s,>+~:].*)?$/i

/**
 * Bölümle ilgili kurallar: seçicisinde bölümdeki bir class/id geçenler.
 * `global` modunda :root, body, etiket seçicileri ve @font-face döner (tema CSS'i / theme.json için).
 */
export function relevantCss(css: string, scope: { html: string } | 'global'): string {
  const rules = parseCss(css)
  if (scope === 'global') {
    return serialize(rules.filter((r) => r.selector === '@font-face' || r.selector.split(',').every((s) => GLOBAL_SELECTOR.test(s.trim()))))
  }
  const classes = new Set<string>()
  const ids = new Set<string>()
  for (const m of scope.html.matchAll(/\sclass\s*=\s*["']([^"']*)["']/g)) m[1].split(/\s+/).filter(Boolean).forEach((c) => classes.add(c))
  for (const m of scope.html.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)) ids.add(m[1])
  const hit = (sel: string): boolean => {
    for (const m of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) if (classes.has(m[1])) return true
    for (const m of sel.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)) if (ids.has(m[1])) return true
    return false
  }
  return serialize(rules.filter((r) => r.selector !== '@font-face' && hit(r.selector)))
}

/** LLM bağlamı için HTML'i küçültür: SVG yolları, data URI'ler, fazla boşluk */
export function compactHtml(html: string): string {
  return html
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, (m) => {
      const cls = /class\s*=\s*["']([^"']*)["']/.exec(m)?.[1]
      return `<svg${cls ? ` class="${cls}"` : ''}><!-- ikon --></svg>`
    })
    .replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{40,}/g, 'data:…')
    .replace(/<!--(?! ikon)[\s\S]*?-->/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

/** En fazla `max` karakter; kesilirse belirtir */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n<!-- … ${text.length - max} karakter kısaltıldı (bağlam sınırı) -->`
}
