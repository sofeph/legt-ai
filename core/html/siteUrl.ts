// Site adresinden kaynak toplama: sayfa gerçek tarayıcıda açılır, render edilmiş DOM + CSS + görseller alınır,
// üç görünüm penceresinde tam sayfa ekran görüntüsü referans olarak saklanır (görsel birebirlik puanı için).
// LEGT AI'nin çevrim dışı ilkesine tek istisna: kullanıcı açıkça bir adres verdiğinde o sayfa indirilir.
import { posix } from 'node:path'
import * as cheerio from 'cheerio'
import type { Browser } from 'playwright-core'
import type { IntakeSource, UrlScan } from '../types'

const MAX_MEDIA = 150
const MAX_MEDIA_BYTES = 3 * 1024 * 1024
const MAX_CSS = 40
const NAV_TIMEOUT = 45000
const NO_ANIMATION = '*,*::before,*::after{animation:none!important;transition:none!important}'

export type { UrlScan }

const REF_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 1100 },
  { name: 'mobile', width: 414, height: 844 }
] as const

export function normalizeUrl(input: string): string {
  const raw = input.trim()
  if (!raw) throw new Error('Site adresi boş')
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const u = new URL(withScheme)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Yalnızca http(s) adresleri desteklenir')
  return u.toString()
}

const safe = (s: string): string => s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file'

/** CSS içindeki url(...) başvurularını yerel dosya adlarına çevirir */
export function rewriteCssUrls(css: string, baseUrl: string, map: Map<string, string>, prefix: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _q: string, ref: string) => {
    if (ref.startsWith('data:')) return whole
    try {
      const local = map.get(new URL(ref, baseUrl).toString())
      return local ? `url("${prefix}${local}")` : whole
    } catch {
      return whole
    }
  })
}

export async function captureUrl(browser: Browser, rawUrl: string, log: (line: string) => void, signal?: AbortSignal): Promise<UrlScan> {
  const url = normalizeUrl(rawUrl)
  const warnings: string[] = []
  const ctx = await browser.newContext({ viewport: { width: REF_VIEWPORTS[0].width, height: REF_VIEWPORTS[0].height }, ignoreHTTPSErrors: true })
  try {
    const page = await ctx.newPage()
    const bodies = new Map<string, { type: string; body: Buffer }>()
    const pending: Promise<void>[] = []
    page.on('response', (res) => {
      const type = (res.headers()['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (!(type === 'text/css' || type.startsWith('image/') || type.startsWith('video/'))) return
      pending.push(
        res
          .body()
          .then((body) => {
            bodies.set(res.url(), { type, body })
          })
          .catch(() => undefined)
      )
    })
    log(`Açılıyor: ${url}`)
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT })
    } catch {
      // Sürekli istek atan siteler networkidle'a ulaşmaz; yüklenen kadarıyla devam
      await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT })
      warnings.push('Sayfa tamamen sakinleşmedi (sürekli ağ isteği); yüklenen hâliyle alındı.')
    }
    if (signal?.aborted) throw new Error('İptal edildi')
    await page.addStyleTag({ content: NO_ANIMATION }).catch(() => undefined)
    await scrollThrough(page)
    await Promise.allSettled(pending)

    const title = (await page.title()) || new URL(url).hostname
    const finalUrl = page.url()
    const rendered = await page.content()

    // Referans ekran görüntüleri: üç pencerede tam sayfa
    const sources: IntakeSource[] = []
    for (const vp of REF_VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.waitForTimeout(500)
      const png = await page.screenshot({ fullPage: true, animations: 'disabled' }).catch(() => null)
      if (png) sources.push({ name: `_ref/${vp.name}.png`, kind: 'media', content: png.toString('base64') })
    }

    // Yerel adlandırma: görseller img/, stiller css/
    const local = new Map<string, string>()
    const used = new Set<string>()
    const unique = (dir: string, name: string): string => {
      let n = `${dir}/${name}`
      for (let i = 2; used.has(n); i++) n = `${dir}/${i}-${name}`
      used.add(n)
      return n
    }
    let media = 0
    let cssCount = 0
    for (const [u, { type, body }] of bodies) {
      if (type === 'text/css') {
        if (cssCount >= MAX_CSS) continue
        cssCount++
        local.set(u, unique('css', safe(posix.basename(new URL(u).pathname)).replace(/(\.css)?$/, '.css')))
      } else if (media < MAX_MEDIA && body.length <= MAX_MEDIA_BYTES && body.length > 0) {
        media++
        const ext = type.split('/')[1]?.replace('svg+xml', 'svg').replace('jpeg', 'jpg').split('+')[0] ?? 'bin'
        const base = safe(posix.basename(new URL(u).pathname)) || 'media'
        local.set(u, unique('img', /\.[a-z0-9]{2,4}$/i.test(base) ? base : `${base}.${ext}`))
      }
    }
    if (bodies.size && media >= MAX_MEDIA) warnings.push(`Görsel sayısı ${MAX_MEDIA} ile sınırlandı.`)

    const $ = cheerio.load(rendered)
    $('style').each((_, el) => {
      if ($(el).text() === NO_ANIMATION) $(el).remove()
    })
    $('script, noscript, base, link[rel="preload"], link[rel="prefetch"], link[rel="modulepreload"], link[rel="dns-prefetch"], link[rel="preconnect"]').remove()
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href')
      const abs = href ? safeResolve(href, finalUrl) : null
      const name = abs ? local.get(abs) : undefined
      if (name) $(el).attr('href', name).removeAttr('integrity').removeAttr('crossorigin')
      else $(el).remove()
    })
    const mapAttr = (el: Parameters<typeof $>[0], attr: string): void => {
      const v = $(el).attr(attr)
      const abs = v ? safeResolve(v, finalUrl) : null
      const name = abs ? local.get(abs) : undefined
      if (name) $(el).attr(attr, name)
    }
    $('img, source, video, audio, input[type="image"]').each((_, el) => {
      for (const a of ['src', 'poster', 'data-src']) mapAttr(el, a)
      // srcset: her aday yerel adla; eşleşmeyen aday atılır
      const srcset = $(el).attr('srcset')
      if (srcset) {
        const kept = srcset
          .split(',')
          .map((c) => c.trim().split(/\s+/))
          .map(([u, d]) => {
            const abs = u ? safeResolve(u, finalUrl) : null
            const name = abs ? local.get(abs) : undefined
            return name ? [name, d].filter(Boolean).join(' ') : ''
          })
          .filter(Boolean)
        if (kept.length) $(el).attr('srcset', kept.join(', '))
        else $(el).removeAttr('srcset')
      }
    })
    $('[style]').each((_, el) => {
      $(el).attr('style', rewriteCssUrls($(el).attr('style') ?? '', finalUrl, local, ''))
    })
    $('style').each((_, el) => {
      $(el).text(rewriteCssUrls($(el).text(), finalUrl, local, ''))
    })

    sources.unshift({ name: 'index.html', kind: 'html', content: $.html() })
    for (const [u, name] of local) {
      const entry = bodies.get(u)
      if (!entry) continue
      if (entry.type === 'text/css') {
        // css/ altındaki dosyadan görsellere ../img/...
        const css = rewriteCssUrls(entry.body.toString('utf8'), u, local, '../')
        sources.push({ name, kind: 'css', content: css })
      } else {
        sources.push({ name, kind: 'media', content: entry.body.toString('base64') })
      }
    }
    log(`${sources.filter((s) => s.kind === 'css').length} stil dosyası, ${sources.filter((s) => s.kind === 'media' && !s.name.startsWith('_ref/')).length} görsel alındı`)
    warnings.push('JavaScript çalıştırılmış hâliyle (render edilmiş DOM) alındı; sayfanın kendi script dosyaları temaya taşınmaz.')
    return { url: finalUrl, title, sources, warnings }
  } finally {
    await ctx.close()
  }
}

function safeResolve(ref: string, base: string): string | null {
  try {
    return new URL(ref, base).toString()
  } catch {
    return null
  }
}

async function scrollThrough(page: import('playwright-core').Page): Promise<void> {
  await page
    .evaluate(async () => {
      const h = document.documentElement.scrollHeight
      for (let y = 0; y < h; y += 500) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 60))
      }
      window.scrollTo(0, 0)
    })
    .catch(() => undefined)
  await page.waitForTimeout(400)
}
