import * as cheerio from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import type { SectionSummary } from '../types'

// title/base: birden fazla sayfa art arda yapıştırılınca sonraki <head> içeriği body'ye düşer
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'svg', 'br', 'hr', 'title', 'base', 'head'])
/** Erişilebilirlik atlama bağlantıları ve ekran okuyucu metinleri bölüm değildir */
const SKIP_CLASS_RE = /\b(skip-link|skip-to-content|screen-reader-text|sr-only|visually-hidden)\b/i
/** header etiketi taşıyan ama site header'ı olmayan içerik başlıkları */
const CONTENT_HEADER_RE = /\b(page|entry|archive|post|author|section|search|article)-header\b|\bpage-title\b/i
const SECTION_TAGS = new Set(['header', 'footer', 'section', 'article', 'nav', 'aside'])

const JS_KEYWORDS: [RegExp, string][] = [
  [/swiper|slider|carousel|slick|splide|glide/i, 'slider'],
  [/accordion|faq|collapse|details/i, 'accordion'],
  [/\btabs?\b|tab-pane|tablist/i, 'tabs'],
  [/modal|popup|lightbox|dialog/i, 'modal'],
  [/counter|count-?up|odometer/i, 'counter'],
  [/sticky|fixed-top|affix/i, 'sticky'],
  [/hamburger|menu-toggle|nav-toggle|burger|offcanvas|mobile-menu/i, 'menu-toggle']
]

const isElement = (n: AnyNode): n is Element => n.type === 'tag'

function elementChildren(el: Element): Element[] {
  return el.children.filter(isElement).filter((c) => !SKIP_TAGS.has(c.name) && !SKIP_CLASS_RE.test(c.attribs?.class ?? ''))
}

/** Sarmalayıcı mı? (main, tek çocuklu div ya da içinde bölüm etiketleri olan div) */
function isWrapper(el: Element): boolean {
  if (el.name === 'main') return true
  if (el.name !== 'div') return false
  const kids = elementChildren(el)
  if (kids.length === 1 && ['div', 'main'].includes(kids[0].name)) return true
  return kids.length >= 2 && kids.filter((k) => SECTION_TAGS.has(k.name)).length >= 2
}

function collect(el: Element, out: Element[]): void {
  for (const child of elementChildren(el)) {
    if (isWrapper(child)) collect(child, out)
    else out.push(child)
  }
}

function attrText(el: Element): string {
  const a = el.attribs ?? {}
  return [a.id, a.class, a.role, ...Object.keys(a).filter((k) => k.startsWith('data-'))].filter(Boolean).join(' ')
}

function detectRole(el: Element, index: number, total: number): SectionSummary['role'] {
  const sig = `${el.name} ${attrText(el)}`
  if (CONTENT_HEADER_RE.test(attrText(el))) return 'content'
  if (el.name === 'header' || /\b(site-)?header\b|navbar|topbar/i.test(sig)) return 'header'
  if (el.name === 'footer' || /\b(site-)?footer\b/i.test(sig)) return 'footer'
  if (el.name === 'nav') return index === 0 ? 'header' : 'nav'
  if (index === total - 1 && /copyright|©/i.test(cheerio.load(el).text())) return 'footer'
  return 'content'
}

function signature(el: Element): string {
  const cls = (el.attribs?.class ?? '').trim().split(/\s+/).filter(Boolean).sort()[0]
  return cls ? `${el.name}.${cls}` : el.name
}

/**
 * Metinden bağımsız yapı parmak izi: etiket + sınıflar, alt ağaç dahil. Ardışık aynı kardeşler
 * tek sayılır (3 kartlık ve 5 kartlık liste aynı bileşendir).
 */
function fingerprint(el: Element): string {
  const parts: string[] = []
  let prev = ''
  for (const k of elementChildren(el)) {
    const f = fingerprint(k)
    if (f !== prev) parts.push(f)
    prev = f
  }
  const cls = (el.attribs?.class ?? '').trim().split(/s+/).filter(Boolean).sort().join('.')
  return `${el.name}${cls ? '.' + cls : ''}(${parts.join(',')})`
}

/** En çok tekrarlanan kardeş grubu (kart, liste öğesi, slide) */
function findRepeated(root: Element): SectionSummary['repeated'] {
  let best: SectionSummary['repeated'] = null
  const walk = (el: Element): void => {
    const kids = elementChildren(el)
    const counts = new Map<string, number>()
    for (const k of kids) counts.set(signature(k), (counts.get(signature(k)) ?? 0) + 1)
    for (const [sel, count] of counts) {
      if (count >= 3 && !/^(p|span|a|br|i|strong|em|b)$/.test(sel) && (!best || count > best.count)) {
        best = { selector: sel, count }
      }
    }
    kids.forEach(walk)
  }
  walk(root)
  return best
}

function clip(s: string, n = 120): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/**
 * HTML'i üst düzey bölümlere ayırır. `scripts` ayrı JS dosyalarının içeriğidir;
 * bölümün sınıf/id'lerine referans veriyorsa jsHints'e eklenir.
 */
export function splitSections(html: string, scripts: string[] = []): SectionSummary[] {
  const $ = cheerio.load(html)
  const body = $('body').get(0) as Element | undefined
  if (!body) return []

  const inlineScripts = $('script:not([src])')
    .map((_, s) => $(s).html() ?? '')
    .get()
  const allJs = [...scripts, ...inlineScripts].join('\n')

  const blocks: Element[] = []
  collect(body, blocks)
  const seen = new Set<string>()
  const meaningful = blocks
    .filter((b) => $(b).text().trim().length > 0 || $(b).find('img,video,iframe,form').length > 0)
    // Çok sayfalı girdide her sayfada tekrar eden header/footer/bölüm bir kez sayılır
    .filter((b) => {
      const f = fingerprint(b)
      if (seen.has(f)) return false
      seen.add(f)
      return true
    })
  // Site header/footer'ı bir kez: sayfalar arası küçük farklar (aktif menü sınıfı vb.) yapıyı değiştirse bile
  const roleSeen = new Set<string>()
  const unique = meaningful.filter((el, i) => {
    const role = detectRole(el, i, meaningful.length)
    if (role !== 'header' && role !== 'footer') return true
    if (roleSeen.has(role)) return false
    roleSeen.add(role)
    return true
  })

  return unique.map((el, i) => {
    const $el = $(el)
    const classes = ($el.attr('class') ?? '').split(/\s+/).filter(Boolean)
    const id = $el.attr('id')

    const hints = new Set<string>()
    const allAttrs = [attrText(el), ...$el.find('*').map((_, d) => attrText(d as Element)).get()].join(' ')
    for (const [re, name] of JS_KEYWORDS) if (re.test(allAttrs)) hints.add(name)
    for (const name of [...classes.map((c) => '.' + c), ...(id ? ['#' + id] : [])]) {
      const bare = name.slice(1)
      if (bare.length > 2 && allJs.includes(bare)) hints.add(`script-ref:${name}`)
    }

    const headings = $el
      .find('h1,h2,h3,h4')
      .map((_, h) => clip($(h).text(), 80))
      .get()
      .filter(Boolean)
      .slice(0, 6)
    const textSamples = $el
      .find('p,li,blockquote,figcaption')
      .map((_, p) => clip($(p).text()))
      .get()
      .filter(Boolean)
      .slice(0, 5)

    return {
      id: `section-${i + 1}`,
      tag: el.name,
      role: detectRole(el, i, unique.length),
      classes,
      headings,
      textSamples,
      images: $el.find('img,picture,video').length + ($el.is('img') ? 1 : 0),
      links: $el.find('a').length,
      buttons: $el.find('button,.btn,.button,[class*="btn-"]').length,
      forms: $el.find('form').length,
      repeated: findRepeated(el),
      jsHints: [...hints],
      html: $.html(el)
    }
  })
}

/** LLM'e giden özet: tam HTML hariç */
export function summarizeForPrompt(sections: SectionSummary[]): object[] {
  return sections.map(({ html: _html, ...rest }) => rest)
}
