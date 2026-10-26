import type { BlockSection, ElementorSection, FileKind, Plan, PlanFile, PreAnalysis, SectionSummary } from '../types'

/** Tema klasörü = slug (WordPress tema dizini adı) */
export const themeDir = (plan: Pick<Plan, 'theme'>): string => plan.theme.slug
/** Elementor widget eklentisi klasörü */
export const pluginDir = (plan: Pick<Plan, 'theme'>): string => `${plan.theme.slug}-elementor-widgets`

export function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** "trk-hero" → "hero", "theme-slug/hero" → "hero" */
export function bareName(name: string, prefix: string): string {
  const last = name.split('/').pop() ?? name
  const stripped = last.startsWith(`${prefix}-`) ? last.slice(prefix.length + 1) : last
  return kebab(stripped) || 'section'
}

export function preSection(pre: PreAnalysis, htmlRef: string): SectionSummary | undefined {
  return pre.sections.find((s) => s.id === htmlRef)
}

/** Header/footer bölümü mü? Ön analizdeki role'e, yoksa adlandırmaya bakar */
export function sectionRole(section: { htmlRef: string; id: string }, pre: PreAnalysis, name = ''): SectionSummary['role'] {
  const role = preSection(pre, section.htmlRef)?.role
  if (role && role !== 'content') return role
  if (/header/i.test(`${section.id} ${name}`)) return 'header'
  if (/footer/i.test(`${section.id} ${name}`)) return 'footer'
  return role ?? 'content'
}

function uniqueNames<T>(items: T[], name: (t: T) => string): Map<T, string> {
  const seen = new Map<string, number>()
  const out = new Map<T, string>()
  for (const it of items) {
    const base = name(it)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    out.set(it, n === 1 ? base : `${base}-${n}`)
  }
  return out
}

/**
 * Widget adlarını (`{prefix}-{ad}`), pattern slug'larını (`{slug}/{ad}`) ve JS sınıf adlarını
 * benzersiz ve dosya adlarıyla tutarlı hâle getirir. Analizden hemen sonra çalışır.
 */
export function normalizePlan(plan: Plan): Plan {
  const prefix = plan.theme.prefix
  if (plan.mode === 'elementor-free') {
    const names = uniqueNames(plan.sections, (s) => bareName(s.widget || s.id, prefix))
    plan.sections = plan.sections.map((s) => ({
      ...s,
      widget: `${prefix}-${names.get(s)}`,
      contentControls: Array.isArray(s.contentControls) ? s.contentControls : [],
      styleControls: Array.isArray(s.styleControls) ? s.styleControls : [],
      repeater: s.repeater ?? null,
      js: s.js || 'none',
      proReplacement: s.proReplacement ?? null
    }))
  } else {
    const names = uniqueNames(plan.sections, (s) => bareName(s.slug || s.id, prefix))
    plan.sections = plan.sections.map((s) => {
      const n = names.get(s)!
      const js = s.js || 'none'
      return {
        ...s,
        slug: `${plan.theme.slug}/${n}`,
        blocks: Array.isArray(s.blocks) ? s.blocks : [],
        repeat: s.repeat ?? null,
        js,
        className: js !== 'none' ? `${prefix}-${n}` : null
      }
    })
  }
  return plan
}

/**
 * plan.files'ın deterministik hâli. LLM'in önerdiği dosya listesi yerine bu kullanılır;
 * kullanıcı Plan ekranında yine düzenleyebilir.
 * Sıra = üretim sırası (bağımlılıklar önce).
 */
export function buildFiles(plan: Plan, pre: PreAnalysis, scaffoldPaths: string[]): PlanFile[] {
  const files: PlanFile[] = scaffoldPaths.map((path) => ({ path, source: 'scaffold' as const, kind: 'scaffold' as const }))
  const llm = (path: string, kind: FileKind, sectionId?: string, dependsOn: string[] = []): void => {
    files.push({ path, source: 'llm', kind, ...(sectionId ? { sectionId } : {}), dependsOn })
  }
  const prefix = plan.theme.prefix

  if (plan.mode === 'elementor-free') {
    const P = pluginDir(plan)
    const T = themeDir(plan)
    const names = uniqueNames(plan.sections, (s) => bareName(s.widget || s.id, prefix))
    const widgetPhp: string[] = []
    for (const s of plan.sections) {
      const n = names.get(s)!
      const php = `${P}/widgets/class-${n}.php`
      const css = `${P}/assets/css/${n}.css`
      llm(php, 'widget-php', s.id)
      llm(css, 'widget-css', s.id, [php])
      if (s.js && s.js !== 'none') llm(`${P}/assets/js/${n}.js`, 'widget-js', s.id, [php, css])
      widgetPhp.push(php)
    }
    const header = plan.sections.find((s) => sectionRole(s, pre, s.widget) === 'header')
    const footer = plan.sections.find((s) => sectionRole(s, pre, s.widget) === 'footer')
    llm(`${T}/assets/css/theme.css`, 'theme-css')
    llm(`${T}/header.php`, 'theme-header', header?.id, [`${T}/assets/css/theme.css`, `${T}/inc/template-functions.php`])
    llm(`${T}/footer.php`, 'theme-footer', footer?.id, [`${T}/assets/css/theme.css`, `${T}/inc/template-functions.php`])
    const phpOf = (s: ElementorSection): string => `${P}/widgets/class-${names.get(s)}.php`
    const content = plan.sections.filter((s) => s !== header && s !== footer)
    llm(`${P}/demo/home.json`, 'demo-json', undefined, content.map(phpOf))
    if (header) llm(`${P}/demo/header.json`, 'demo-json', header.id, [phpOf(header)])
    if (footer) llm(`${P}/demo/footer.json`, 'demo-json', footer.id, [phpOf(footer)])
  } else {
    const T = themeDir(plan)
    const tj = `${T}/theme.json`
    llm(tj, 'theme-json')
    const names = uniqueNames(plan.sections, (s) => bareName(s.slug || s.id, prefix))
    const patterns: string[] = []
    for (const s of plan.sections) {
      const role = sectionRole(s, pre, s.slug)
      if (role === 'header' && !files.some((f) => f.path === `${T}/parts/header.html`)) llm(`${T}/parts/header.html`, 'template-part', s.id, [tj])
      else if (role === 'footer' && !files.some((f) => f.path === `${T}/parts/footer.html`)) llm(`${T}/parts/footer.html`, 'template-part', s.id, [tj])
      else {
        const p = `${T}/patterns/${names.get(s)}.php`
        llm(p, 'pattern', s.id, [tj])
        patterns.push(p)
      }
    }
    llm(`${T}/assets/css/theme.css`, 'theme-css', undefined, [tj, ...patterns])
    if (plan.sections.some((s) => s.js && s.js !== 'none')) llm(`${T}/assets/js/theme.js`, 'theme-js', undefined, patterns)
  }
  return files
}

/** Kullanıcının elle eklediği satırlar için dosya türü tahmini */
export function inferKind(path: string, mode: Plan['mode']): FileKind {
  const p = path.replace(/\\/g, '/')
  if (/README\.md$/i.test(p)) return 'readme'
  if (mode === 'elementor-free') {
    if (/\/widgets\/[^/]+\.php$/.test(p)) return 'widget-php'
    if (/\/demo\/[^/]+\.json$/.test(p)) return 'demo-json'
    if (/\/header\.php$/.test(p)) return 'theme-header'
    if (/\/footer\.php$/.test(p)) return 'theme-footer'
    if (/-elementor-widgets\/.*\.css$/.test(p)) return 'widget-css'
    if (/-elementor-widgets\/.*\.js$/.test(p)) return 'widget-js'
    return 'theme-css'
  }
  if (/theme\.json$/.test(p)) return 'theme-json'
  if (/\/parts\/[^/]+\.html$/.test(p)) return 'template-part'
  if (/\/patterns\/[^/]+\.php$/.test(p)) return 'pattern'
  if (/\/templates\/[^/]+\.html$/.test(p)) return 'template'
  if (/\.js$/.test(p)) return 'theme-js'
  return 'theme-css'
}

/** dependsOn'a göre kararlı topolojik sıralama (döngü varsa verilen sıra korunur) */
export function orderFiles(files: PlanFile[]): PlanFile[] {
  const byPath = new Map(files.map((f) => [f.path, f]))
  const out: PlanFile[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (f: PlanFile): void => {
    const st = state.get(f.path)
    if (st) return
    state.set(f.path, 'visiting')
    for (const d of f.dependsOn ?? []) {
      const dep = byPath.get(d)
      if (dep && state.get(d) !== 'visiting') visit(dep)
    }
    state.set(f.path, 'done')
    out.push(f)
  }
  files.forEach(visit)
  return out
}

export type AnySection = ElementorSection | BlockSection
