// Ekran görüntüsünden kaynak HTML: görsel destekli bir model görüntüyü tek dosyalık HTML+CSS'e çevirir.
// Sonuç normal bir kaynak gibi işlenir (ön analiz → plan → üretim); ekran görüntüsü ayrıca tam sayfa
// referansı olarak saklanır ve üretilen temanın görsel benzerlik puanında kullanılır.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
import type { LLMProvider } from '../llm/provider'
import type { IntakeSource } from '../types'
import { extractFileLenient } from './fileBlocks'

export interface ScreenshotOptions {
  provider: LLMProvider
  promptsDir: string
  /** PNG / JPEG / WebP içeriği */
  image: Buffer
  signal?: AbortSignal
  onToken?: (chunk: string) => void
}

/** Eşleşmeyen / uydurma görsel adresleri yer tutucu SVG'lere çevrilir; boyut width/height'tan gelir */
export function placeholderSvg(w: number, h: number): string {
  const W = Math.max(16, Math.min(4000, Math.round(w) || 640))
  const H = Math.max(16, Math.min(4000, Math.round(h) || 360))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#d9dde3"/><path d="M0 0L${W} ${H}M${W} 0L0 ${H}" stroke="#bcc3cd" stroke-width="2"/></svg>\n`
}

/** HTML'deki <img> adreslerini img/gorsel-N.svg yer tutucularına çevirir ve SVG dosyalarını üretir */
export function localizeImages(html: string): { html: string; media: IntakeSource[] } {
  const $ = cheerio.load(html)
  const media: IntakeSource[] = []
  const names = new Map<string, string>()
  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? ''
    if (src.startsWith('data:')) return
    let name = names.get(src)
    if (!name) {
      name = `img/gorsel-${names.size + 1}.svg`
      names.set(src, name)
      media.push({ name, kind: 'media', content: Buffer.from(placeholderSvg(Number($(el).attr('width')), Number($(el).attr('height')))).toString('base64') })
    }
    $(el).attr('src', name).removeAttr('srcset')
  })
  return { html: $.html(), media }
}

export async function screenshotToSources(opts: ScreenshotOptions): Promise<IntakeSource[]> {
  const system = await readFile(join(opts.promptsDir, 'shared', 'screenshot.md'), 'utf8')
  const output = await opts.provider.chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: 'Ekteki ekran görüntüsünü HTML+CSS\'e çevir.', images: [opts.image.toString('base64')] }
    ],
    temperature: 0.2,
    signal: opts.signal,
    onToken: opts.onToken
  })
  const raw = extractFileLenient(output, 'index.html')
  if (!raw || !/<html|<body|<section|<main/i.test(raw)) throw new Error('Model geçerli bir HTML döndürmedi (görsel destekli bir model seçtiğinizden emin olun)')
  const { html, media } = localizeImages(raw)
  return [
    { name: 'index.html', kind: 'html', content: html },
    ...media,
    { name: '_ref/desktop.png', kind: 'media', content: opts.image.toString('base64') }
  ]
}
