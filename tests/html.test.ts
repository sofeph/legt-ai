import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractTokens } from '@core/html/extractTokens'
import { splitSections, summarizeForPrompt } from '@core/html/splitSections'

const html = readFileSync(join(__dirname, 'fixtures/landing.html'), 'utf8')

describe('splitSections', () => {
  const sections = splitSections(html)

  it('main sarmalayıcısına iner ve üst düzey bölümleri bulur', () => {
    expect(sections.map((s) => `${s.tag}.${s.classes[0]}`)).toEqual([
      'header.site-header',
      'section.hero',
      'section.features',
      'section.testimonials',
      'section.faq',
      'footer.site-footer'
    ])
  })

  it('rolleri belirler', () => {
    expect(sections[0].role).toBe('header')
    expect(sections.at(-1)!.role).toBe('footer')
    expect(sections[1].role).toBe('content')
  })

  it('tekrar eden öğeleri ve JS ipuçlarını bulur', () => {
    expect(sections[2].repeated).toEqual({ selector: 'div.card', count: 3 })
    expect(sections[3].jsHints).toContain('slider')
    expect(sections[4].jsHints).toContain('accordion')
    expect(sections[0].jsHints).toContain('menu-toggle')
  })

  it('özet tam HTML içermez', () => {
    expect(JSON.stringify(summarizeForPrompt(sections))).not.toContain('<section')
  })
})

describe('extractTokens', () => {
  const t = extractTokens(html)
  it('renkleri normalize edip sayar', () => {
    const colors = t.colors.map((c) => c.value)
    expect(colors[0]).toBe('#0e7c86')
    expect(colors).toContain('#f4a261')
    expect(colors).toContain('#ffffff')
  })
  it('font, Google Fonts, breakpoint, radius ve gölge çıkarır', () => {
    expect(t.googleFonts).toEqual(['Poppins', 'Inter'])
    expect(t.fonts.map((f) => f.family)).toEqual(expect.arrayContaining(['Inter', 'Poppins']))
    expect(t.breakpoints).toEqual([1024, 767])
    expect(t.radius.map((r) => r.value)).toEqual(expect.arrayContaining(['8px', '12px']))
    expect(t.shadows[0].value).toContain('rgba')
    expect(t.cssVariables['--brand']).toBe('#0E7C86')
    expect(t.spacing.map((s) => s.value)).toContain('24px')
  })
})

describe('splitSections: çok sayfalı girdi', () => {
  const page = (title: string, body: string): string =>
    `<!doctype html><html><head><title>${title}</title></head><body><a class="skip-link screen-reader-text" href="#main">İçeriğe geç</a>` +
    `<header class="site-header"><nav><a href="/">Blog</a><a href="/hakkinda">Hakkında</a></nav></header><main id="main">${body}</main>` +
    `<footer class="site-footer"><p>© 2026 Blog</p></footer></body></html>`
  const html = [
    page('Ana sayfa', '<section class="posts"><h2>Son yazılar</h2><article class="card"><h3>A</h3></article><article class="card"><h3>B</h3></article></section>'),
    page('Arşiv', '<header class="page-header"><h1>Baskı İpuçları</h1></header><section class="posts"><h2>Kategori</h2><article class="card"><h3>C</h3></article></section>'),
    page('Yazı', '<article class="post"><h1>PETG neden tablaya yapışmaz</h1><p>Metin</p></article>')
  ].join('\n')
  const sections = splitSections(html)

  it('title ve skip-link bölüm sayılmaz, tekrar eden header/footer/bölüm tekilleşir', () => {
    expect(sections.map((s) => `${s.tag}:${s.role}`)).toEqual(['header:header', 'section:content', 'footer:footer', 'header:content', 'article:content'])
    expect(sections.some((s) => s.tag === 'title' || s.tag === 'a')).toBe(false)
  })

  it('page-header içerik başlığıdır, site header\'ı değil', () => {
    expect(sections.find((s) => s.classes.includes('page-header'))?.role).toBe('content')
  })
})

describe('extractDemoContent', () => {
  it('yazı kartlarından başlık, özet, görsel ve kategori çıkarır', async () => {
    const { extractDemoContent } = await import('@core/html/demoContent')
    const html = `<header><article><h2>Menü kartı</h2><p>x</p></article></header>
      <section><article class="post-card"><span class="cat">Baskı</span><img src="img/a.png"><h3>PETG yapışma</h3><p>Tabla ısısı ve ilk katman.</p><a href="/a">Oku</a></article>
      <article class="post-card"><h3>PETG yapışma</h3><p>tekrar</p></article></section>`
    const r = extractDemoContent([{ name: 'index.html', kind: 'html', content: html }])
    expect(r.posts).toEqual([{ title: 'PETG yapışma', excerpt: 'Tabla ısısı ve ilk katman.', image: 'a.png', category: 'Baskı' }])
    expect(r.categories).toEqual(['Baskı'])
  })
})

describe('extractDemoContent menüler', () => {
  it('header ve footer bağlantılarından menü çıkarır, düğmeleri ve tekrarları atar', async () => {
    const { extractDemoContent } = await import('@core/html/demoContent')
    const html = `<header><nav><ul><li><a href="#about">Hakkımızda</a></li><li><a href="services.html">Hizmetler</a></li><li><a href="#about">Hakkımızda</a></li></ul><a class="theme-btn" href="#contact">Teklif Al</a></nav></header>
      <main></main><footer><ul><li><a href="/privacy.html">Gizlilik</a></li><li><a href="javascript:void(0)">X</a></li></ul></footer>`
    const r = extractDemoContent([{ name: 'index.html', kind: 'html', content: html }])
    expect(r.menus?.primary).toEqual([{ title: 'Hakkımızda', url: '#about' }, { title: 'Hizmetler', url: 'services.html' }])
    expect(r.menus?.footer).toEqual([{ title: 'Gizlilik', url: '/privacy.html' }])
  })
})
