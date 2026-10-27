import { readFile } from 'node:fs/promises'
import { clipText, collectCss, compactHtml, relevantCss } from '../html/relevantCss'
import { TEMPERATURE, type ChatMessage, type LLMProvider } from '../llm/provider'
import { isFatalError, withRetry } from '../llm/retry'
import type { ProjectStore } from '../project/store'
import { loadPrompt, pascalPrefix, renderTemplate, selectKindRules, widgetClassName } from '../prompts/render'
import { renderScaffold } from '../scaffold'
import { buildWidgetCss } from './widgetCss'
import type { BlockSection, ElementorSection, FileKind, FileStatus, GenEvent, IntakeInput, Plan, PlanFile, PreAnalysis, ProjectState, ValidationIssue } from '../types'
import { formatIssues, validateFile } from '../validate'
import { autoFix } from '../validate/autofix'
import { completeAssets } from './assets'
import { definedFunctions } from '../validate/functions'
import { extractFileLenient } from './fileBlocks'
import { inferKind, orderFiles, preSection } from './layout'
import { extractSignature } from './signatures'
import { clampConcurrency, runPool } from '../pool'

export const MAX_REPAIRS = 2

export type { GenEvent } from '../types'

export interface GenerateOptions {
  provider: LLMProvider
  promptsDir: string
  scaffoldDir: string
  store: ProjectStore
  projectId: string
  /** Bağlam bütçesi için (Ollama num_ctx) */
  numCtx: number
  signal?: AbortSignal
  /** Yalnızca bu dosyaları (yeniden) üret; verilmezse durumu ok olmayan her dosya */
  only?: string[]
  usePhpLint?: boolean
  /** Aynı anda çalışan LLM ajanı (1-10); bağımlılıklar her zaman önce üretilir */
  concurrency?: number
  onEvent?: (e: GenEvent) => void
}

export interface GenContext {
  intake: IntakeInput
  pre: PreAnalysis
  plan: Plan
  css: string
  numCtx: number
  read: (path: string) => Promise<string | null>
}

type AnySection = ElementorSection | BlockSection

export { isFatalError, isTransientError } from '../llm/retry'

export class CancelledError extends Error {
  constructor() {
    super('İptal edildi')
  }
}

function sectionOf(plan: Plan, id?: string): AnySection | undefined {
  return id ? (plan.sections as AnySection[]).find((s) => s.id === id) : undefined
}

function sectionHtmlWithCss(ctx: GenContext, section: AnySection, withCss: boolean): string {
  const html = preSection(ctx.pre, section.htmlRef)?.html ?? ''
  if (!html) return '(kaynak HTML bulunamadı)'
  const budget = Math.max(4000, Math.floor(ctx.numCtx * 1.2))
  const compact = compactHtml(html)
  const css = withCss ? relevantCss(ctx.css, { html }) : ''
  return clipText(css ? `${compact}\n\n<style>\n/* Kaynak CSS (bu bölümle ilgili kurallar) */\n${css}\n</style>` : compact, budget)
}

function globalCss(ctx: GenContext): string {
  const css = relevantCss(ctx.css, 'global')
  return css ? clipText(`<style>\n/* Kaynak CSS (genel kurallar) */\n${css}\n</style>`, Math.max(3000, Math.floor(ctx.numCtx * 0.8))) : '(kaynakta genel CSS kuralı yok)'
}

function sectionSummaries(plan: Plan): object[] {
  return (plan.sections as AnySection[]).map((s) =>
    'widget' in s ? { id: s.id, widget: s.widget, title: s.title, js: s.js } : { id: s.id, slug: s.slug, title: s.title, js: s.js, className: s.className }
  )
}

/** Bir dosyanın file.md yer tutucuları */
/** Widget PHP'sine verilen sınıf kuralı: 'source' modunda kaynak sınıfları korunur (CSS kaynaktan üretilir) */
function classRule(plan: Plan, prefix: string, widget: string): string {
  if (plan.mode === 'elementor-free' && plan.cssMode === 'source') {
    const root = prefix + '-' + (widget || 'widget').replace(new RegExp('^' + prefix + '-'), '')
    return "kaynak HTML'in sınıf adlarını AYNEN koru (yeniden adlandırma ve önek ekleme YOK; widget CSS'i kaynaktan otomatik üretilir, sen yazmazsın) ve kök öğeye ek olarak " + '`' + root + '`' + ' sınıfını ver'
  }
  return 'sınıfları ' + '`' + prefix + '-' + '`' + ' önekiyle yeniden adlandır'
}

export async function buildFileVars(ctx: GenContext, file: PlanFile, kind: FileKind): Promise<Record<string, unknown>> {
  const { plan } = ctx
  const { name, slug, prefix, textdomain, language } = plan.theme
  const bp = (plan.tokens as { breakpoints?: { tablet?: number; mobile?: number } }).breakpoints ?? {}
  const section = sectionOf(plan, file.sectionId)

  let sectionVar: unknown = '(bu dosya tek bir bölüme bağlı değil)'
  let sectionHtml = '(yok)'
  switch (kind) {
    case 'widget-php':
    case 'widget-css':
    case 'pattern':
    case 'template-part':
    case 'theme-header':
    case 'theme-footer':
      if (section) {
        sectionVar = section
        sectionHtml = sectionHtmlWithCss(ctx, section, true)
      } else if (kind === 'theme-header' || kind === 'theme-footer') {
        sectionHtml = `(kaynakta ${kind === 'theme-header' ? 'header' : 'footer'} bölümü yok; tema token'larıyla sade bir ${kind === 'theme-header' ? 'header' : 'footer'} üret)`
      }
      break
    case 'widget-js':
      if (section) {
        sectionVar = section
        sectionHtml = sectionHtmlWithCss(ctx, section, false)
      }
      break
    case 'theme-css':
      sectionVar = sectionSummaries(plan)
      sectionHtml = globalCss(ctx)
      break
    case 'theme-json':
      sectionVar = '(tüm tema — global ayarlar ve stiller)'
      sectionHtml = globalCss(ctx)
      break
    case 'theme-js': {
      const jsSections = (plan.sections as AnySection[]).filter((s) => s.js && s.js !== 'none')
      sectionVar = jsSections
      const budget = Math.max(4000, Math.floor(ctx.numCtx * 1.2))
      sectionHtml = clipText(jsSections.map((s) => compactHtml(preSection(ctx.pre, s.htmlRef)?.html ?? '')).join('\n\n'), budget)
      break
    }
    case 'demo-json':
      sectionVar = section
        ? section
        : (plan.sections as ElementorSection[])
            .filter((s) => (file.dependsOn ?? []).some((d) => d.endsWith(`class-${s.widget.slice(prefix.length + 1)}.php`)))
            .map((s) => ({ id: s.id, widget: s.widget, title: s.title, contentControls: s.contentControls, repeater: s.repeater }))
      sectionHtml = "(yok — widget ayarlarında bağımlı dosya imzalarındaki kontrol id'lerini kullan)"
      break
  }

  const deps: string[] = []
  for (const d of file.dependsOn ?? []) {
    const content = await ctx.read(d)
    deps.push(content === null ? `### ${d}\n- (henüz üretilmedi)` : extractSignature(d, content))
  }

  const widget = section && 'widget' in section ? section.widget : ''
  return {
    name,
    slug,
    prefix,
    Prefix: pascalPrefix(prefix),
    textdomain,
    language,
    path: file.path,
    fileKind: kind,
    tokens: plan.tokens,
    section: sectionVar,
    sectionHtml,
    dependencySignatures: deps.length ? deps.join('\n\n') : '(yok)',
    widgetName: widget || '(yok)',
    WidgetClass: widget ? widgetClassName(widget, prefix) : '(yok)',
    tabletBp: String(bp.tablet ?? 1024),
    mobileBp: String(bp.mobile ?? 767),
    classRule: classRule(plan, prefix, widget)
  }
}

/** Plan ile sözleşme: manifest'teki class/namespace, get_name, pattern slug'ı */
export function checkContract(plan: Plan, file: PlanFile, kind: FileKind, content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const section = sectionOf(plan, file.sectionId)
  if (kind === 'widget-php' && section && 'widget' in section) {
    const ns = `${pascalPrefix(plan.theme.prefix)}\\Widgets`
    const cls = `Widget_${widgetClassName(section.widget, plan.theme.prefix)}`
    const foundNs = /^\s*namespace\s+([\w\\]+)\s*;/m.exec(content)?.[1]
    if (foundNs !== ns) issues.push({ rule: 'contract', message: `Namespace "${ns}" olmalı (bulunan: ${foundNs ?? 'yok'})` })
    if (!new RegExp(`\\bclass\\s+${cls}\\b`).test(content)) issues.push({ rule: 'contract', message: `Class adı "${cls}" olmalı` })
    const name = /function\s+get_name\s*\(\s*\)[^{]*\{\s*return\s+['"]([^'"]+)['"]/.exec(content)?.[1]
    if (name !== section.widget) issues.push({ rule: 'contract', message: `get_name() "${section.widget}" döndürmeli (bulunan: ${name ?? 'yok'})` })
    if (!/function\s+register_controls\s*\(/.test(content)) issues.push({ rule: 'contract', message: 'register_controls() metodu eksik' })
    if (!/function\s+render\s*\(/.test(content)) issues.push({ rule: 'contract', message: 'render() metodu eksik' })
  }
  if (kind === 'pattern' && section && 'slug' in section) {
    const slug = /^\s*\*\s*Slug:\s*(\S+)/m.exec(content)?.[1]
    if (slug && slug !== section.slug) issues.push({ rule: 'contract', message: `Pattern Slug: "${section.slug}" olmalı (bulunan: ${slug})`, line: 1 })
  }
  return issues
}

/** Projenin (bu dosya dışındaki) PHP dosyalarında tanımlı fonksiyonlar: tanımsız fonksiyon kontrolü için */
async function projectFunctions(ctx: GenContext, except: string): Promise<string[]> {
  const out: string[] = []
  for (const f of ctx.plan.files) {
    if (f.path === except || !f.path.endsWith('.php')) continue
    const src = await ctx.read(f.path)
    if (src) out.push(...definedFunctions(src))
  }
  return out
}

export async function validateAll(ctx: GenContext, file: PlanFile, kind: FileKind, content: string, usePhpLint?: boolean): Promise<ValidationIssue[]> {
  // Scaffold deterministik ve testli; tanımsız fonksiyon kontrolü LLM'in yazdığı PHP içindir
  const fns = file.path.endsWith('.php') && kind !== 'scaffold' ? await projectFunctions(ctx, file.path) : undefined
  const base = await validateFile(file.path, content, { mode: ctx.plan.mode, slug: ctx.plan.theme.slug, prefix: ctx.plan.theme.prefix, usePhpLint, ...(fns ? { projectFunctions: fns } : {}) })
  return [...base, ...(kind === 'scaffold' ? [] : checkContract(ctx.plan, file, kind, content))]
}

export async function loadContext(store: ProjectStore, id: string, numCtx: number): Promise<GenContext & { state: ProjectState }> {
  const [intake, pre, plan, state] = await Promise.all([
    store.readJson<IntakeInput>(id, 'intake.json'),
    store.readJson<PreAnalysis>(id, 'preanalysis.json'),
    store.readJson<Plan>(id, 'plan.json'),
    store.readJson<ProjectState>(id, 'state.json')
  ])
  if (!intake || !pre || !plan || !state) throw new Error(`Proje eksik ya da plan onaylanmamış: ${id}`)
  const read = async (path: string): Promise<string | null> => {
    try {
      return await readFile(store.safePath(id, `output/${path}`), 'utf8')
    } catch {
      return null
    }
  }
  return { intake, pre, plan, state, css: collectCss(intake.sources), numCtx, read }
}

/** ADIM 3-6: scaffold + LLM dosyaları, her dosyadan sonra doğrulama ve en fazla 2 onarım */
export async function generate(opts: GenerateOptions): Promise<ProjectState> {
  const { store, projectId: id, provider } = opts
  const ctx = await loadContext(store, id, opts.numCtx)
  const { plan, state } = ctx
  const mode = plan.mode
  const [systemMd, fileMd, repairMd] = await Promise.all([
    loadPrompt(opts.promptsDir, mode, 'system'),
    loadPrompt(opts.promptsDir, mode, 'file'),
    loadPrompt(opts.promptsDir, mode, 'repair')
  ])

  // only verilirse YALNIZCA o dosyalar (zorla) üretilir; verilmezse durumu ok olmayan ya da diskte olmayan her dosya
  const skip = async (f: PlanFile): Promise<boolean> =>
    opts.only ? !opts.only.includes(f.path) : state.files[f.path]?.status === 'ok' && (await ctx.read(f.path)) !== null
  const setStatus = async (path: string, status: FileStatus, attempts: number, errors?: string): Promise<void> => {
    state.files[path] = { status, attempts, ...(errors ? { errors } : {}) }
    await store.saveState(id, state)
    opts.onEvent?.({ type: 'file', path, status, attempts, errors })
  }

  // "generating" durumunda kalmış dosyalar (uygulama kapandı) yeniden sıraya girer
  for (const f of Object.values(state.files)) if (f.status === 'generating') f.status = 'pending'
  state.step = 'generating'
  await store.saveState(id, state)

  // ---- Scaffold (LLM yok) ----
  const scaffold = await renderScaffold(opts.scaffoldDir, plan, ctx.pre)
  // Widget CSS'i (cssMode: 'source'): kaynak CSS kuralları widget kapsamına alınır, LLM çağrısı yok
  if (plan.mode === 'elementor-free' && plan.cssMode === 'source') {
    for (const f of plan.files) {
      if (f.kind !== 'widget-css' || f.source !== 'scaffold' || !f.sectionId) continue
      const section = sectionOf(plan, f.sectionId)
      if (!section || !('widget' in section)) continue
      scaffold.set(f.path, buildWidgetCss(ctx.css, preSection(ctx.pre, section.htmlRef)?.html ?? '', section.widget))
    }
  }
  // Eski planlarda LLM'e verilmiş ama artık şablonu olan dosyalar (header/footer, demo JSON) şablondan
  // üretilir: daha az LLM çağrısı, wp_head/wp_footer'ı unutan ya da boş demo üreten modele bağımlılık yok
  const promoted = plan.files.filter((f) => f.source === 'llm' && scaffold.has(f.path))
  if (promoted.length) {
    for (const f of promoted) {
      f.source = 'scaffold'
      f.kind = 'scaffold'
      if (state.files[f.path]?.status === 'ok') state.files[f.path] = { status: 'pending', attempts: 0 }
    }
    await store.savePlan(id, plan, state.step)
  }

  // Daha önce "tamam" sayılmış LLM dosyaları: kodla düzeltilebilenler düzeltilir, güncel kurallarla
  // yeniden doğrulanır. Hâlâ hatalı olan bu çalıştırmada yeniden üretilir; düzelen LLM'e hiç gitmez.
  if (!opts.only) {
    for (const f of plan.files.filter((f) => f.source === 'llm' && state.files[f.path]?.status === 'ok')) {
      const current = await ctx.read(f.path)
      if (current === null) continue
      const fixed = autoFix(f.path, current)
      if (fixed.fixes.length) await store.writeText(id, `output/${f.path}`, fixed.content)
      const kind = f.kind && f.kind !== 'scaffold' ? f.kind : inferKind(f.path, mode)
      const issues = await validateAll(ctx, f, kind, fixed.content, opts.usePhpLint)
      if (issues.length) await setStatus(f.path, 'failed', state.files[f.path].attempts, formatIssues(f.path, issues))
    }
  }
  for (const f of plan.files.filter((f) => f.source === 'scaffold')) {
    if (await skip(f)) continue
    const content = scaffold.get(f.path)
    if (content === undefined) {
      await setStatus(f.path, 'failed', 0, `${f.path}: bu yol için scaffold şablonu yok; kaynağı "llm" yapın veya satırı silin`)
      continue
    }
    await store.writeText(id, `output/${f.path}`, content)
    const issues = await validateAll(ctx, f, 'scaffold', content, opts.usePhpLint)
    await setStatus(f.path, issues.length ? 'failed' : 'ok', 0, issues.length ? formatIssues(f.path, issues) : undefined)
  }

  // ---- LLM dosyaları ----
  // Bağımlılığı biten dosyalar aynı anda en fazla `concurrency` ajanla üretilir
  const todo: PlanFile[] = []
  for (const f of orderFiles(plan.files.filter((f) => f.source === 'llm'))) if (!(await skip(f))) todo.push(f)
  const inRun = new Set(todo.map((f) => f.path))
  const finished = new Set<string>()
  const depsDone = (f: PlanFile): boolean => (f.dependsOn ?? []).every((d) => !inRun.has(d) || finished.has(d))

  const processFile = async (f: PlanFile): Promise<void> => {
    if (opts.signal?.aborted) throw new CancelledError()
    const kind = f.kind && f.kind !== 'scaffold' ? f.kind : inferKind(f.path, mode)
    await setStatus(f.path, 'generating', 0)

    const vars = await buildFileVars(ctx, f, kind)
    const system = renderTemplate(systemMd, vars)
    const call = async (label: string, user: string): Promise<string> => {
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
      let response = ''
      let error: string | undefined
      try {
        // Geçici sağlayıcı hatasında (zaman aşımı, 429, 5xx) bekleyip aynı isteği yeniden dene
        response = await withRetry(
          () =>
            provider.chat({
              messages,
              temperature: TEMPERATURE.code,
              signal: opts.signal,
              onToken: (chunk) => opts.onEvent?.({ type: 'token', path: f.path, chunk })
            }),
          opts.signal,
          (message, wait) => {
            error = `yeniden deneniyor (${message}); ${wait / 1000} sn bekleniyor`
          }
        )
        return response
      } catch (e) {
        error = (e as Error).message
        throw e
      } finally {
        await store.log(id, `${label}-${f.path}`, { system, user, response, error })
      }
    }

    // Toleranslı çıkarım (tek ``` bloğu da kabul; ardından statik doğrulama var) + kodla düzeltilebilen
    // hatalar: biçim kayması ya da namespace sırası için LLM'e yeniden deneme/onarım çağrısı harcanmaz
    const extract = (output: string): string | null => {
      const raw = extractFileLenient(output, f.path)
      return raw === null ? null : autoFix(f.path, raw).content
    }
    let content: string | null = null
    let issues: ValidationIssue[] = []
    let attempts = 0
    try {
      opts.onEvent?.({ type: 'phase', path: f.path, phase: 'generate', attempt: 0 })
      const fileUser = renderTemplate(selectKindRules(fileMd, kind), vars)
      content = extract(await call('file', fileUser))
      issues = content === null ? [formatIssue(f.path)] : await validateAll(ctx, f, kind, content, opts.usePhpLint)

      while (issues.length && attempts < MAX_REPAIRS) {
        attempts++
        opts.onEvent?.({ type: 'phase', path: f.path, phase: 'repair', attempt: attempts })
        if (content === null) {
          // Biçim hatası: aynı dosyayı baştan iste
          content = extract(await call(`file-retry${attempts}`, fileUser))
          issues = content === null ? [formatIssue(f.path)] : await validateAll(ctx, f, kind, content, opts.usePhpLint)
        } else {
          const repairUser = renderTemplate(repairMd, { ...vars, attempt: String(attempts), errors: formatIssues(f.path, issues), content })
          const fixed = extract(await call(`repair${attempts}`, repairUser))
          if (fixed === null) issues = [formatIssue(f.path), ...issues.filter((i) => i.rule !== 'format')]
          else {
            content = fixed
            issues = await validateAll(ctx, f, kind, content, opts.usePhpLint)
          }
        }
      }
    } catch (e) {
      if (opts.signal?.aborted) {
        await setStatus(f.path, 'pending', attempts)
        throw new CancelledError()
      }
      await setStatus(f.path, 'failed', attempts, `${f.path}: LLM çağrısı başarısız: ${(e as Error).message}`)
      // Kimlik hatası dışında tek dosyanın başarısızlığı diğer dosyaları durdurmaz; başarısız dosya sonradan yeniden üretilebilir
      if (isFatalError(e)) throw e
      return
    }

    if (content !== null) await store.writeText(id, `output/${f.path}`, content)
    await setStatus(f.path, issues.length ? 'failed' : 'ok', attempts, issues.length ? formatIssues(f.path, issues) : undefined)
  }

  await runPool(
    todo,
    clampConcurrency(opts.concurrency ?? 1),
    (f) => processFile(f).finally(() => finished.add(f.path)),
    (f) => depsDone(f)
  )

  // Kodun başvurduğu görseller: kaynaklardan kopyala, yoksa yer tutucu (LLM yok, 404 görsel kalmasın)
  const assets = await completeAssets(store.dir(id), plan)
  await store.writeJson(id, 'assets.json', assets)

  const pending = plan.files.some((f) => !state.files[f.path] || state.files[f.path].status === 'pending' || state.files[f.path].status === 'generating')
  state.step = pending ? 'generating' : 'done'
  await store.saveState(id, state)
  return state
}

function formatIssue(path: string): ValidationIssue {
  return { rule: 'format', message: `Yanıt <<<FILE ${path}>>> ... <<<END>>> biçiminde değil ya da yarım kaldı` }
}

/** Kullanıcının elle düzenlediği dosyayı kaydeder ve yeniden doğrular */
export async function saveManualEdit(store: ProjectStore, id: string, path: string, content: string, usePhpLint?: boolean): Promise<ValidationIssue[]> {
  const ctx = await loadContext(store, id, 8192)
  const file = ctx.plan.files.find((f) => f.path === path)
  if (!file) throw new Error(`Plan'da olmayan dosya: ${path}`)
  const kind = file.source === 'scaffold' ? 'scaffold' : file.kind && file.kind !== 'scaffold' ? file.kind : inferKind(path, ctx.plan.mode)
  await store.writeText(id, `output/${path}`, content)
  const issues = await validateAll(ctx, file, kind, content, usePhpLint)
  const prev = ctx.state.files[path]
  ctx.state.files[path] = { status: issues.length ? 'failed' : 'ok', attempts: prev?.attempts ?? 0, ...(issues.length ? { errors: formatIssues(path, issues) } : {}) }
  const pending = ctx.plan.files.some((f) => !ctx.state.files[f.path] || ctx.state.files[f.path].status === 'pending')
  if (ctx.state.step === 'generating' && !pending) ctx.state.step = 'done'
  await store.saveState(id, ctx.state)
  return issues
}
