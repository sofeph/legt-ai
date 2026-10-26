import * as cheerio from 'cheerio'
import type { ExtractedTokens } from '../types'

type Counted = { value: string; count: number }

const TOP = 12

function tally(values: string[], limit = TOP): Counted[] {
  const m = new Map<string, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

function normalizeHex(hex: string): string {
  let h = hex.toLowerCase().slice(1)
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
  if (h.length === 8 && h.endsWith('ff')) h = h.slice(0, 6)
  return '#' + h
}

function declarations(css: string, prop: string): string[] {
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, 'gi')
  return [...css.matchAll(re)].map((m) => m[1].replace(/!important/i, '').trim())
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** HTML + ayrı CSS dosyalarından renk, font, boşluk, radius, gölge, breakpoint çıkarır */
export function extractTokens(html: string, cssFiles: string[] = []): ExtractedTokens {
  const $ = cheerio.load(html)
  const styleTags = $('style').map((_, s) => $(s).html() ?? '').get()
  const inline = $('[style]').map((_, e) => `x{${$(e).attr('style')}}`).get()
  const css = stripComments([...cssFiles, ...styleTags, ...inline].join('\n'))

  // Renkler
  const colorValues: string[] = []
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    if ([4, 5, 7, 9].includes(m[0].length)) colorValues.push(normalizeHex(m[0]))
  }
  for (const m of css.matchAll(/\b(?:rgba?|hsla?)\([^)]*\)/gi)) colorValues.push(m[0].replace(/\s+/g, ' ').toLowerCase())

  // CSS değişkenleri
  const cssVariables: Record<string, string> = {}
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) cssVariables[m[1]] = m[2].trim()

  // Fontlar
  const families = declarations(css, 'font-family').map((f) => f.split(',')[0].replace(/["']/g, '').trim())
  const googleFonts = new Set<string>()
  const fontUrls = [
    ...$('link[href*="fonts.googleapis.com"]').map((_, l) => $(l).attr('href') ?? '').get(),
    ...[...css.matchAll(/@import\s+url\(["']?([^"')]+fonts\.googleapis\.com[^"')]+)/g)].map((m) => m[1])
  ]
  for (const u of fontUrls) {
    for (const m of u.matchAll(/family=([^&:;]+)/g)) googleFonts.add(decodeURIComponent(m[1]).replace(/\+/g, ' '))
  }

  // Boşluklar
  const spacing: string[] = []
  for (const prop of ['padding', 'margin', 'gap', 'row-gap', 'column-gap', 'padding-top', 'padding-bottom', 'margin-top', 'margin-bottom']) {
    for (const v of declarations(css, prop)) {
      for (const part of v.split(/\s+/)) if (/^\d*\.?\d+(px|rem|em|vw|vh|%)$/.test(part) && !/^0[a-z%]*$/.test(part)) spacing.push(part)
    }
  }

  const breakpoints = new Set<number>()
  for (const m of css.matchAll(/@media[^{]*\((?:max|min)-width\s*:\s*(\d+)px\)/gi)) breakpoints.add(parseInt(m[1], 10))

  return {
    colors: tally(colorValues, 16),
    cssVariables,
    fonts: tally(families).map(({ value, count }) => ({ family: value, count })),
    googleFonts: [...googleFonts],
    fontSizes: tally(declarations(css, 'font-size')),
    spacing: tally(spacing),
    radius: tally(declarations(css, 'border-radius').filter((v) => !/^0(px)?$/.test(v))),
    shadows: tally(declarations(css, 'box-shadow').filter((v) => v !== 'none'), 6),
    breakpoints: [...breakpoints].sort((a, b) => b - a)
  }
}
