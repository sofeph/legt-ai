/// <reference lib="dom" />
// page.evaluate geri çağrıları tarayıcıda çalışır; DOM tipleri yalnızca bu dosyada gerekli
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core'
import { clipText, compactHtml } from '../html/relevantCss'
import type { TestIssue, TestShot } from '../types'
import type { Attributor } from './attribute'
import { describeStep, stepSelectors, type Scenario, type ScenarioStep, type ViewportName } from './scenarios'

/** Test sayfasında bulunacak bir bölüm (widget / pattern / template part) */
export interface Probe {
  sectionId: string
  label: string
  selector: string
  /** Örnek HTML'deki başlıklar; render edilen bölümde görünmeli */
  headings: string[]
  js: string
  files: { main?: string; css?: string; js?: string }
  /**
   * Bölümü sayfaya basan kap (Elementor header/footer layout'u). Kap yoksa sorun widget'ta değil
   * kabı basması gereken dosyadadır (tema header.php / footer.php).
   */
  container?: { selector: string; file?: string; label: string }
}

export interface SitePages {
  home: string
  post: string
  search: string
  notFound: string
  test: string
  editor?: string
  /** Demo içe aktarıcının oluşturduğu ana sayfa */
  demo?: string
}

export type Viewports = Record<ViewportName, { width: number; height: number }>

export interface CheckInput {
  siteUrl: string
  pages: SitePages
  probes: Probe[]
  viewports: Viewports
  /** Mutlak klasör ve proje köküne göre karşılığı (rapor için) */
  shots: { dir: string; rel: string }
  editor: 'elementor' | null
  adminPass: string
  attr: Attributor
  /** Bölüme bağlanamayan taşma/stil sorunlarının dosyası */
  fallbackCss?: string
  /** İçe aktarılan demo sayfasında en az bir kendi widget'ımız görünmeli */
  demo?: { selector: string; file: string }
  /** wp_head / wp_body_open / wp_footer'ı çağırması gereken tema dosyaları (klasik tema) */
  hookFiles?: { head?: string; footer?: string }
  log: (line: string) => void
  signal?: AbortSignal
}

export interface CheckResult {
  issues: TestIssue[]
  shots: TestShot[]
  /** Bölümün render edilmiş HTML'i (masaüstü, sıkıştırılmış) — senaryo ve onarım prompt'larına gider */
  snapshots: Record<string, string>
}

const NAV_TIMEOUT = 45000
const STEP_TIMEOUT = 3000
const PHP_TEXT_RE = /(?:<b>)?(Fatal error|Parse error|Warning|Notice|Deprecated)(?:<\/b>)?:\s.{0,200}? in (?:<b>)?[^<\n]+\.php/i
const CRITICAL_RE = /There has been a critical error on this website|Bu web sitesinde ciddi bir hata oluştu/i

/**
 * Tarayıcı: runtime/browsers altında Playwright Chromium varsa o; yoksa sistemdeki Edge, sonra Chrome.
 * PLAYWRIGHT_BROWSERS_PATH playwright-core ilk yüklenmeden ayarlanmalı.
 */
export async function openBrowser(browsersDir: string, log: (l: string) => void): Promise<Browser> {
  if (existsSync(browsersDir)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir
  const { chromium } = await import('playwright-core')
  const errors: string[] = []
  for (const opt of [{}, { channel: 'msedge' }, { channel: 'chrome' }] as const) {
    try {
      const b = await chromium.launch({ headless: true, ...opt })
      log(`Tarayıcı: ${'channel' in opt ? opt.channel : 'chromium'} ${b.version()}`)
      return b
    } catch (e) {
      errors.push(`${'channel' in opt ? opt.channel : 'chromium'}: ${(e as Error).message.split('\n')[0]}`)
    }
  }
  throw new Error(`Tarayıcı başlatılamadı. "npm run setup:runtime" ile Chromium kurun ya da Edge/Chrome yükleyin.\n${errors.join('\n')}`)
}

const isLocal = (url: string, siteUrl: string): boolean => url.startsWith(siteUrl) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')

/** Çevrim dışı: siteye ait olmayan her istek (Google Fonts, CDN...) engellenir */
async function newContext(browser: Browser, input: CheckInput, vp: ViewportName): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: input.viewports[vp], ignoreHTTPSErrors: true })
  await ctx.route('**/*', (route) => (isLocal(route.request().url(), input.siteUrl) ? route.continue() : route.abort('blockedbyclient')))
  return ctx
}

/** Sayfa dinleyicileri: konsol, yakalanmamış JS hatası, başarısız yerel istekler */
function watch(page: Page, input: CheckInput, where: { url: string; viewport: string; kind: 'console' | 'editor' }, sink: TestIssue[]): void {
  const { attr } = input
  page.on('pageerror', (err) => {
    const owned = attr.firstOwned(`${err.stack ?? ''}\n${err.message}`)
    if (where.kind === 'editor' && !owned) return // Elementor editörünün kendi gürültüsü
    sink.push({
      kind: where.kind,
      severity: 'error',
      message: `JS hatası: ${err.message.split('\n')[0].slice(0, 300)}`,
      url: where.url,
      viewport: where.viewport,
      ...(owned ? { file: owned.file } : {}),
      detail: (err.stack ?? err.message).slice(0, 2000)
    })
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (/^Failed to load resource/i.test(text)) return // response dinleyicisi raporlar
    const loc = msg.location().url
    if (loc && !isLocal(loc, input.siteUrl)) return
    const owned = attr.firstOwned(`${loc}\n${text}`) ?? (attr.toOutput(loc) ? { file: attr.toOutput(loc)! } : undefined)
    if (where.kind === 'editor' && !owned) return
    sink.push({ kind: where.kind, severity: 'error', message: `Konsol hatası: ${text.split('\n')[0].slice(0, 300)}`, url: where.url, viewport: where.viewport, ...(owned ? { file: owned.file } : {}) })
  })
  page.on('response', (res) => {
    const url = res.url()
    if (!url.startsWith(input.siteUrl) || res.status() < 400) return
    const type = res.request().resourceType()
    if (!['stylesheet', 'script', 'image', 'font'].includes(type) || /favicon\.ico/.test(url)) return
    const file = attr.toOutput(url)
    sink.push({
      kind: 'asset',
      severity: file ? 'error' : 'warning',
      message: `${type} yüklenemedi (HTTP ${res.status()}): ${url.replace(input.siteUrl, '')}`,
      url: where.url,
      viewport: where.viewport,
      // Planda olan dosya 404 veriyorsa yol yanlış kaydedilmiştir; planda olmayan dosyaya işaret ediyorsa da kaydeden dosya bilinmez
      ...(file && attr.inPlan(file) ? {} : file ? { detail: `İstenen yol üretilen dosyalarda yok: ${file}` } : {})
    })
  })
}

async function goto(page: Page, url: string): Promise<number> {
  const res = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT })
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined)
  return res?.status() ?? 0
}

/** Bölüm köklerini işaretler ki taşma kontrolü sorunu bölüme bağlayabilsin */
async function markProbes(page: Page, probes: Probe[]): Promise<void> {
  await page.evaluate(
    (list) => {
      for (const p of list) document.querySelector(p.selector)?.setAttribute('data-legt-probe', p.sectionId)
    },
    probes.map((p) => ({ selector: p.selector, sectionId: p.sectionId }))
  )
}

interface Overflow {
  scrollWidth: number
  width: number
  items: { tag: string; cls: string; probe: string | null; right: number }[]
}

async function overflow(page: Page): Promise<Overflow | null> {
  return page.evaluate(() => {
    const doc = document.documentElement
    const w = doc.clientWidth
    if (doc.scrollWidth <= w + 1) return null
    const offenders: Element[] = []
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > w + 1 && getComputedStyle(el).position !== 'fixed') offenders.push(el)
    }
    const outer = offenders.filter((el) => !offenders.includes(el.parentElement as Element)).slice(0, 5)
    return {
      scrollWidth: doc.scrollWidth,
      width: w,
      items: outer.map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
        probe: el.closest('[data-legt-probe]')?.getAttribute('data-legt-probe') ?? null,
        right: Math.round(el.getBoundingClientRect().right)
      }))
    }
  })
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** ADIM: sayfa sayfa, viewport viewport temel kontroller */
export async function runChecks(browser: Browser, input: CheckInput): Promise<CheckResult> {
  const issues: TestIssue[] = []
  const shots: TestShot[] = []
  const snapshots: Record<string, string> = {}
  await mkdir(input.shots.dir, { recursive: true })
  const { pages } = input

  const plan: { vp: ViewportName; name: keyof SitePages; expect: number }[] = [
    { vp: 'desktop', name: 'test', expect: 200 },
    { vp: 'desktop', name: 'home', expect: 200 },
    { vp: 'desktop', name: 'post', expect: 200 },
    { vp: 'desktop', name: 'search', expect: 200 },
    { vp: 'desktop', name: 'notFound', expect: 404 },
    { vp: 'desktop', name: 'demo', expect: 200 },
    { vp: 'mobile', name: 'demo', expect: 200 },
    { vp: 'tablet', name: 'test', expect: 200 },
    { vp: 'mobile', name: 'test', expect: 200 },
    { vp: 'mobile', name: 'home', expect: 200 }
  ]

  for (const vp of ['desktop', 'tablet', 'mobile'] as ViewportName[]) {
    const ctx = await newContext(browser, input, vp)
    try {
      for (const step of plan.filter((p) => p.vp === vp)) {
        if (input.signal?.aborted) throw new Error('İptal edildi')
        const url = pages[step.name]
        if (!url) continue
        const page = await ctx.newPage()
        const where = { url: url.replace(input.siteUrl, '') || '/', viewport: vp }
        watch(page, input, { ...where, kind: 'console' }, issues)
        input.log(`${vp} ${where.url}`)
        let status = 0
        try {
          status = await goto(page, url)
        } catch (e) {
          issues.push({ kind: 'http', severity: 'error', message: `Sayfa açılamadı: ${(e as Error).message.split('\n')[0]}`, ...where })
          await page.close()
          continue
        }
        const html = await page.content()
        if (CRITICAL_RE.test(html) || status >= 500) {
          issues.push({ kind: 'http', severity: 'error', message: `HTTP ${status}: WordPress kritik hata sayfası (ayrıntı PHP loglarında)`, ...where })
        } else if (status !== step.expect) {
          issues.push({ kind: 'http', severity: step.name === 'notFound' ? 'warning' : 'error', message: `HTTP ${status} (beklenen ${step.expect})`, ...where })
        }
        if (status < 400 || step.name === 'notFound') {
          const hooks = [
            ['wp_head', input.hookFiles?.head, 'error'],
            ['wp_body_open', input.hookFiles?.head, 'warning'],
            ['wp_footer', input.hookFiles?.footer, 'error']
          ] as const
          for (const [hook, file, severity] of hooks) {
            if (!html.includes(`<!-- legt:${hook} -->`)) {
              issues.push({ kind: 'render', severity, message: `Tema ${hook}() çağırmıyor; eklenti stilleri/scriptleri${hook === 'wp_footer' ? ' ve Elementor editör önizlemesi' : ''} çalışmaz`, ...where, ...(file ? { file } : {}) })
            }
          }
        }
        const php = PHP_TEXT_RE.exec(html)
        if (php) {
          const owned = input.attr.firstOwned(php[0])
          issues.push({ kind: 'php', severity: 'error', message: `Sayfada PHP hatası görünüyor: ${php[0].replace(/<\/?b>/g, '').slice(0, 300)}`, ...where, ...(owned ? { file: owned.file } : {}) })
        }

        if (step.name === 'demo' && input.demo && vp === 'desktop') {
          const widgets = await page.locator(input.demo.selector).count()
          if (!widgets) {
            issues.push({ kind: 'render', severity: 'error', file: input.demo.file, message: "İçe aktarılan demo ana sayfasında hiçbir tema widget'ı görünmüyor (demo JSON boş ya da widget adları yanlış)", ...where })
          }
        }

        if (step.name === 'test') {
          await markProbes(page, input.probes)
          for (const probe of input.probes) {
            const root = page.locator(probe.selector).first()
            const files = { main: probe.files.main, css: probe.files.css ?? input.fallbackCss }
            if ((await root.count()) === 0) {
              const noContainer = probe.container && (await page.locator(probe.container.selector).count()) === 0
              issues.push({
                kind: 'render',
                severity: 'error',
                sectionId: probe.sectionId,
                file: noContainer ? probe.container!.file : files.main,
                message: noContainer
                  ? `${probe.container!.label} sayfaya basılmadı, ${probe.label} bu yüzden görünmüyor (${probe.container!.file ?? 'tema'} layout'u çağırmıyor)`
                  : `${probe.label} sayfada render edilmedi (kayıt, get_name() ya da render() hatası)`,
                ...where
              })
              continue
            }
            if (vp !== 'desktop') continue
            const box = await root.boundingBox()
            const text = norm(await root.innerText().catch(() => ''))
            if (!box || box.height < 8 || (!text && !(await root.locator('img, svg, video, iframe').count()))) {
              issues.push({ kind: 'render', severity: 'error', sectionId: probe.sectionId, file: files.main, message: `${probe.label} boş render ediliyor (yükseklik ${Math.round(box?.height ?? 0)}px, metin yok)`, ...where })
            }
            const missing = probe.headings.filter((h) => norm(h).length > 2 && !text.includes(norm(h)))
            if (probe.headings.length && missing.length) {
              const all = missing.length === probe.headings.length
              issues.push({
                kind: 'content',
                severity: all ? 'error' : 'warning',
                sectionId: probe.sectionId,
                file: files.main,
                message: `${probe.label}: örnek HTML'deki ${all ? 'başlıkların hiçbiri' : 'bazı başlıklar'} görünmüyor (varsayılan içerik): ${missing.slice(0, 4).map((m) => `"${m.slice(0, 60)}"`).join(', ')}`,
                ...where
              })
            }
            const broken = await root.evaluate((el, site) =>
              Array.from(el.querySelectorAll('img'))
                .filter((img) => img.complete && img.naturalWidth === 0 && (img.currentSrc || img.src).startsWith(site))
                .map((img) => img.currentSrc || img.src),
              input.siteUrl
            )
            for (const src of broken.slice(0, 3)) {
              issues.push({ kind: 'asset', severity: 'warning', sectionId: probe.sectionId, file: files.main, message: `${probe.label}: görsel yüklenmedi: ${src.replace(input.siteUrl, '')}`, ...where })
            }
            snapshots[probe.sectionId] = clipText(compactHtml(await root.evaluate((el) => el.outerHTML)), 6000)
            const file = join(input.shots.dir, `section-${probe.sectionId}.png`)
            if (box && box.height >= 8) {
              await root.screenshot({ path: file, timeout: 10000 }).then(
                () => shots.push({ name: probe.label, viewport: vp, file: `${input.shots.rel}/section-${probe.sectionId}.png` }),
                () => undefined
              )
            }
          }
        }

        if (vp !== 'desktop' && (step.name === 'test' || step.name === 'home' || step.name === 'demo')) {
          if (step.name !== 'test') await markProbes(page, input.probes)
          const o = await overflow(page)
          if (o) {
            const byProbe = o.items.find((i) => i.probe)
            const probe = input.probes.find((p) => p.sectionId === byProbe?.probe)
            issues.push({
              kind: 'overflow',
              severity: 'error',
              ...(probe ? { sectionId: probe.sectionId } : {}),
              file: probe?.files.css ?? input.fallbackCss,
              message: `${vp} (${o.width}px): yatay taşma, sayfa ${o.scrollWidth}px genişliğinde${probe ? ` — ${probe.label}` : ''}`,
              detail: o.items.map((i) => `<${i.tag} class="${i.cls}"> sağ kenar ${i.right}px${i.probe ? ` (bölüm ${i.probe})` : ''}`).join('\n'),
              ...where
            })
          }
        }

        if (step.name === 'test' || step.name === 'home' || step.name === 'demo') {
          const name = `${step.name}-${vp}.png`
          await page.screenshot({ path: join(input.shots.dir, name), fullPage: true, timeout: 20000 }).then(
            () => shots.push({ name: `${{ test: 'Test sayfası', home: 'Ana sayfa', demo: 'Demo ana sayfa' }[step.name as 'test' | 'home' | 'demo']} (${vp})`, viewport: vp, file: `${input.shots.rel}/${name}` }),
            () => undefined
          )
        }
        await page.close()
      }
    } finally {
      await ctx.close()
    }
  }

  if (input.editor === 'elementor' && pages.editor) issues.push(...(await checkElementorEditor(browser, input, shots)))
  return { issues, shots, snapshots }
}

async function login(page: Page, input: CheckInput): Promise<void> {
  await page.goto(`${input.siteUrl}/wp-login.php`, { waitUntil: 'load', timeout: NAV_TIMEOUT })
  await page.fill('#user_login', 'admin')
  await page.fill('#user_pass', input.adminPass)
  await Promise.all([page.waitForURL(/wp-admin/, { timeout: NAV_TIMEOUT }), page.click('#wp-submit')])
}

/** Elementor editörü açılıyor mu, widget'lar önizlemede görünüyor mu */
async function checkElementorEditor(browser: Browser, input: CheckInput, shots: TestShot[]): Promise<TestIssue[]> {
  const issues: TestIssue[] = []
  const snap = async (page: Page): Promise<void> => {
    await page.screenshot({ path: join(input.shots.dir, 'editor-desktop.png'), timeout: 15000 }).then(
      () => shots.push({ name: 'Elementor editörü', viewport: 'desktop', file: `${input.shots.rel}/editor-desktop.png` }),
      () => undefined
    )
  }
  const ctx = await newContext(browser, input, 'desktop')
  const where = { url: 'Elementor editörü', viewport: 'desktop' }
  try {
    const page = await ctx.newPage()
    watch(page, input, { ...where, kind: 'editor' }, issues)
    input.log('Elementor editörü açılıyor…')
    await login(page, input)
    await page.goto(input.pages.editor!, { waitUntil: 'load', timeout: NAV_TIMEOUT })
    const iframe = page.locator('#elementor-preview-iframe')
    try {
      await iframe.waitFor({ state: 'attached', timeout: 60000 })
    } catch {
      const body = clipText(norm(await page.locator('body').innerText().catch(() => '')), 600)
      issues.push({ kind: 'editor', severity: 'error', message: 'Elementor editörü yüklenemedi (önizleme çerçevesi yok)', detail: body, ...where })
      await snap(page)
      return issues
    }
    const frame = page.frameLocator('#elementor-preview-iframe')
    // Header/footer layout'ları ayrı belgedir; editörde yalnızca test sayfasının widget'ları beklenir
    const content = input.probes.filter((p) => !p.container)
    const failed = page.getByText(/preview could not be loaded/i).first()
    const outcome = await Promise.race([
      failed.waitFor({ state: 'visible', timeout: 60000 }).then(() => 'failed' as const),
      (content[0] ? frame.locator(content[0].selector).first() : frame.locator('body')).waitFor({ state: 'attached', timeout: 60000 }).then(() => 'loaded' as const)
    ]).catch(() => 'timeout' as const)
    if (outcome !== 'loaded') {
      issues.push({
        kind: 'editor',
        severity: 'error',
        message: outcome === 'failed' ? 'Elementor editör önizlemesi yüklenemedi ("The preview could not be loaded")' : 'Elementor editör önizlemesi 60 sn içinde açılmadı',
        detail: 'Önizleme, temanın wp_head(), wp_footer() ve the_content() çağırmasını ister; bu kancalarla ilgili render sorunlarına ve PHP hatalarına bakın.',
        ...where
      })
      await snap(page)
      return issues
    }
    for (const probe of content) {
      const el = frame.locator(probe.selector).first()
      const ok = await el.waitFor({ state: 'attached', timeout: 20000 }).then(
        () => true,
        () => false
      )
      if (!ok) issues.push({ kind: 'editor', severity: 'error', sectionId: probe.sectionId, file: probe.files.main, message: `${probe.label} editör önizlemesinde görünmüyor`, ...where })
    }
    await snap(page)
  } catch (e) {
    issues.push({ kind: 'editor', severity: 'warning', message: `Editör testi tamamlanamadı: ${(e as Error).message.split('\n')[0]}`, ...where })
  } finally {
    await ctx.close()
  }
  return issues
}

// ---- LLM senaryoları ----

async function poll(fn: () => Promise<boolean>, timeout = STEP_TIMEOUT): Promise<boolean> {
  const end = Date.now() + timeout
  for (;;) {
    if (await fn().catch(() => false)) return true
    if (Date.now() > end) return false
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function runStep(page: Page, root: Locator, s: ScenarioStep, viewports: Viewports): Promise<string | null> {
  const loc = (sel: string): Locator => (sel === '&' ? root : root.locator(sel).first())
  if ('do' in s) {
    switch (s.do) {
      case 'click':
        await loc(s.selector).click({ timeout: STEP_TIMEOUT })
        return null
      case 'hover':
        await loc(s.selector).hover({ timeout: STEP_TIMEOUT })
        return null
      case 'focus':
        await loc(s.selector).focus({ timeout: STEP_TIMEOUT })
        return null
      case 'fill':
        await loc(s.selector).fill(s.value, { timeout: STEP_TIMEOUT })
        return null
      case 'press':
        await page.keyboard.press(s.key === 'Space' ? ' ' : s.key)
        return null
      case 'wait':
        await page.waitForTimeout(s.ms)
        return null
      case 'viewport':
        await page.setViewportSize(viewports[s.name])
        await page.waitForTimeout(300)
        return null
    }
  }
  const l = loc(s.selector)
  const all = s.selector === '&' ? root : root.locator(s.selector)
  let ok: boolean
  switch (s.expect) {
    case 'visible':
      ok = await poll(() => l.isVisible())
      return ok ? null : 'görünür değil'
    case 'hidden':
      ok = await poll(async () => !(await l.isVisible()))
      return ok ? null : 'hâlâ görünür'
    case 'exists':
      ok = await poll(async () => (await all.count()) > 0)
      return ok ? null : 'eleman yok'
    case 'count': {
      let n = 0
      ok = await poll(async () => (n = await all.count()) >= s.min)
      return ok ? null : `${n} eleman bulundu`
    }
    case 'text': {
      let t = ''
      ok = await poll(async () => norm((t = await l.innerText())).includes(norm(s.contains)))
      return ok ? null : `metin: "${t.slice(0, 120)}"`
    }
    case 'class': {
      let c = ''
      ok = await poll(async () => ((c = (await l.getAttribute('class')) ?? '').split(/\s+/).includes(s.contains)))
      return ok ? null : `class="${c.slice(0, 120)}"`
    }
    case 'attr': {
      let v: string | null = null
      ok = await poll(async () => ((v = await l.getAttribute(s.name)) ?? '').includes(s.contains))
      return ok ? null : `${s.name}=${v === null ? '(yok)' : `"${String(v).slice(0, 120)}"`}`
    }
  }
}

/**
 * Senaryolar test sayfasında, her biri temiz bir sayfa yüklemesiyle çalışır.
 * Seçicisi DOM'da hiç olmayan senaryo modelin uydurmasıdır: atlanır, onarım tetiklemez.
 */
export async function runScenarios(browser: Browser, input: CheckInput, scenarios: Scenario[]): Promise<{ issues: TestIssue[]; run: number; skipped: number }> {
  const issues: TestIssue[] = []
  let run = 0
  let skipped = 0
  const ctx = await newContext(browser, input, 'desktop')
  try {
    for (const sc of scenarios) {
      if (input.signal?.aborted) throw new Error('İptal edildi')
      const probe = input.probes.find((p) => p.sectionId === sc.sectionId)
      if (!probe) continue
      const page = await ctx.newPage()
      const errors: TestIssue[] = []
      watch(page, input, { url: '/ (senaryo)', viewport: 'desktop', kind: 'console' }, errors)
      try {
        await page.setViewportSize(input.viewports.desktop)
        await goto(page, input.pages.test)
        const root = page.locator(probe.selector).first()
        const missing: string[] = []
        for (const sel of stepSelectors(sc)) if (sel !== '&' && (await root.locator(sel).count().catch(() => 0)) === 0) missing.push(sel)
        if ((await root.count()) === 0 || missing.length) {
          skipped++
          input.log(`Senaryo atlandı (${probe.label} / ${sc.name}): seçici yok ${missing.join(', ')}`)
          continue
        }
        run++
        input.log(`Senaryo: ${probe.label} / ${sc.name}`)
        for (const [i, step] of sc.steps.entries()) {
          let failure: string | null
          try {
            failure = await runStep(page, root, step, input.viewports)
          } catch (e) {
            failure = (e as Error).message.split('\n')[0]
          }
          if (failure) {
            const after = clipText(compactHtml(await root.evaluate((el) => el.outerHTML).catch(() => '')), 3000)
            issues.push({
              kind: 'scenario',
              severity: 'error',
              sectionId: probe.sectionId,
              file: probe.files.js ?? probe.files.main,
              message: `${probe.label} — "${sc.name}" adım ${i + 1} başarısız: ${describeStep(step)} → ${failure}`,
              url: '/ (test sayfası)',
              viewport: 'desktop',
              detail: `Senaryo adımları:\n${sc.steps.map((s, j) => `${j + 1}. ${describeStep(s)}`).join('\n')}\n\nBaşarısızlık anındaki HTML:\n${after}`
            })
            break
          }
        }
        // Senaryo sırasında çıkan JS hataları bölümün JS dosyasına aittir
        issues.push(...errors.map((e) => ({ ...e, sectionId: probe.sectionId, file: e.file ?? probe.files.js })))
      } finally {
        await page.close()
      }
    }
  } finally {
    await ctx.close()
  }
  return { issues, run, skipped }
}
