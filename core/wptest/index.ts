import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser } from 'playwright-core'
import { TEMPERATURE, type ChatMessage, type LLMProvider } from '../llm/provider'
import { extractJson } from '../pipeline/analyze'
import { extractFileLenient } from '../pipeline/fileBlocks'
import { autoFix } from '../validate/autofix'
import { buildFileVars, loadContext, validateAll, type GenContext } from '../pipeline/generate'
import { inferKind, kebab, pluginDir, preSection, sectionRole, themeDir } from '../pipeline/layout'
import type { ProjectStore } from '../project/store'
import { loadPrompt, renderTemplate } from '../prompts/render'
import type { FileKind, PlanFile, TestEvent, TestIssue, TestOptions, TestReport, TestRound, TestShot, VisualReport } from '../types'
import { formatIssues } from '../validate'
import { Attributor, dedupeIssues, phpIssues } from './attribute'
import { openBrowser, runChecks, runScenarios, type Probe, type SitePages, type Viewports } from './browser'
import { applyBlock, measureVisual, mergeRules, renderBlock, rulesFrom, summarize, visualIssues, type CssRule, type SourceCache, type VisualTarget } from './visual'
import { safeSourceName } from '../html/siteFolder'
import { detectRuntime, runtimePaths, WpServer, wpConfig } from './runtime'
import { parseScenarios, type Scenario } from './scenarios'
import { clampConcurrency, runPool } from '../pool'

/** Bir turda LLM'e gönderilecek en fazla dosya sayısı (token/süre tasarrufu) */
const MAX_REPAIR_FILES = 4

export { detectRuntime, stopAllServers, WpServer } from './runtime'

const SCENARIO_RETRIES = 2

export interface LiveTestOptions {
  /** null: yapay zekâ kullanılmaz (senaryo ve onarım yok, yalnızca test) */
  provider: LLMProvider | null
  promptsDir: string
  store: ProjectStore
  projectId: string
  numCtx: number
  /** Senaryo yazımı ve onarımda aynı anda çalışan LLM ajanı (1-10) */
  concurrency?: number
  /** runtime/ (XAMPP, WordPress, Elementor) */
  runtimeDir: string
  /** core/wptest/php (setup.php) */
  phpScriptsDir: string
  /** Geçici test siteleri kökü (proje başına alt klasör) */
  workRoot: string
  options: TestOptions
  usePhpLint?: boolean
  signal?: AbortSignal
  onEvent?: (e: TestEvent) => void
}

export interface LiveTestResult {
  report: TestReport
  /** keepAlive ise açık kalan site; çağıran kapatır */
  server: WpServer | null
}

interface SetupResult {
  ok: boolean
  stage: string
  wpVersion?: string
  headerLayout?: number
  footerLayout?: number
  /** Eklentinin demo içe aktarıcısının raporu (Elementor modu) */
  demo?: { created: string[]; warnings: string[]; errors: string[]; home: number }
  errors: { stage: string; message: string; file?: string; line?: number }[]
  warnings: { stage: string; message: string; file?: string; line?: number }[]
  pages: Partial<SitePages>
}

/** Bölüm başına ana / CSS / JS dosyaları */
function sectionFiles(ctx: GenContext, sectionId: string, js: string): Probe['files'] {
  const { plan } = ctx
  const of = (kinds: FileKind[]): string | undefined => plan.files.find((f) => f.sectionId === sectionId && f.kind && kinds.includes(f.kind))?.path
  const T = themeDir(plan)
  if (plan.mode === 'elementor-free') return { main: of(['widget-php']), css: of(['widget-css']), js: of(['widget-js']) }
  const themeJs = plan.files.find((f) => f.kind === 'theme-js')?.path
  return { main: of(['pattern', 'template-part']), css: `${T}/assets/css/theme.css`, js: js !== 'none' ? themeJs : undefined }
}

/** Test sayfasına konacak bölümler + setup.php'ye giden yerleşim */
export function buildProbes(ctx: GenContext): { probes: Probe[]; layout: Record<string, unknown> } {
  const { plan, pre } = ctx
  const probes: Probe[] = []
  if (plan.mode === 'elementor-free') {
    const content: { elId: string; widget: string }[] = []
    const layout: Record<string, { elId: string; widget: string } | null> = { header: null, footer: null }
    plan.sections.forEach((s, i) => {
      const elId = `legt${String(i).padStart(3, '0')}`
      const role = sectionRole(s, pre, s.widget)
      if ((role === 'header' || role === 'footer') && !layout[role]) layout[role] = { elId, widget: s.widget }
      else content.push({ elId, widget: s.widget })
      probes.push({
        sectionId: s.id,
        label: s.widget,
        selector: `.elementor-element[data-id="${elId}"]`,
        headings: preSection(pre, s.htmlRef)?.headings ?? [],
        js: s.js || 'none',
        files: sectionFiles(ctx, s.id, s.js)
      })
    })
    return { probes, layout: { elementor: { content, ...layout } } }
  }
  const patterns: { probe: string; slug: string }[] = []
  for (const s of plan.sections) {
    const role = sectionRole(s, pre, s.slug)
    const files = sectionFiles(ctx, s.id, s.js)
    const isPart = files.main?.includes('/parts/')
    const probe = `legt-probe-${kebab(s.id)}`
    if (!isPart) patterns.push({ probe, slug: s.slug })
    probes.push({
      sectionId: s.id,
      label: isPart ? `parts/${role}.html` : s.slug,
      selector: isPart ? `${role}.wp-block-template-part, .wp-site-blocks > ${role}` : `.${probe}`,
      headings: preSection(pre, s.htmlRef)?.headings ?? [],
      js: s.js || 'none',
      files
    })
  }
  return { probes, layout: { block: { patterns } } }
}

export function viewportsFor(ctx: GenContext): Viewports {
  const bp = (ctx.plan.tokens as { breakpoints?: { tablet?: number; mobile?: number } }).breakpoints ?? {}
  const tablet = Math.max(600, Math.min(Number(bp.tablet) || 1024, 1280))
  const mobile = Math.max(320, Math.min(Number(bp.mobile) || 767, 414, tablet - 1))
  return { desktop: { width: 1440, height: 900 }, tablet: { width: tablet, height: 1100 }, mobile: { width: mobile, height: 844 } }
}

/** Onarım prompt'u için sorun listesi (dosya başına) */
export function formatTestIssues(issues: TestIssue[]): string {
  return issues
    .map((i, n) => {
      const where = [i.url, i.viewport].filter(Boolean).join(' · ')
      return `${n + 1}. [${i.kind}${i.severity === 'warning' ? ', uyarı' : ''}] ${i.message}${where ? ` (${where})` : ''}${i.detail ? `\n   ${i.detail.split('\n').slice(0, 25).join('\n   ')}` : ''}`
    })
    .join('\n')
}

const errorCount = (issues: TestIssue[], file?: string): number => issues.filter((i) => i.severity === 'error' && (file === undefined || i.file === file)).length

/**
 * Son kontrol: üretilen tema/eklenti portable XAMPP üzerinde gerçek bir WordPress'e kurulur,
 * Playwright ile gezilir, seçili LLM etkileşim senaryoları yazar ve bulunan sorunları
 * dosya dosya onarır. Her tur sonrası yeniden test edilir; onarım sorunları artırırsa geri alınır.
 */
export async function runLiveTest(opts: LiveTestOptions): Promise<LiveTestResult> {
  const { store, projectId: id, provider, options, signal } = opts
  const emit = (e: TestEvent): void => opts.onEvent?.(e)
  const log = (message: string): void => emit({ type: 'log', message })
  const ctx = await loadContext(store, id, opts.numCtx)
  const { plan } = ctx
  const elementor = plan.mode === 'elementor-free'
  const attr = new Attributor(plan)
  const startedAt = new Date().toISOString()
  const rounds: TestRound[] = []
  let shots: TestShot[] = []
  let lastVisual: VisualReport | undefined
  let wpVersion: string | null = null
  let server: WpServer | null = null
  let browser: Browser | null = null

  const finish = async (status: TestReport['status'], error?: string): Promise<TestReport> => {
    const report: TestReport = { startedAt, finishedAt: new Date().toISOString(), status, wpVersion, rounds, shots, ...(lastVisual ? { visual: lastVisual } : {}), ...(error ? { error } : {}) }
    await store.writeJson(id, 'test/report.json', report)
    return report
  }

  try {
    const status = await detectRuntime(opts.runtimeDir, elementor)
    if (!status.ok) throw new Error(`Test ortamı hazır değil:\n${status.problems.join('\n')}`)
    const paths = runtimePaths(opts.runtimeDir)

    emit({ type: 'phase', phase: 'runtime', round: 1 })
    server = new WpServer({ paths, workDir: join(opts.workRoot, id), log, signal })
    wpVersion = await server.prepareCore()
    await server.start()
    emit({ type: 'site', url: server.url })

    emit({ type: 'phase', phase: 'browser', round: 1 })
    browser = await openBrowser(paths.browsers, log)

    const { probes, layout } = buildProbes(ctx)
    // Yazı sorgulayan bölümler: test sitesine örnek HTML'deki kart başlıklarıyla yazılar eklenir
    const samplePosts: string[] = []
    for (const p of probes) {
      const src = p.files.main ? await ctx.read(p.files.main) : null
      p.dynamic = !!src && /new\s+\\?WP_Query\b|\bget_posts\s*\(|\bwp_get_recent_posts\s*\(|wp:query\b/.test(src)
      if (p.dynamic) for (const h of p.headings.slice(1)) if (!samplePosts.includes(h) && samplePosts.length < 8) samplePosts.push(h)
    }
    const viewports = viewportsFor(ctx)
    const adminPass = randomBytes(9).toString('base64url')
    const T = themeDir(plan)
    const P = pluginDir(plan)
    const [systemMd, testPlanMd, testRepairMd] = await Promise.all(
      (['system', 'test-plan', 'test-repair'] as const).map((n) => loadPrompt(opts.promptsDir, plan.mode, n))
    )
    let scenarios: Scenario[] | null = null

    // ---- Görsel birebirlik (puan + otomatik CSS düzeltmesi) ----
    const targets: VisualTarget[] = []
    for (const probe of probes) {
      const planSection = plan.sections.find((s) => s.id === probe.sectionId)
      const section = planSection ? preSection(ctx.pre, planSection.htmlRef) : undefined
      if (!section) continue
      targets.push({
        probe,
        section,
        ...(elementor && probe.files.css ? { patchRoot: `.elementor-widget-${probe.label}`, cssFile: probe.files.css } : {})
      })
    }
    // Kaynaklar diskte yoksa (eski projeler) test/src/ altına yazılır; göreli CSS / görsel bağlantıları korunur
    for (const s of ctx.intake.sources) {
      if (s.kind === 'media') continue
      if (!existsSync(store.safePath(id, `sources/${safeSourceName(s.name)}`))) await store.writeText(id, `test/src/${safeSourceName(s.name)}`, s.content)
    }
    const sourcePages = ctx.intake.sources
      .filter((s) => s.kind === 'html')
      .map((s) => {
        const own = store.safePath(id, `sources/${safeSourceName(s.name)}`)
        return { name: s.name, abs: existsSync(own) ? own : store.safePath(id, `test/src/${safeSourceName(s.name)}`) }
      })
    const refDir = store.safePath(id, 'sources/_ref')
    const srcCache: SourceCache = new Map()
    const rulesFile = 'test/visual-rules.json'
    const ruleStore = new Map<string, CssRule[]>(Object.entries((await store.readJson<Record<string, CssRule[]>>(id, rulesFile)) ?? {}))
    const ruleCount = (): number => [...ruleStore.values()].reduce((n, r) => n + r.length, 0)
    /** Dosyadaki görsel düzeltme bloğunu kural listesinden yeniden yazar (onarım bloğu silmiş olabilir) */
    const writeBlocks = async (): Promise<void> => {
      for (const [file, rules] of ruleStore) {
        const css = await ctx.read(file)
        if (css === null) continue
        const next = applyBlock(css, renderBlock(rules, viewports))
        if (next !== css) await store.writeText(id, `output/${file}`, next)
      }
      await store.writeJson(id, rulesFile, Object.fromEntries(ruleStore))
    }

    /** Siteyi sıfırdan kurar ve tüm kontrolleri çalıştırır */
    const evaluate = async (round: number): Promise<{ issues: TestIssue[]; snapshots: Record<string, string>; run: number; skipped: number }> => {
      const srv = server!
      emit({ type: 'phase', phase: 'install', round })
      // Onarım görsel düzeltme bloğunu silmiş olabilir; siteye kopyalanmadan önce yeniden yazılır
      await writeBlocks()
      await srv.syncDir(store.safePath(id, `output/${T}`), 'themes', T)
      await srv.installMuPlugin(join(opts.phpScriptsDir, 'legt-test-mu.php'))
      if (elementor) {
        await srv.ensurePlugin('elementor')
        await srv.syncDir(store.safePath(id, `output/${P}`), 'plugins', P)
      }
      await writeFile(join(srv.site, 'wp-config.php'), wpConfig({ dbPort: srv.dbPort, siteUrl: srv.url, debugLog: srv.debugLog, salt: () => randomBytes(32).toString('base64') }))
      await rm(srv.debugLog, { force: true })
      await rm(join(srv.logs, 'php-error.log'), { force: true })
      // Önceki turun yüklemeleri (Elementor CSS önbelleği dahil) temizlenir
      await rm(join(srv.site, 'wp-content', 'uploads'), { recursive: true, force: true })

      const cfgFile = join(srv.conf, 'setup.json')
      await writeFile(
        cfgFile,
        JSON.stringify({
          abspath: srv.site,
          siteUrl: srv.url,
          dbPort: srv.dbPort,
          adminPass,
          title: plan.theme.name,
          mode: plan.mode,
          theme: T,
          prefix: plan.theme.prefix,
          plugins: elementor ? ['elementor/elementor.php', `${P}/${P}.php`] : [],
          samplePosts,
          ...layout
        })
      )
      const run = await srv.runPhp(join(opts.phpScriptsDir, 'setup.php'), [cfgFile])
      const marker = run.stdout.split('\n').reverse().find((l) => l.startsWith('@@LEGT@@'))
      if (!marker) throw new Error(`setup.php sonuç vermedi (kod ${run.code}):\n${(run.stdout + run.stderr).trim().slice(-1500)}`)
      const setup = JSON.parse(marker.slice('@@LEGT@@'.length)) as SetupResult
      wpVersion = setup.wpVersion ?? wpVersion

      const issues: TestIssue[] = []
      for (const [list, severity] of [
        [setup.errors, 'error'],
        [setup.warnings, 'warning']
      ] as const) {
        for (const e of list) {
          const file = attr.toOutput(e.file) ?? attr.firstOwned(e.message)?.file
          issues.push({ kind: 'setup', severity, message: `Kurulum (${e.stage}): ${e.message.split('\n')[0].slice(0, 300)}`, ...(file ? { file } : {}), detail: `${e.file ?? ''}:${e.line ?? ''}\n${e.message}`.slice(0, 3000) })
        }
      }
      if (setup.demo) {
        // Rapor satırı dosya adını içerir ("home.json bilinmeyen widget…"); onarılacak dosya o demo JSON'u
        const demoFile = (line: string): string | undefined => {
          const name = /\b(home|header|footer)\.json\b/.exec(line)?.[1]
          return name ? `${P}/demo/${name}.json` : undefined
        }
        for (const [list, severity] of [
          [setup.demo.errors, 'error'],
          [setup.demo.warnings, 'warning']
        ] as const) {
          for (const line of list) issues.push({ kind: 'setup', severity, message: `Demo içe aktarma: ${line}`, ...(demoFile(line) ? { file: demoFile(line) } : {}) })
        }
        log(`Demo içe aktarıldı: ${setup.demo.created.join(', ') || '—'}`)
      }
      if (!setup.pages.test) {
        // Veritabanı / kurulum aşamasında kaldı: kod sorunu değil, ortam sorunu
        if (!issues.some((i) => i.file)) throw new Error(`WordPress kurulamadı (${setup.stage}): ${setup.errors.map((e) => e.message).join('\n') || 'bilinmeyen hata'}\n${await srv.tailLogs()}`)
        return { issues, snapshots: {}, run: 0, skipped: 0 }
      }
      log(`WordPress ${setup.wpVersion} kuruldu, tema ve eklentiler etkin`)
      if (elementor) {
        // Header/footer widget'ları layout belgesinin içinde; layout'u tema header.php / footer.php basar
        const L = layout as { elementor: Record<'header' | 'footer', { elId: string } | null> }
        for (const loc of ['header', 'footer'] as const) {
          const probe = probes.find((p) => p.selector.includes(`"${L.elementor[loc]?.elId}"`))
          const layoutId = setup[`${loc}Layout`]
          if (probe && layoutId) probe.container = { selector: `[data-elementor-id="${layoutId}"]`, file: `${T}/${loc}.php`, label: `${loc === 'header' ? 'Header' : 'Footer'} layout'u` }
        }
      }

      emit({ type: 'phase', phase: 'browser', round })
      const shotsRel = 'test/shots'
      await rm(store.safePath(id, shotsRel), { recursive: true, force: true })
      const input = {
        siteUrl: srv.url,
        pages: setup.pages as SitePages,
        probes,
        viewports,
        shots: { dir: store.safePath(id, shotsRel), rel: shotsRel },
        editor: elementor && options.editor ? ('elementor' as const) : null,
        adminPass,
        attr,
        fallbackCss: `${T}/assets/css/theme.css`,
        ...(elementor ? { hookFiles: { head: `${T}/header.php`, footer: `${T}/footer.php` } } : {}),
        ...(elementor ? { demo: { selector: `[class*="elementor-widget-${plan.theme.prefix}-"]`, file: `${P}/demo/home.json` } } : {}),
        log,
        signal
      }
      const checks = await runChecks(browser!, input)
      shots = checks.shots
      issues.push(...checks.issues)

      if (options.visual !== false && targets.length && !signal?.aborted) {
        try {
          emit({ type: 'phase', phase: 'browser', round, detail: 'görsel benzerlik' })
          const mi = {
            browser: browser!,
            siteUrl: srv.url,
            pages: { test: setup.pages.test!, ...(setup.pages.home ? { home: setup.pages.home } : {}), ...(setup.pages.demo ? { demo: setup.pages.demo } : {}) },
            targets,
            viewports,
            sourcePages,
            cache: srcCache,
            ...(existsSync(refDir) ? { refDir } : {}),
            shots: { dir: store.safePath(id, 'test/shots'), rel: 'test/shots' },
            log,
            signal
          }
          let run = await measureVisual(mi)
          const fresh = rulesFrom(run, targets)
          if (fresh.size) {
            for (const [file, rules] of fresh) ruleStore.set(file, mergeRules(ruleStore.get(file) ?? [], rules))
            await writeBlocks()
            await srv.syncDir(store.safePath(id, `output/${P}`), 'plugins', P)
            log(`Görsel düzeltme: ${ruleCount()} CSS kuralı yazıldı, yeniden ölçülüyor`)
            run = await measureVisual(mi)
          }
          const report = summarize(run, targets, srcCache, ruleCount())
          if (report) {
            lastVisual = report
            shots = [...shots, ...run.shots]
            issues.push(...visualIssues(run, report, targets))
            log(`Görsel benzerlik: ${report.score}/${report.max} (${report.verdict === 'fail' ? 'eşik altı' : report.verdict === 'warn' ? 'orta' : 'iyi'})`)
          } else {
            log('Görsel benzerlik: kaynak sayfada bölümler bulunamadığı için puanlanmadı')
          }
        } catch (e) {
          if (signal?.aborted) throw e
          log(`Görsel benzerlik ölçülemedi: ${(e as Error).message.split('\n')[0]}`)
        }
      }

      let sc = { run: 0, skipped: 0 }
      if (options.aiScenarios && provider) {
        scenarios ??= await writeScenarios(checks.snapshots)
        if (scenarios.length) {
          emit({ type: 'phase', phase: 'scenarios', round, detail: `${scenarios.length} senaryo` })
          const r = await runScenarios(browser!, input, scenarios)
          issues.push(...r.issues)
          sc = { run: r.run, skipped: r.skipped }
        }
      }

      const phpLog = [await readFile(srv.debugLog, 'utf8').catch(() => ''), await readFile(join(srv.logs, 'php-error.log'), 'utf8').catch(() => '')].join('\n')
      issues.push(...phpIssues(phpLog, attr))
      return { issues: dedupeIssues(issues), snapshots: checks.snapshots, ...sc }
    }

    const agents = clampConcurrency(opts.concurrency ?? 1)
    const llmCall = async (label: string, system: string, user: string, json: boolean, source: string): Promise<string> => {
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
      let response = ''
      let error: string | undefined
      try {
        response = await provider!.chat({ messages, temperature: json ? TEMPERATURE.analyze : TEMPERATURE.code, json, signal, onToken: (chunk) => emit({ type: 'token', source, chunk }) })
        return response
      } catch (e) {
        error = (e as Error).message
        throw e
      } finally {
        await store.log(id, label, { system, user, response, error })
      }
    }

    /** Seçili LLM, etkileşimli bölümler için senaryo yazar (bölüm başına bir çağrı) */
    const writeScenarios = async (snapshots: Record<string, string>): Promise<Scenario[]> => {
      const all: Scenario[] = []
      const interactive = probes.filter((p) => p.js !== 'none' && snapshots[p.sectionId])
      await runPool(interactive, agents, async (probe) => {
        const file = plan.files.find((f) => f.path === (probe.files.js ?? probe.files.main))
        if (!file) return
        emit({ type: 'phase', phase: 'scenarios', round: 1, detail: probe.label })
        const vars = await buildFileVars(ctx, file, file.kind && file.kind !== 'scaffold' ? file.kind : inferKind(file.path, plan.mode))
        const system = renderTemplate(systemMd, vars)
        let errors = '(yok)'
        for (let attempt = 0; attempt <= SCENARIO_RETRIES; attempt++) {
          const user = renderTemplate(testPlanMd, { ...vars, renderedHtml: snapshots[probe.sectionId], js: probe.js, errors, attempt: String(attempt) })
          let raw: string
          try {
            raw = await llmCall(`test-plan-${probe.sectionId}`, system, user, true, probe.label)
          } catch (e) {
            if (signal?.aborted) throw e
            log(`${probe.label}: senaryo çağrısı başarısız, bu bölüm senaryosuz test edilecek: ${(e as Error).message.split('\n')[0]}`)
            break
          }
          let parsed: { scenarios: Scenario[]; errors: string[] }
          try {
            parsed = parseScenarios(JSON.stringify(extractJson(raw)), probe.sectionId)
          } catch (e) {
            parsed = { scenarios: [], errors: [(e as Error).message] }
          }
          if (parsed.scenarios.length || attempt === SCENARIO_RETRIES) {
            all.push(...parsed.scenarios)
            log(`${probe.label}: ${parsed.scenarios.length} senaryo${parsed.errors.length ? ` (${parsed.errors.length} hatalı atıldı)` : ''}`)
            break
          }
          errors = parsed.errors.map((e) => `- ${e}`).join('\n')
        }
      })
      // Paralel bitiş sırası değişebilir; senaryolar bölüm sırasıyla saklanır
      all.sort((a, b) => probes.findIndex((p) => p.sectionId === a.sectionId) - probes.findIndex((p) => p.sectionId === b.sectionId))
      await store.writeJson(id, 'test/scenarios.json', all)
      return all
    }

    /** Bir dosyayı test sorunlarına göre onarır; dosya gerçekten değiştiyse true */
    const repairFile = async (file: PlanFile, issues: TestIssue[], snapshots: Record<string, string>, round: number): Promise<boolean> => {
      const content = await ctx.read(file.path)
      if (content === null) return false
      const kind = file.kind && file.kind !== 'scaffold' ? file.kind : inferKind(file.path, plan.mode)
      const vars = await buildFileVars(ctx, file, kind)
      const system = renderTemplate(systemMd, vars)
      const rendered = (file.sectionId && snapshots[file.sectionId]) || '(bu dosya tek bir bölüme bağlı değil ya da bölüm render edilmedi)'
      const user = renderTemplate(testRepairMd, { ...vars, attempt: String(round), errors: formatTestIssues(issues), content, renderedHtml: rendered })
      const extract = (output: string): string | null => {
        const raw = extractFileLenient(output, file.path)
        return raw === null ? null : autoFix(file.path, raw).content
      }
      const first = extract(await llmCall(`test-repair${round}-${file.path}`, system, user, false, file.path))
      let fixed = first
      if (fixed === null) {
        // Biçim hatası: aynı isteği işaretçi hatırlatmasıyla bir kez daha
        const reminder = `${user}

ÖNEMLİ: Önceki yanıtın <<<FILE ${file.path}>>> ... <<<END>>> işaretçilerini içermiyordu. Yalnızca bu biçimde, dosyanın tam içeriğiyle yanıt ver.`
        fixed = extract(await llmCall(`test-repair${round}-retry-${file.path}`, system, reminder, false, file.path))
      }
      if (fixed === null) {
        log(`${file.path}: onarım yanıtı iki denemede de biçim dışı, atlandı`)
        return false
      }
      if (fixed.trim() === content.trim()) {
        log(`${file.path}: model dosyayı değiştirmedi (kod doğru, test hatalı olabilir)`)
        return false
      }
      // Canlı onarım statik doğrulamayı bozmamalı; bozarsa ek LLM çağrısı harcanmadan eski hâl korunur
      const staticIssues = await validateAll(ctx, file, kind, fixed, opts.usePhpLint)
      if (staticIssues.length) {
        log(`${file.path}: onarım statik doğrulamadan geçmedi, eski hâli korundu\n${formatIssues(file.path, staticIssues)}`)
        return false
      }
      await store.writeText(id, `test/backup/round-${round}/${file.path}`, content)
      await store.writeText(id, `output/${file.path}`, fixed)
      return true
    }

    const restore = async (round: number, path: string): Promise<void> => {
      const backup = store.safePath(id, `test/backup/round-${round}/${path}`)
      if (existsSync(backup)) await store.writeText(id, `output/${path}`, await readFile(backup, 'utf8'))
    }

    // ---- Turlar ----
    await rm(store.safePath(id, 'test/backup'), { recursive: true, force: true })
    let repairsDone = 0
    let prev: TestIssue[] | null = null
    let lastRepaired: string[] = []
    const blocked = new Set<string>()
    const state = ctx.state

    for (let round = 1; ; round++) {
      let result = await evaluate(round)
      const reverted: string[] = []
      if (prev && lastRepaired.length) {
        // Gerileme: toplam hata arttıysa turun tüm onarımları, arttırmadıysa hatası artan dosyalar geri alınır
        const worse = errorCount(result.issues) > errorCount(prev) ? lastRepaired : lastRepaired.filter((f) => errorCount(result.issues, f) > errorCount(prev!, f))
        for (const f of worse) {
          await restore(round - 1, f)
          reverted.push(f)
          blocked.add(f)
        }
        if (reverted.length) {
          log(`Onarım sorunları artırdı, geri alındı: ${reverted.join(', ')}`)
          result = await evaluate(round)
        }
      }
      const rec: TestRound = { round, issues: result.issues, scenarios: { run: result.run, skipped: result.skipped }, repaired: [], reverted }
      rounds.push(rec)
      emit({ type: 'round', round: rec })
      log(`Tur ${round}: ${errorCount(result.issues)} hata, ${result.issues.length - errorCount(result.issues)} uyarı`)

      if (!errorCount(result.issues) || !provider || repairsDone >= options.rounds) break

      // Onarılabilir: hatası olan, LLM'in ürettiği ve bu oturumda geri alınmamış dosyalar
      const byFile = new Map<string, TestIssue[]>()
      for (const i of result.issues) if (i.file) byFile.set(i.file, [...(byFile.get(i.file) ?? []), i])
      // Token tasarrufu: en çok ve en ağır hatası olan ilk MAX_REPAIR_FILES dosya onarılır (PHP/render önce)
      const weight = (path: string): number => (byFile.get(path) ?? []).reduce((n, i) => n + (i.severity !== 'error' ? 0 : i.kind === 'php' || i.kind === 'render' ? 10 : 1), 0)
      const targets = plan.files
        .filter((f) => f.source === 'llm' && !blocked.has(f.path) && errorCount(byFile.get(f.path) ?? []) > 0)
        .sort((x, y) => weight(y.path) - weight(x.path))
        .slice(0, MAX_REPAIR_FILES)
      const unowned = result.issues.filter((i) => i.severity === 'error' && (!i.file || !targets.some((t) => t.path === i.file)))
      if (unowned.length) log(`${unowned.length} hata bir LLM dosyasına bağlanamadı (scaffold, çekirdek ya da bilinmeyen kaynak); yalnızca raporlanıyor`)
      if (!targets.length) break

      emit({ type: 'phase', phase: 'repair', round, detail: `${targets.length} dosya` })
      repairsDone++
      // Her dosya bağımsız onarılır: aynı anda en fazla `agents` LLM çağrısı
      await runPool(targets, agents, async (f) => {
        if (signal?.aborted) throw new Error('İptal edildi')
        log(`Onarılıyor: ${f.path}`)
        emit({ type: 'phase', phase: 'repair', round, detail: f.path })
        // Tek dosyanın LLM hatası (401, kota, bağlantı) testi bitirmez: o dosya atlanır, rapor yine yazılır
        let ok = false
        try {
          ok = await repairFile(f, byFile.get(f.path)!, result.snapshots, round)
        } catch (e) {
          if (signal?.aborted) throw e
          log(`${f.path}: onarım çağrısı başarısız, atlandı: ${(e as Error).message.split('\n')[0]}`)
        }
        if (ok) {
          rec.repaired.push(f.path)
          state.files[f.path] = { status: 'ok', attempts: (state.files[f.path]?.attempts ?? 0) + 1 }
        }
      })
      rec.repaired.sort((a, b) => targets.findIndex((t) => t.path === a) - targets.findIndex((t) => t.path === b))
      await store.saveState(id, state)
      emit({ type: 'round', round: rec })
      if (!rec.repaired.length) break
      prev = result.issues
      lastRepaired = rec.repaired
    }

    const last = rounds.at(-1)!.issues
    const report = await finish(errorCount(last) ? 'fail' : last.length ? 'warn' : 'pass')
    const keep = options.keepAlive
    if (!keep) await server.stop()
    else emit({ type: 'site', url: server.url })
    return { report, server: keep ? server : null }
  } catch (e) {
    await server?.stop()
    emit({ type: 'site', url: null })
    const message = signal?.aborted ? 'İptal edildi' : (e as Error).message
    const report = await finish('error', message)
    if (signal?.aborted) throw new Error('İptal edildi')
    return { report, server: null }
  } finally {
    await browser?.close().catch(() => undefined)
  }
}

/** Son test raporu (yoksa null) */
export async function loadReport(store: ProjectStore, id: string): Promise<TestReport | null> {
  return store.readJson<TestReport>(id, 'test/report.json')
}

export async function readShot(store: ProjectStore, id: string, rel: string): Promise<string | null> {
  if (!/^test\/shots\/[\w.-]+\.png$/.test(rel)) return null
  try {
    return `data:image/png;base64,${(await readFile(store.safePath(id, rel))).toString('base64')}`
  } catch {
    return null
  }
}
