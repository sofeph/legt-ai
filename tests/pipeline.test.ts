import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LLMProvider } from '@core/llm/provider'
import { generate, saveManualEdit } from '@core/pipeline/generate'
import { packageProject, readOutputTree } from '@core/pipeline/package'
import { qualityChecklist } from '@core/pipeline/quality'
import { ProjectStore } from '@core/project/store'
import { renderScaffold } from '@core/scaffold'
import type { Plan } from '@core/types'
import { validateFile } from '@core/validate'
import { blockPlan, elementorPlan, fakeProvider, intake, pre, promptsDir, scaffoldDir, theme, validContent, WIDGETS } from './helpers'

describe('normalizePlan + buildFiles', () => {
  it('Elementor: widget adları önekli, dosyalar deterministik', async () => {
    const plan = await elementorPlan()
    expect(plan.sections.map((s) => s.widget)).toEqual(WIDGETS.map((w) => `trk-${w}`))
    const llm = plan.files.filter((f) => f.source === 'llm').map((f) => f.path)
    expect(llm).toContain('turkuaz-elementor-widgets/widgets/class-hero.php')
    expect(llm).toContain('turkuaz-elementor-widgets/assets/js/testimonials.js')
    expect(llm).not.toContain('turkuaz-elementor-widgets/assets/js/hero.js')
    expect(llm).toContain('turkuaz/assets/css/theme.css')
    // Tasarımdan bağımsız: şablondan üretilir, LLM'e gitmez
    const scaffold = plan.files.filter((f) => f.source === 'scaffold').map((f) => f.path)
    expect(scaffold).toEqual(expect.arrayContaining(['turkuaz/header.php', 'turkuaz/footer.php', 'turkuaz-elementor-widgets/demo/home.json', 'turkuaz-elementor-widgets/demo/header.json', 'turkuaz-elementor-widgets/demo/footer.json']))
    expect(llm.filter((p) => scaffold.includes(p))).toEqual([])
    const css = plan.files.find((f) => f.path.endsWith('css/hero.css'))!
    expect(css.dependsOn).toEqual(['turkuaz-elementor-widgets/widgets/class-hero.php'])
  })

  it('Elementor demo JSON\'ları plandan: home içerik widget\'ları, header/footer kendi widget\'ı, kararlı id\'ler', async () => {
    const plan = await elementorPlan()
    const files = await renderScaffold(scaffoldDir, plan, pre)
    const widgets = (path: string): string[] => {
      const out: string[] = []
      const walk = (els: { widgetType?: string; elements?: unknown[] }[]): void => els.forEach((e) => (e.widgetType && out.push(e.widgetType), walk((e.elements ?? []) as never)))
      walk(JSON.parse(files.get(`turkuaz-elementor-widgets/demo/${path}`)!).content)
      return out
    }
    expect(widgets('home.json')).toEqual(['trk-hero', 'trk-features', 'trk-testimonials', 'trk-faq'])
    expect(widgets('header.json')).toEqual(['trk-header'])
    expect(widgets('footer.json')).toEqual(['trk-footer'])
    expect((await renderScaffold(scaffoldDir, plan, pre)).get('turkuaz-elementor-widgets/demo/home.json')).toBe(files.get('turkuaz-elementor-widgets/demo/home.json'))
  })

  it('Block: header/footer parça, diğerleri pattern; slug ve className tutarlı', async () => {
    const plan = await blockPlan()
    expect(plan.sections[1]).toMatchObject({ slug: 'turkuaz/hero', className: null })
    expect(plan.sections[3]).toMatchObject({ slug: 'turkuaz/testimonials', className: 'trk-testimonials' })
    const llm = plan.files.filter((f) => f.source === 'llm').map((f) => f.path)
    expect(llm[0]).toBe('turkuaz/theme.json')
    expect(llm).toEqual(expect.arrayContaining(['turkuaz/parts/header.html', 'turkuaz/parts/footer.html', 'turkuaz/patterns/hero.php', 'turkuaz/assets/js/theme.js']))
    expect(llm).not.toContain('turkuaz/patterns/header.php')
  })
})

describe('scaffold', () => {
  for (const mode of ['elementor-free', 'block-theme'] as const) {
    it(`${mode}: tüm scaffold dosyaları kendi doğrulayıcılarımızdan geçer`, async () => {
      const plan = mode === 'elementor-free' ? await elementorPlan() : await blockPlan()
      const files = await renderScaffold(scaffoldDir, plan, pre)
      expect(files.size).toBeGreaterThan(5)
      for (const [path, content] of files) {
        expect(content, path).not.toMatch(/\{\{\w+\}\}/)
        const issues = await validateFile(path, content, { mode, slug: theme.slug, prefix: theme.prefix, usePhpLint: false })
        expect(issues, `${path}\n${JSON.stringify(issues)}`).toEqual([])
      }
    })
  }

  it('Elementor manifest\'i class, dosya ve asset yollarını plan\'dan alır', async () => {
    const plan = await elementorPlan()
    const m = (await renderScaffold(scaffoldDir, plan, pre)).get('turkuaz-elementor-widgets/includes/widgets-manifest.php')!
    expect(m).toContain("'class' => '\\\\Trk\\\\Widgets\\\\Widget_Hero'")
    expect(m).toContain("'js'    => 'assets/js/testimonials.js'")
    expect(m).toContain("'file'  => 'widgets/class-faq.php'")
  })

  it('tema adındaki tek tırnak PHP string\'ini bozmaz', async () => {
    const plan = await elementorPlan()
    plan.theme = { ...plan.theme, name: "Ali'nin Teması" }
    const fn = (await renderScaffold(scaffoldDir, plan, pre)).get('turkuaz/functions.php')!
    expect(fn).toContain("Ali\\'nin Teması")
  })

  it('Block: front-page pattern\'leri sırayla çağırır; header bölümü yoksa yedek parça eklenir', async () => {
    const plan = await blockPlan()
    const files = await renderScaffold(scaffoldDir, plan, pre)
    const fp = files.get('turkuaz/templates/front-page.html')!
    expect(fp.indexOf('turkuaz/hero')).toBeLessThan(fp.indexOf('turkuaz/faq'))
    expect(fp).not.toContain('turkuaz/header"')
    expect(files.has('turkuaz/parts/header.html')).toBe(false)

    const noHeader = await blockPlan(false)
    const pre2 = { ...pre, sections: pre.sections.slice(1, -1) }
    const files2 = await renderScaffold(scaffoldDir, noHeader, pre2)
    expect(files2.get('turkuaz/parts/footer.html')).toContain('© ')
    expect(noHeader.files.find((f) => f.path === 'turkuaz/parts/header.html')?.source).toBe('scaffold')
  })
})

describe('generate', () => {
  let dir: string
  let store: ProjectStore
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'legt-test-'))
    store = new ProjectStore(dir)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function setup(plan: Plan): Promise<string> {
    const id = await store.create(intake(plan.mode), pre)
    await store.savePlan(id, plan, 'approved')
    return id
  }
  const run = (id: string, provider: LLMProvider, extra: Partial<Parameters<typeof generate>[0]> = {}) =>
    generate({ provider, promptsDir, scaffoldDir, store, projectId: id, numCtx: 8192, usePhpLint: false, ...extra })

  it('tek dosyanın LLM hatası diğer dosyaları durdurmaz; geçici hata yeniden denenir', async () => {
    const plan = await elementorPlan()
    const id = await setup(plan)
    const p = fakeProvider((_u, path, n) => {
      if (path.endsWith('assets/css/hero.css')) throw new Error('Model çöktü')
      if (path.endsWith('widgets/class-hero.php') && n === 1) throw new Error('HTTP 503 Service Unavailable')
      return undefined
    })
    const state = await run(id, p)
    const bad = Object.entries(state.files).filter(([, f]) => f.status !== 'ok').map(([k]) => k)
    expect(bad).toEqual(['turkuaz-elementor-widgets/assets/css/hero.css'])
    expect(state.files['turkuaz-elementor-widgets/widgets/class-hero.php'].status).toBe('ok')
    expect(state.step).toBe('done')
  }, 30000)

  it('cssMode source: CSS dosyaları LLM’e gitmez, şablondan yazılır', async () => {
    const plan = await elementorPlan()
    plan.cssMode = 'source'
    for (const f of plan.files) if (f.kind === 'widget-css') Object.assign(f, { source: 'scaffold', dependsOn: [] })
    const id = await setup(plan)
    const p = fakeProvider()
    const state = await run(id, p)
    const css = plan.files.filter((f) => f.kind === 'widget-css')
    expect(css.length).toBeGreaterThan(0)
    for (const f of css) {
      expect(state.files[f.path].status).toBe('ok')
      expect(p.calls.some((c) => c.messages[1].content.includes('`' + f.path + '`'))).toBe(false)
    }
    const hero = await readFile(join(dir, id, 'output/turkuaz-elementor-widgets/assets/css/hero.css'), 'utf8')
    expect(hero).toContain('.elementor-widget-trk-hero')
  })

  it('hata sınıflandırması', async () => {
    const { isFatalError, isTransientError } = await import('@core/pipeline/generate')
    expect(isTransientError(new Error('Zaman aşımı: kaynak yanıt vermiyor'))).toBe(true)
    expect(isTransientError(new Error('HTTP 429 rate limit'))).toBe(true)
    expect(isTransientError(new Error('Plan geçersiz'))).toBe(false)
    expect(isFatalError(new Error('HTTP 401 Unauthorized'))).toBe(true)
    expect(isFatalError(new Error('HTTP 5000 iç hata'))).toBe(false)
  })

  it('Elementor: tüm dosyaları üretir, doğrular, imzaları bağımlılara iletir', async () => {
    const plan = await elementorPlan()
    const id = await setup(plan)
    const p = fakeProvider()
    const state = await run(id, p)
    const failed = Object.entries(state.files).filter(([, f]) => f.status !== 'ok')
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([])
    expect(state.step).toBe('done')
    expect(p.calls).toHaveLength(plan.files.filter((f) => f.source === 'llm').length)
    for (const c of p.calls) {
      expect(c.temperature).toBe(0.2)
      expect(c.messages.map((m) => m.role)).toEqual(['system', 'user'])
      expect(c.messages[1].content).not.toMatch(/\{\{\w+\}\}/)
    }
    const cssCall = p.calls.find((c) => c.messages[1].content.includes('`turkuaz-elementor-widgets/assets/css/hero.css`'))!.messages[1].content
    expect(cssCall).toContain('widget adı (get_name): trk-hero')
    expect(cssCall).toContain('.hero') // kaynak CSS bölümü
    const php = await readFile(join(dir, id, 'output/turkuaz-elementor-widgets/widgets/class-hero.php'), 'utf8')
    expect(php).toContain('class Widget_Hero')

    // Kalite listesi
    const q = qualityChecklist(plan, pre, state, await readOutputTree(join(dir, id, 'output')))
    expect(q.filter((i) => i.status === 'fail'), JSON.stringify(q, null, 2)).toEqual([])

    // Paketleme
    const res = await packageProject(join(dir, id, 'output'), plan, join(dir, 'export'))
    expect(res.zips.map((z) => basename(z))).toEqual(['turkuaz-theme.zip', 'turkuaz-elementor-widgets.zip'])
    const themeZip = await readFile(res.zips[0])
    expect(themeZip.includes(Buffer.from('turkuaz/style.css'))).toBe(true)
    const pluginZip = await readFile(res.zips[1])
    expect(pluginZip.includes(Buffer.from('turkuaz-elementor-widgets/turkuaz-elementor-widgets.php'))).toBe(true)
  })

  it('Block: pattern slug sözleşmesi ve blok doğrulaması', async () => {
    const plan = await blockPlan()
    const id = await setup(plan)
    const state = await run(id, fakeProvider())
    const failed = Object.entries(state.files).filter(([, f]) => f.status !== 'ok')
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([])
    const patternCall = await readFile(join(dir, id, 'output/turkuaz/patterns/hero.php'), 'utf8')
    expect(patternCall).toContain('Slug: turkuaz/hero')
  })

  it('doğrulama hatasında repair.md ile onarır', async () => {
    const plan = await elementorPlan()
    const id = await setup(plan)
    const target = 'turkuaz-elementor-widgets/widgets/class-hero.php'
    const p = fakeProvider((user, path, n) => {
      if (path === target && n === 1) return `<<<FILE ${path}>>>\n${validContent(user, path).replace('register_controls', '_register_controls')}\n<<<END>>>`
      return undefined
    })
    const state = await run(id, p)
    expect(state.files[target]).toEqual({ status: 'ok', attempts: 1 })
    const repair = p.calls.find((c) => c.messages[1].content.startsWith('# REPAIR'))!.messages[1].content
    expect(repair).toContain('Yasaklı kalıp: _register_controls')
    expect(repair).toContain('Deneme: 1 / 2')
    expect(repair).toContain('function _register_controls') // mevcut içerik
  })

  it('2 onarımdan sonra hâlâ hatalıysa dosyayı kırmızı işaretler, diğerlerine devam eder', async () => {
    const plan = await elementorPlan()
    const id = await setup(plan)
    const target = 'turkuaz/assets/css/theme.css'
    const p = fakeProvider((_u, path) => (path === target ? `<<<FILE ${path}>>>\n.a {` : undefined)) // END yok
    const state = await run(id, p)
    expect(state.files[target].status).toBe('failed')
    expect(state.files[target].attempts).toBe(2)
    expect(state.files[target].errors).toContain('<<<END>>>')
    expect(p.calls.filter((c) => c.messages[1].content.includes(`\`${target}\``))).toHaveLength(3)
    expect(Object.values(state.files).filter((f) => f.status === 'ok').length).toBe(plan.files.length - 1)
    expect(state.step).toBe('done')

    // Elle düzeltme
    const issues = await saveManualEdit(store, id, target, ':root { --x: 1px; }\n', false)
    expect(issues).toEqual([])
    expect((await store.readJson<{ files: Record<string, { status: string }> }>(id, 'state.json'))!.files[target].status).toBe('ok')
  })

  it('kaldığı yerden devam eder; only ile tek dosyayı yeniden üretir', async () => {
    const plan = await elementorPlan()
    const id = await setup(plan)
    await run(id, fakeProvider())
    const again = fakeProvider()
    await run(id, again)
    expect(again.calls).toHaveLength(0)
    const one = fakeProvider()
    await run(id, one, { only: ['turkuaz/assets/css/theme.css'] })
    expect(one.calls).toHaveLength(1)
  })

  it('only verilince diskte olmayan diğer dosyalara dokunmaz', async () => {
    const plan = await elementorPlan()
    const id = await setup(plan)
    const p = fakeProvider()
    const state = await run(id, p, { only: ['turkuaz-elementor-widgets/widgets/class-hero.php'] })
    expect(p.calls).toHaveLength(1)
    expect(Object.entries(state.files).filter(([, f]) => f.status !== 'pending').map(([k]) => k)).toEqual(['turkuaz-elementor-widgets/widgets/class-hero.php'])
    expect(state.step).toBe('generating')
  })

  it('iptal edilince dosya pending kalır', async () => {
    const plan = await elementorPlan()
    const id = await setup(plan)
    const ctrl = new AbortController()
    const p = fakeProvider((_u, path) => {
      if (path.endsWith('class-features.php')) {
        ctrl.abort()
        throw new Error('aborted')
      }
      return undefined
    })
    await expect(run(id, p, { signal: ctrl.signal })).rejects.toThrow('İptal edildi')
    const state = (await store.readJson<{ step: string; files: Record<string, { status: string }> }>(id, 'state.json'))!
    expect(state.files['turkuaz-elementor-widgets/widgets/class-features.php'].status).toBe('pending')
    expect(state.files['turkuaz-elementor-widgets/widgets/class-hero.php'].status).toBe('ok')
    expect(state.step).toBe('generating')
  })
})

describe('widget CSS (cssMode: source)', () => {
  it('kaynak kurallar widget kapsamına alınır; body/:root dışarıda kalır, keyframes taşınır', async () => {
    const { buildWidgetCss, scopeSelector } = await import('@core/pipeline/widgetCss')
    const css = ':root{--c:red} body{margin:0} .hero{padding:40px;animation:fade 1s} .hero h1,.hero .sub{color:var(--c)} @media (max-width:767px){.hero{padding:10px}} @keyframes fade{from{opacity:0}to{opacity:1}} .other{color:blue}'
    const out = buildWidgetCss(css, '<section class="hero"><h1>Merhaba</h1><p class="sub">x</p></section>', 'trk-hero')
    expect(out).toContain('.elementor-widget-trk-hero .hero { padding:40px;animation:fade 1s }')
    expect(out).toContain('.elementor-widget-trk-hero .hero h1, .elementor-widget-trk-hero .hero .sub')
    expect(out).toContain('@media (max-width:767px) {')
    expect(out).toContain('@keyframes fade')
    expect(out).not.toContain('.other')
    expect(out).not.toContain('body')
    expect(out).not.toContain(':root')
    expect(scopeSelector('body.dark .hero', '.w')).toBe('.w .hero')
    expect(scopeSelector('> .x', '.w')).toBeNull()
  })
})

describe('kontrol adları', () => {
  it('nesne olarak gelen kontrolleri ad dizgesine çevirir', async () => {
    const { controlNames } = await import('@core/pipeline/layout')
    expect(controlNames([{ id: 'title', type: 'text' }, 'subtitle', { name: 'image', label: 'Görsel' }, { label: 'Düğme' }, { id: 'title' }, null, ''])).toEqual(['title', 'subtitle', 'image', 'Düğme'])
    expect(controlNames(undefined)).toEqual([])
  })
})
