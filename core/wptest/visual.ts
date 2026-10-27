/// <reference lib="dom" />
// Görsel birebirlik: kaynak sayfa ile üretilen site aynı görünüm penceresinde ölçülür (kutular, tipografi, renk +
// ekran görüntüsü karşılaştırması), 1500 üzerinden puanlanır. Stil sapmaları LLM'siz CSS düzeltmesine çevrilir.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as cheerio from 'cheerio'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { SectionSummary, TestIssue, TestShot, VisualReport, VisualSectionScore } from '../types'
import {
  compare,
  describeComparison,
  GOOD_SCORE,
  MAX_SCORE,
  PASS_SCORE,
  pixelSimilarity,
  verdict,
  weightedMean,
  type Comparison,
  type StyleDiff,
  type VPrint
} from '../visual/score'
import type { Probe, Viewports } from './browser'
import type { ViewportName } from './scenarios'

const VIEWPORT_WEIGHT: Record<ViewportName, number> = { desktop: 0.5, tablet: 0.2, mobile: 0.3 }
const MAX_PIXEL_HEIGHT = 5000
const NAV_TIMEOUT = 45000

export interface VisualTarget {
  probe: Probe
  section: SectionSummary
  /** Otomatik CSS düzeltmesinin kök seçicisi (Elementor: .elementor-widget-{ad}); yoksa yalnızca puanlanır */
  patchRoot?: string
  /** Düzeltmenin yazılacağı CSS dosyası (output/ altına göre) */
  cssFile?: string
}

export interface SourcePage {
  name: string
  /** Mutlak dosya yolu */
  abs: string
}

type CacheEntry = { print: VPrint; png: Buffer | null } | null
/** Kaynak ölçümleri tur boyunca değişmez; bir kez ölçülür */
export type SourceCache = Map<string, CacheEntry>

export interface MeasureInput {
  browser: Browser
  siteUrl: string
  pages: { test: string; home?: string; demo?: string }
  targets: VisualTarget[]
  viewports: Viewports
  sourcePages: SourcePage[]
  cache: SourceCache
  /** projects/{id}/sources/_ref (site adresi / ekran görüntüsü girişinin tam sayfa referansları) */
  refDir?: string
  shots: { dir: string; rel: string }
  log: (line: string) => void
  signal?: AbortSignal
}

export interface VisualRun {
  sections: (VisualSectionScore & { comparison: Comparison | null })[]
  pages: { viewport: string; score: number }[]
  shots: TestShot[]
}

const NO_ANIMATION = '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}'

// ---- Tarayıcı içinde çalışan işlevler (serileştirilir; kendi içinde tam olmalı) ----

function findSourceRoot(arg: { tag: string; classes: string[]; expected: string }): number {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const words = (s: string): Set<string> => new Set(norm(s).split(' ').filter((w) => w.length > 2))
  const exp = words(arg.expected)
  if (!exp.size) return 0
  let sel = arg.tag
  if (arg.classes.length) sel += '.' + arg.classes.map((c) => CSS.escape(c)).join('.')
  let cands = Array.from(document.querySelectorAll(sel))
  if (!cands.length) cands = Array.from(document.querySelectorAll(arg.tag))
  let best: Element | null = null
  let bestScore = 0
  for (const el of cands) {
    const w = words(el.textContent ?? '')
    let inter = 0
    exp.forEach((x) => {
      if (w.has(x)) inter++
    })
    const uni = exp.size + w.size - inter
    const j = uni ? inter / uni : 0
    if (j > bestScore) {
      bestScore = j
      best = el
    }
  }
  if (!best || bestScore < 0.4) return 0
  document.querySelectorAll('[data-legt-root]').forEach((e) => e.removeAttribute('data-legt-root'))
  best.setAttribute('data-legt-root', '1')
  return bestScore
}

function fingerprint(selector: string): { w: number; h: number; bg: string; items: unknown[] } | null {
  const root = document.querySelector(selector)
  if (!root) return null
  const rr = root.getBoundingClientRect()
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80)
  const isClear = (c: string): boolean => /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)|transparent/.test(c)
  const items: unknown[] = []
  let imgN = 0
  let svgN = 0
  const pathOf = (el: Element): string => {
    const segs: string[] = []
    let cur: Element | null = el
    while (cur && cur !== root) {
      const tag = cur.tagName.toLowerCase()
      let idx = 1
      let sib = cur.previousElementSibling
      while (sib) {
        if (sib.tagName === cur.tagName) idx++
        sib = sib.previousElementSibling
      }
      segs.unshift(`${tag}:nth-of-type(${idx})`)
      cur = cur.parentElement
    }
    return segs.join(' > ')
  }
  const els = root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,li,span,strong,em,label,td,th,figcaption,blockquote,img,svg,input,textarea,select,time,small,cite,dt,dd,summary')
  for (const el of Array.from(els)) {
    if (items.length >= 300) break
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0 || cs.display === 'none' || cs.visibility === 'hidden') continue
    const tag = el.tagName.toLowerCase()
    let k = ''
    if (tag === 'img') k = `img#${++imgN}`
    else if (tag === 'svg') k = `svg#${++svgN}`
    else if (tag === 'input' || tag === 'textarea' || tag === 'select') k = norm((el as HTMLInputElement).placeholder || (el as HTMLInputElement).value || tag)
    else {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? '')
        .join(' ')
      k = norm(own)
      if (!k) continue
    }
    const align = cs.textAlign === 'start' || cs.textAlign === '-webkit-left' ? 'left' : cs.textAlign === 'end' || cs.textAlign === '-webkit-right' ? 'right' : cs.textAlign === '-webkit-center' ? 'center' : cs.textAlign
    items.push({
      k,
      tag,
      x: r.left - rr.left,
      y: r.top - rr.top,
      w: r.width,
      h: r.height,
      fs: parseFloat(cs.fontSize) || 0,
      fw: parseInt(cs.fontWeight, 10) || 400,
      lh: cs.lineHeight === 'normal' ? NaN : parseFloat(cs.lineHeight),
      ls: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0,
      color: cs.color,
      bg: cs.backgroundColor,
      radius: parseFloat(cs.borderTopLeftRadius) || 0,
      align,
      tt: cs.textTransform,
      path: pathOf(el)
    })
  }
  // Etkin arka plan: kökte yoksa tek çocuk zinciri boyunca (Elementor kabı → widget kabı → bölüm)
  let bgEl: Element = root
  let bg = getComputedStyle(bgEl).backgroundColor
  while (isClear(bg) && bgEl.children.length === 1) {
    bgEl = bgEl.children[0]
    bg = getComputedStyle(bgEl).backgroundColor
  }
  return { w: rr.width, h: rr.height, bg: isClear(bg) ? 'rgba(0, 0, 0, 0)' : bg, items }
}

async function pixelDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ({ a, b }) => {
      const load = async (b64: string): Promise<ImageBitmap> => createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob())
      const A = await load(a)
      const B = await load(b)
      const W = 64
      const H = Math.max(8, Math.min(256, Math.round((W * A.height) / A.width)))
      const draw = (img: ImageBitmap): Uint8ClampedArray => {
        const c = document.createElement('canvas')
        c.width = W
        c.height = H
        const x = c.getContext('2d', { willReadFrequently: true })!
        x.fillStyle = '#fff'
        x.fillRect(0, 0, W, H)
        x.drawImage(img, 0, 0, W, H)
        return x.getImageData(0, 0, W, H).data
      }
      const da = draw(A)
      const db = draw(B)
      let sum = 0
      for (let i = 0; i < da.length; i += 4) sum += (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3
      return sum / (da.length / 4) / 255
    },
    { a: a.toString('base64'), b: b.toString('base64') }
  )
}

// ---- Bağlamlar ----

async function offlineContext(browser: Browser, viewport: { width: number; height: number }, allow: (url: string) => boolean): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true })
  await ctx.route('**/*', (route) => (allow(route.request().url()) ? route.continue() : route.abort('blockedbyclient')))
  return ctx
}

const sectionText = (s: SectionSummary): string => cheerio.load(s.html).root().text()

async function settle(page: Page): Promise<void> {
  await page.addStyleTag({ content: NO_ANIMATION }).catch(() => undefined)
  // Tembel yüklenen görsel ve kaydırınca beliren öğeler için sayfayı bir kez kaydır
  await page
    .evaluate(async () => {
      const h = document.documentElement.scrollHeight
      for (let y = 0; y < h; y += 600) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 40))
      }
      window.scrollTo(0, 0)
    })
    .catch(() => undefined)
  await page.waitForTimeout(250)
}

// ---- Kaynak tarafı ----

async function measureSource(browser: Browser, input: MeasureInput, vp: ViewportName): Promise<void> {
  const need = input.targets.filter((t) => !input.cache.has(`${t.probe.sectionId}|${vp}`))
  if (!need.length) return
  const ctx = await offlineContext(browser, input.viewports[vp], (u) => u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:'))
  try {
    const remaining = new Set(need.map((t) => t.probe.sectionId))
    for (const src of input.sourcePages) {
      if (!remaining.size) break
      if (input.signal?.aborted) throw new Error('İptal edildi')
      const page = await ctx.newPage()
      try {
        await page.goto(pathToFileURL(src.abs).href, { waitUntil: 'load', timeout: NAV_TIMEOUT })
        await settle(page)
        for (const t of need) {
          if (!remaining.has(t.probe.sectionId)) continue
          const found = await page.evaluate(findSourceRoot, { tag: t.section.tag, classes: t.section.classes.slice(0, 3), expected: sectionText(t.section) })
          if (!found) continue
          const print = (await page.evaluate(fingerprint, '[data-legt-root]')) as VPrint | null
          if (!print) continue
          let png: Buffer | null = null
          const box = await page.locator('[data-legt-root]').first().boundingBox()
          if (box && box.height <= MAX_PIXEL_HEIGHT) png = await page.locator('[data-legt-root]').first().screenshot({ animations: 'disabled' }).catch(() => null)
          input.cache.set(`${t.probe.sectionId}|${vp}`, { print, png })
          remaining.delete(t.probe.sectionId)
        }
      } catch (e) {
        input.log(`Kaynak sayfa ölçülemedi (${src.name}): ${(e as Error).message.split('\n')[0]}`)
      } finally {
        await page.close()
      }
    }
    for (const id of remaining) input.cache.set(`${id}|${vp}`, null)
  } finally {
    await ctx.close()
  }
}

// ---- Üretilen taraf + puanlama ----

export async function measureVisual(input: MeasureInput): Promise<VisualRun> {
  const { browser, targets } = input
  const sections: VisualRun['sections'] = []
  const shots: TestShot[] = []
  await mkdir(input.shots.dir, { recursive: true })
  const scratch = await browser.newPage()
  try {
    for (const vp of ['desktop', 'tablet', 'mobile'] as ViewportName[]) {
      if (input.signal?.aborted) throw new Error('İptal edildi')
      await measureSource(browser, input, vp)
      const ctx = await offlineContext(browser, input.viewports[vp], (u) => u.startsWith(input.siteUrl) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:'))
      try {
        const page = await ctx.newPage()
        await page.goto(input.pages.test, { waitUntil: 'load', timeout: NAV_TIMEOUT })
        await settle(page)
        for (const t of targets) {
          const id = t.probe.sectionId
          const base = { sectionId: id, label: t.probe.label, viewport: vp, patched: 0, ...(t.probe.files.css || t.probe.files.main ? { file: t.probe.files.css ?? t.probe.files.main } : {}) }
          const src = input.cache.get(`${id}|${vp}`)
          if (!src) continue // kaynakta bulunamayan bölüm puanlanmaz
          const gen = (await page.evaluate(fingerprint, t.probe.selector)) as VPrint | null
          if (!gen) {
            sections.push({ ...base, total: 0, pixel: 0, layout: 0, type: 0, color: 0, content: 0, comparison: null })
            continue
          }
          let pixel: number | null = null
          const loc = page.locator(t.probe.selector).first()
          const genPng = gen.h <= MAX_PIXEL_HEIGHT ? await loc.screenshot({ animations: 'disabled' }).catch(() => null) : null
          if (src.png && genPng) pixel = pixelSimilarity(await pixelDiff(scratch, src.png, genPng).catch(() => 0.25))
          const comparison = compare(src.print, gen, pixel)
          sections.push({ ...base, ...comparison.score, comparison })
          if (vp === 'desktop' && src.png && genPng) {
            const stem = `visual-${id}`
            await writeFile(join(input.shots.dir, `${stem}-kaynak.png`), src.png)
            await writeFile(join(input.shots.dir, `${stem}-uretilen.png`), genPng)
            shots.push({ name: `Görsel ${t.probe.label} · kaynak`, viewport: vp, file: `${input.shots.rel}/${stem}-kaynak.png` })
            shots.push({ name: `Görsel ${t.probe.label} · üretilen (${comparison.score.total}/${MAX_SCORE})`, viewport: vp, file: `${input.shots.rel}/${stem}-uretilen.png` })
          }
        }
      } finally {
        await ctx.close()
      }
    }
    const pages = await comparePages(input, scratch)
    return { sections, pages, shots }
  } finally {
    await scratch.close().catch(() => undefined)
  }
}

/** Referans tam sayfa ekran görüntüsü (site adresi / ekran görüntüsü girişi) ile ana sayfanın piksel benzerliği */
async function comparePages(input: MeasureInput, scratch: Page): Promise<{ viewport: string; score: number }[]> {
  if (!input.refDir) return []
  const url = input.pages.demo ?? input.pages.home ?? input.pages.test
  const out: { viewport: string; score: number }[] = []
  for (const vp of ['desktop', 'tablet', 'mobile'] as ViewportName[]) {
    const file = join(input.refDir, `${vp}.png`)
    if (!existsSync(file)) continue
    const ctx = await offlineContext(input.browser, input.viewports[vp], (u) => u.startsWith(input.siteUrl) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:'))
    try {
      const page = await ctx.newPage()
      await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT })
      await settle(page)
      const gen = await page.screenshot({ fullPage: true, animations: 'disabled' })
      const ref = await readFile(file)
      out.push({ viewport: vp, score: Math.round(pixelSimilarity(await pixelDiff(scratch, ref, gen).catch(() => 0.25)) * MAX_SCORE) })
    } catch (e) {
      input.log(`Tam sayfa karşılaştırma (${vp}): ${(e as Error).message.split('\n')[0]}`)
    } finally {
      await ctx.close()
    }
  }
  return out
}

// ---- Rapor ve sorunlar ----

/** Bölüm başına görünüm penceresi ağırlıklı puan; kaynak yüksekliğine göre site puanı */
export function summarize(run: VisualRun, targets: VisualTarget[], cache: SourceCache, patches: number): VisualReport | null {
  // Hiçbir bölüm ya da sayfa ölçülemediyse (kaynak DOM'da bulunamadı) puan verilmez; 0 puan hata sayılmaz
  if (!run.sections.length && !run.pages.length) return null
  const bySection = new Map<string, VisualRun['sections']>()
  for (const s of run.sections) bySection.set(s.sectionId, [...(bySection.get(s.sectionId) ?? []), s])
  const perSection: { value: number; weight: number }[] = []
  for (const t of targets) {
    const list = bySection.get(t.probe.sectionId)
    if (!list?.length) continue
    const value = weightedMean(list.map((s) => ({ value: s.total, weight: VIEWPORT_WEIGHT[s.viewport as ViewportName] ?? 0.2 })))
    const height = cache.get(`${t.probe.sectionId}|desktop`)?.print.h ?? 400
    perSection.push({ value, weight: Math.max(60, height) })
  }
  let score = Math.round(weightedMean(perSection))
  // Bölüm ölçümü yoksa (kaynak DOM'da bölüm bulunamadı) tam sayfa karşılaştırmaya düşer
  if (!perSection.length && run.pages.length) score = Math.round(weightedMean(run.pages.map((p) => ({ value: p.score, weight: VIEWPORT_WEIGHT[p.viewport as ViewportName] ?? 0.2 }))))
  return {
    max: MAX_SCORE,
    threshold: PASS_SCORE,
    score,
    verdict: verdict(score),
    sections: run.sections.map(({ comparison: _c, ...rest }) => rest),
    pages: run.pages,
    patches
  }
}

/** 750 altı hata, 1050 altı uyarı; bölüm sorunları ilgili dosyaya bağlanır (LLM onarımı için ayrıntılı ölçüyle) */
export function visualIssues(run: VisualRun, report: VisualReport, targets: VisualTarget[]): TestIssue[] {
  const issues: TestIssue[] = []
  const worst = new Map<string, VisualRun['sections'][number]>()
  const mean = new Map<string, number>()
  for (const t of targets) {
    const list = run.sections.filter((s) => s.sectionId === t.probe.sectionId)
    if (!list.length) continue
    mean.set(t.probe.sectionId, weightedMean(list.map((s) => ({ value: s.total, weight: VIEWPORT_WEIGHT[s.viewport as ViewportName] ?? 0.2 }))))
    worst.set(t.probe.sectionId, list.reduce((a, b) => (b.total < a.total ? b : a)))
  }
  for (const t of targets) {
    const total = mean.get(t.probe.sectionId)
    const w = worst.get(t.probe.sectionId)
    if (total === undefined || !w) continue
    const v = verdict(Math.round(total))
    if (v === 'pass') continue
    const file = t.probe.files.css ?? t.probe.files.main
    issues.push({
      kind: 'visual',
      severity: v === 'fail' ? 'error' : 'warning',
      message: `${t.probe.label}: görsel benzerlik ${Math.round(total)}/${MAX_SCORE}${v === 'fail' ? ` (eşik ${PASS_SCORE})` : ` (hedef ${GOOD_SCORE}+)`}`,
      viewport: w.viewport,
      sectionId: t.probe.sectionId,
      ...(file ? { file } : {}),
      detail: w.comparison ? describeComparison(w.comparison) : 'Bölüm üretilen sayfada render edilmedi'
    })
  }
  if (report.verdict === 'fail') {
    issues.push({ kind: 'visual', severity: 'error', message: `Görsel benzerlik puanı ${report.score}/${MAX_SCORE}: ${PASS_SCORE} eşiğinin altında` })
  } else if (report.verdict === 'warn') {
    issues.push({ kind: 'visual', severity: 'warning', message: `Görsel benzerlik puanı ${report.score}/${MAX_SCORE} (iyi: ${GOOD_SCORE}+)` })
  }
  return issues
}

// ---- Otomatik CSS düzeltmesi ----

export interface CssRule {
  vp: ViewportName
  sel: string
  prop: StyleDiff['prop']
  val: string
}

const BLOCK_START = '/* legt:visual:start — LEGT AI görsel birebirlik düzeltmeleri (otomatik; elle düzenlemeyin) */'
const BLOCK_END = '/* legt:visual:end */'

/** Ölçüm farklarından kural çıkarır; kaynaktaki değer üretilene yazılır */
export function rulesFrom(run: VisualRun, targets: VisualTarget[]): Map<string, CssRule[]> {
  const out = new Map<string, CssRule[]>()
  for (const t of targets) {
    if (!t.patchRoot || !t.cssFile) continue
    for (const s of run.sections) {
      if (s.sectionId !== t.probe.sectionId || !s.comparison) continue
      for (const d of s.comparison.diffs) {
        out.set(t.cssFile, [...(out.get(t.cssFile) ?? []), { vp: s.viewport as ViewportName, sel: `${t.patchRoot} ${d.path}`, prop: d.prop, val: d.want }])
      }
    }
  }
  return out
}

/** Kural listesini birleştirir (aynı vp+sel+prop için yenisi geçer) */
export function mergeRules(old: CssRule[], fresh: CssRule[]): CssRule[] {
  const map = new Map<string, CssRule>()
  for (const r of [...old, ...fresh]) map.set(`${r.vp}|${r.sel}|${r.prop}`, r)
  return [...map.values()]
}

export function renderBlock(rules: CssRule[], viewports: Viewports): string {
  if (!rules.length) return ''
  const wide = new Map<string, string>()
  const body = (vp: ViewportName): string[] => {
    const lines: string[] = []
    for (const r of rules.filter((x) => x.vp === vp)) {
      const key = `${r.sel}|${r.prop}`
      // Daha geniş pencerede aynı değer zaten varsa tekrar yazılmaz
      if (vp !== 'desktop' && wide.get(key) === r.val) continue
      if (vp === 'desktop') wide.set(key, r.val)
      else if (vp === 'tablet') wide.set(key, r.val)
      lines.push(`${r.sel} { ${r.prop}: ${r.val} !important; }`)
    }
    return lines
  }
  const parts = [BLOCK_START, ...body('desktop')]
  const tablet = body('tablet')
  if (tablet.length) parts.push(`@media (max-width: ${viewports.tablet.width}px) {`, ...tablet.map((l) => '  ' + l), '}')
  const mobile = body('mobile')
  if (mobile.length) parts.push(`@media (max-width: ${viewports.mobile.width}px) {`, ...mobile.map((l) => '  ' + l), '}')
  parts.push(BLOCK_END)
  return parts.join('\n')
}

/** CSS dosyasındaki eski bloğu çıkarıp yenisini sona ekler */
export function applyBlock(css: string, block: string): string {
  const stripped = css.replace(/\n*\/\* legt:visual:start[\s\S]*?\/\* legt:visual:end \*\/\n*/g, '\n')
  return block ? `${stripped.replace(/\s+$/, '')}\n\n${block}\n` : stripped
}
