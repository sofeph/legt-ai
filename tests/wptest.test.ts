import { createServer } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GenContext } from '@core/pipeline/generate'
import { qualityChecklist } from '@core/pipeline/quality'
import type { ProjectState, TestReport } from '@core/types'
import { buildProbes, formatTestIssues, viewportsFor } from '@core/wptest'
import { Attributor, dedupeIssues, parseDebugLog, phpIssues } from '@core/wptest/attribute'
import { isPortFree, PORT_RANGE, randomPort } from '@core/wptest/ports'
import { httpdConf, phpIni, wpConfig } from '@core/wptest/runtime'
import { describeStep, parseScenarios, stepSelectors } from '@core/wptest/scenarios'
import { blockPlan, elementorPlan, pre } from './helpers'

describe('ports', () => {
  it('aralıkta, verilmiş portlardan farklı rastgele port', async () => {
    const seq = [0, 0, 0.5]
    let i = 0
    const port = await randomPort([PORT_RANGE.min], () => seq[i++] ?? Math.random())
    expect(port).toBeGreaterThan(PORT_RANGE.min)
    expect(port).toBeLessThanOrEqual(PORT_RANGE.max)
  })

  it('dolu portu atlar', async () => {
    const srv = createServer()
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    const busy = (srv.address() as { port: number }).port
    expect(await isPortFree(busy)).toBe(false)
    const port = await randomPort([], () => (busy - PORT_RANGE.min) / (PORT_RANGE.max - PORT_RANGE.min + 1) + 1e-9)
      .catch(() => null)
      .finally(() => srv.close())
    expect(port).not.toBe(busy)
  })
})

describe('scenarios', () => {
  it('geçerli senaryoları alır, hatalı adımlı senaryoyu atar', () => {
    const raw = JSON.stringify({
      scenarios: [
        { name: 'aç', steps: [{ do: 'click', selector: '.q' }, { do: 'wait', ms: 99999 }, { expect: 'attr', selector: '.q', name: 'aria-expanded', contains: 'true' }] },
        { name: 'kötü', steps: [{ do: 'eval', selector: 'x' }, { expect: 'visible', selector: '&' }] },
        { name: 'beklentisiz', steps: [{ do: 'click', selector: '.q' }] },
        { name: 'tuş', steps: [{ do: 'press', key: 'rm -rf' }, { expect: 'visible', selector: '&' }] }
      ]
    })
    const { scenarios, errors } = parseScenarios(raw, 'faq')
    expect(scenarios).toHaveLength(1)
    expect(scenarios[0]).toMatchObject({ sectionId: 'faq', name: 'aç' })
    expect(scenarios[0].steps[1]).toEqual({ do: 'wait', ms: 2000 })
    expect(errors.join('\n')).toMatch(/bilinmeyen eylem "eval"/)
    expect(errors.join('\n')).toMatch(/en az bir "expect"/)
    expect(errors.join('\n')).toMatch(/geçersiz tuş/)
    expect(stepSelectors(scenarios[0])).toEqual(['.q'])
    expect(describeStep(scenarios[0].steps[2])).toBe('expect attr .q[aria-expanded] ∋ "true"')
  })

  it('dizi kökü ve ``` sarmalı kabul edilir; bozuk JSON hata verir', () => {
    expect(parseScenarios('```json\n[{"name":"a","steps":[{"expect":"exists","selector":"li"}]}]\n```', 's').scenarios).toHaveLength(1)
    expect(parseScenarios('{oops', 's').errors[0]).toMatch(/JSON.parse/)
    expect(parseScenarios('{"x":1}', 's').errors[0]).toMatch(/scenarios/)
  })
})

describe('attribute', () => {
  const plan = { theme: { slug: 'turkuaz' }, mode: 'elementor-free', files: [{ path: 'turkuaz-elementor-widgets/assets/js/faq.js' }] } as never
  const attr = new Attributor(plan)

  it('Windows yolu, URL ve satır biçimleri', () => {
    expect(attr.toOutput('C:\\tmp\\site\\wp-content\\themes\\turkuaz\\inc\\x.php')).toBe('turkuaz/inc/x.php')
    expect(attr.toOutput('http://127.0.0.1:4242/wp-content/plugins/turkuaz-elementor-widgets/assets/js/faq.js?ver=1.0.0')).toBe('turkuaz-elementor-widgets/assets/js/faq.js')
    expect(attr.toOutput('/wp-content/plugins/elementor/assets/js/frontend.min.js')).toBeUndefined()
    expect(attr.firstOwned('at http://127.0.0.1:4242/wp-content/plugins/turkuaz-elementor-widgets/assets/js/faq.js?ver=1:12:5')).toEqual({ file: 'turkuaz-elementor-widgets/assets/js/faq.js', line: 12 })
    expect(attr.firstOwned('#0 C:\\s\\wp-content\\plugins\\elementor\\a.php(10): x()\n#1 C:\\s\\wp-content\\themes\\turkuaz\\header.php(7): y()')).toEqual({ file: 'turkuaz/header.php', line: 7 })
    expect(attr.firstOwned('Undefined variable $a in /s/wp-content/themes/turkuaz/footer.php on line 3')).toEqual({ file: 'turkuaz/footer.php', line: 3 })
    expect(attr.inPlan('turkuaz-elementor-widgets/assets/js/faq.js')).toBe(true)
  })

  it('debug.log: bizim dosyalarımız + ölümcül hatalar raporlanır, çekirdek gürültüsü atılır', () => {
    const log = [
      '[26-Oct-2026 14:18:07 UTC] PHP Deprecated:  x in C:\\s\\wp-content\\plugins\\elementor\\includes\\api.php on line 176',
      '[26-Oct-2026 14:18:08 UTC] PHP Warning:  Undefined array key "title" in C:\\s\\wp-content\\plugins\\turkuaz-elementor-widgets\\widgets\\class-hero.php on line 40',
      "[26-Oct-2026 14:18:09 UTC] PHP Fatal error:  Uncaught Error: Call to undefined function foo() in C:\\s\\wp-content\\themes\\turkuaz\\functions.php:12\nStack trace:\n#0 {main}\n  thrown in C:\\s\\wp-content\\themes\\turkuaz\\functions.php on line 12",
      '[26-Oct-2026 14:18:10 UTC] PHP Fatal error:  Allowed memory size exhausted in C:\\s\\wp-includes\\x.php on line 1'
    ].join('\n')
    expect(parseDebugLog(log).map((e) => e.level)).toEqual(['deprecated', 'warning', 'fatal', 'fatal'])
    const issues = phpIssues(log, attr)
    expect(issues.map((i) => [i.severity, i.file])).toEqual([
      ['error', 'turkuaz-elementor-widgets/widgets/class-hero.php'],
      ['error', 'turkuaz/functions.php'],
      ['error', undefined]
    ])
    expect(issues[1].detail).toContain('Stack trace')
  })

  it('aynı sorun farklı viewport\'larda tekilleşir', () => {
    const base = { kind: 'overflow' as const, severity: 'error' as const, message: 'taşma', file: 'a.css' }
    const out = dedupeIssues([
      { ...base, viewport: 'tablet' },
      { ...base, viewport: 'mobile' },
      { ...base, viewport: 'mobile' }
    ])
    expect(out).toHaveLength(1)
    expect(out[0].viewport).toBe('tablet, mobile')
  })
})

describe('runtime yapılandırması', () => {
  it('httpd.conf: rastgele port, yalnızca var olan modüller, PHP 8 modülü', () => {
    const conf = httpdConf({
      apacheDir: 'C:\\x\\apache',
      phpDir: 'C:\\x\\php',
      confDir: 'C:\\w\\conf',
      siteDir: 'C:\\w\\site',
      logsDir: 'C:\\w\\logs',
      port: 34567,
      modules: ['mod_rewrite.so', 'mod_dir.so', 'mod_mime.so'],
      phpFiles: ['php.exe', 'php8ts.dll', 'php8apache2_4.dll']
    })
    expect(conf).toContain('Listen 127.0.0.1:34567')
    expect(conf).toContain('LoadModule rewrite_module modules/mod_rewrite.so')
    expect(conf).not.toContain('mod_headers')
    expect(conf).toContain('LoadFile "C:/x/php/php8ts.dll"')
    expect(conf).toContain('LoadModule php_module "C:/x/php/php8apache2_4.dll"')
    expect(conf).toContain('DocumentRoot "C:/w/site"')
    expect(conf).not.toMatch(/[A-Z]:\\/)
    expect(() => httpdConf({ apacheDir: '', phpDir: '/p', confDir: '', siteDir: '', logsDir: '', port: 1, modules: [], phpFiles: ['php.exe'] })).toThrow(/Apache PHP modülü/)
  })

  it('php.ini yalnızca var olan eklentileri açar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legt-php-'))
    try {
      await mkdir(join(dir, 'ext'))
      await writeFile(join(dir, 'ext', 'php_mysqli.dll'), '')
      await writeFile(join(dir, 'ext', 'php_gd.dll'), '')
      const ini = await phpIni(dir, { logs: 'C:\\l', tmp: 'C:\\t' })
      expect(ini).toContain('extension = mysqli')
      expect(ini).toContain('extension = gd')
      expect(ini).not.toContain('extension = intl')
      expect(ini).toContain('error_log = "C:/l/php-error.log"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('wp-config: port, çevrim dışı ve kaçışlı tuzlar', () => {
    const cfg = wpConfig({ dbPort: 41234, siteUrl: 'http://127.0.0.1:52345', debugLog: 'C:\\w\\logs\\debug.log', salt: () => "a'b\\c" })
    expect(cfg).toContain("define( 'DB_HOST', '127.0.0.1:41234' );")
    expect(cfg).toContain("define( 'WP_HOME', 'http://127.0.0.1:52345' );")
    expect(cfg).toContain("define( 'WP_HTTP_BLOCK_EXTERNAL', true );")
    expect(cfg).toContain("define( 'AUTH_KEY', 'a\\'b\\\\c' );")
    expect(cfg).toContain("'C:/w/logs/debug.log'")
  })
})

describe('probe ve rapor', () => {
  it('Elementor: header/footer layout\'a, içerik widget\'ları test sayfasına; dosyalar bölüme bağlı', async () => {
    const plan = await elementorPlan()
    const { probes, layout } = buildProbes({ plan, pre } as GenContext)
    const el = (layout as { elementor: { content: { widget: string }[]; header: { widget: string }; footer: { widget: string } } }).elementor
    expect(el.header.widget).toBe('trk-header')
    expect(el.footer.widget).toBe('trk-footer')
    expect(el.content.map((c) => c.widget)).toEqual(['trk-hero', 'trk-features', 'trk-testimonials', 'trk-faq'])
    const faq = probes.find((p) => p.sectionId === 'faq')!
    expect(faq.selector).toMatch(/^\.elementor-element\[data-id="legt\d{3}"\]$/)
    expect(faq.files).toEqual({
      main: 'turkuaz-elementor-widgets/widgets/class-faq.php',
      css: 'turkuaz-elementor-widgets/assets/css/faq.css',
      js: 'turkuaz-elementor-widgets/assets/js/faq.js'
    })
    expect(faq.headings.length).toBeGreaterThan(0)
  })

  it('Block: pattern\'ler işaretli gruplarda, parçalar header/footer etiketiyle', async () => {
    const plan = await blockPlan()
    const { probes, layout } = buildProbes({ plan, pre } as GenContext)
    const patterns = (layout as { block: { patterns: { probe: string; slug: string }[] } }).block.patterns
    expect(patterns.map((p) => p.slug)).toEqual(['turkuaz/hero', 'turkuaz/features', 'turkuaz/testimonials', 'turkuaz/faq'])
    expect(probes.find((p) => p.sectionId === 'header')).toMatchObject({ label: 'parts/header.html', files: { main: 'turkuaz/parts/header.html' } })
    expect(probes.find((p) => p.sectionId === 'testimonials')!.files.js).toBe('turkuaz/assets/js/theme.js')
    expect(probes.find((p) => p.sectionId === 'hero')!.files.js).toBeUndefined()
  })

  it('viewport\'lar plan kırılımlarından', async () => {
    const plan = await elementorPlan()
    expect(viewportsFor({ plan } as GenContext)).toEqual({ desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 1100 }, mobile: { width: 414, height: 844 } })
  })

  it('onarım prompt\'u için sorun listesi', () => {
    const text = formatTestIssues([{ kind: 'overflow', severity: 'error', message: 'taşma', viewport: 'mobile', url: '/', detail: '<div class="x"> sağ kenar 500px' }])
    expect(text).toBe('1. [overflow] taşma (/ · mobile)\n   <div class="x"> sağ kenar 500px')
  })

  it('kalite listesi: canlı test maddesi', async () => {
    const plan = await elementorPlan()
    const state: ProjectState = { step: 'done', files: {}, updatedAt: '2026-01-01T00:00:00Z' }
    const live = (r: TestReport | null) => qualityChecklist(plan, pre, state, new Map(), r).find((q) => q.id === 'live-test')!
    expect(live(null).status).toBe('warn')
    const report: TestReport = { startedAt: '', finishedAt: '2026-01-02T00:00:00Z', status: 'pass', wpVersion: '7.1', rounds: [{ round: 1, issues: [], scenarios: { run: 0, skipped: 0 }, repaired: [], reverted: [] }], shots: [] }
    expect(live(report).status).toBe('pass')
    report.rounds[0].issues.push({ kind: 'php', severity: 'error', message: 'Fatal', file: 'turkuaz/functions.php' })
    expect(live(report)).toMatchObject({ status: 'fail', details: ['turkuaz/functions.php: Fatal'] })
    expect(live({ ...report, rounds: [{ ...report.rounds[0], issues: [] }], finishedAt: '2025-01-01T00:00:00Z' }).status).toBe('warn')
  })
})
