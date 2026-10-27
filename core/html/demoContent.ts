import * as cheerio from 'cheerio'
import type { DemoContent, DemoPost, IntakeSource } from '../types'

const MAX_POSTS = 12
const MAX_CATEGORIES = 8
const CARD = 'article, [class*="post"], [class*="card"], [class*="blog"], [class*="entry"]'

const text = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * Örnek HTML'deki yazı/kart öğelerinden demo yazıları ve kategorileri çıkarır (LLM'siz).
 * Demo içe aktarıcı bunları gerçek WordPress yazısı olarak ekler; widget'lar içeriği WP_Query ile okur.
 */
export function extractDemoContent(sources: IntakeSource[]): DemoContent {
  const posts: DemoPost[] = []
  const seen = new Set<string>()
  for (const src of sources) {
    if (src.kind !== 'html') continue
    const $ = cheerio.load(src.content)
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
  return { posts, categories }
}
