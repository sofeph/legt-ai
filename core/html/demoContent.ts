import * as cheerio from 'cheerio'
import type { DemoContent, DemoLink, DemoPost, IntakeSource } from '../types'

const MAX_POSTS = 12
const MAX_CATEGORIES = 8
const CARD = 'article, [class*="post"], [class*="card"], [class*="blog"], [class*="entry"]'

const text = (s: string): string => s.replace(/\s+/g, ' ').trim()

const MAX_LINKS = 12

/** Bir bölgedeki gezinme bağlantıları: kısa metinli, tekrarsız, javascript: olmayan */
function navLinks($: cheerio.CheerioAPI, root: ReturnType<cheerio.CheerioAPI>): DemoLink[] {
  const out: DemoLink[] = []
  const seen = new Set<string>()
  root.find('a[href]').each((_, el) => {
    if (out.length >= MAX_LINKS) return
    const a = $(el)
    const title = text(a.text())
    const url = (a.attr('href') ?? '').trim()
    if (title.length < 2 || title.length > 30 || /^(javascript:|data:)/i.test(url) || /^(tel:|mailto:)/i.test(url) && out.length === 0) return
    // Düğme görünümlü bağlantılar (CTA) menü öğesi değil
    if (/\b(btn|button|cta|theme-btn)\b/i.test(a.attr('class') ?? '')) return
    const key = title.toLowerCase() + '|' + url
    if (seen.has(key)) return
    seen.add(key)
    out.push({ title, url })
  })
  return out
}

/**
 * Örnek HTML'deki yazı/kart öğelerinden demo yazıları ve kategorileri çıkarır (LLM'siz).
 * Demo içe aktarıcı bunları gerçek WordPress yazısı olarak ekler; widget'lar içeriği WP_Query ile okur.
 */
export function extractDemoContent(sources: IntakeSource[]): DemoContent {
  const posts: DemoPost[] = []
  const seen = new Set<string>()
  const menus: { primary: DemoLink[]; footer: DemoLink[] } = { primary: [], footer: [] }
  for (const src of sources) {
    if (src.kind !== 'html') continue
    const $ = cheerio.load(src.content)
    // Menüler: ilk sayfadaki header/nav ve footer bağlantıları
    if (!menus.primary.length) {
      const nav = $('header nav, nav').first()
      menus.primary = navLinks($, nav.length ? nav : $('header').first())
    }
    if (!menus.footer.length) {
      const foot = $('footer').first()
      const lists = foot.find('ul')
      menus.footer = navLinks($, lists.length ? lists : foot)
    }
    $(CARD).each((_, el) => {
      if (posts.length >= MAX_POSTS) return
      const $el = $(el)
      // Yalnızca en içteki kart; header/footer/nav içindekiler yazı sayılmaz
      if ($el.find(CARD).length || $el.closest('header, footer, nav').length) return
      const heading = $el.find('h1, h2, h3, h4').first()
      const title = text(heading.text())
      if (title.length < 4 || title.length > 140 || /©/.test(title) || seen.has(title.toLowerCase())) return
      if (!$el.find('a[href]').length && !$el.find('p').length) return
      const excerpt = text($el.find('p').first().text()).slice(0, 220)
      const img = $el.find('img[src]').first().attr('src') ?? ''
      const category = text($el.find('[class*="cat"], [class*="tag"], [class*="badge"], [class*="label"]').first().text())
      seen.add(title.toLowerCase())
      posts.push({
        title,
        excerpt,
        image: img && !img.startsWith('data:') ? img.split(/[?#]/)[0].split('/').pop() ?? '' : '',
        category: category.length >= 2 && category.length <= 30 ? category : ''
      })
    })
  }
  const categories = [...new Set(posts.map((p) => p.category).filter(Boolean))].slice(0, MAX_CATEGORIES)
  return { posts, categories, menus }
}
