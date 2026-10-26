import type { Plan, PreAnalysis, ProjectState, QualityItem, TestReport } from '../types'
import { checkPhpPrefix } from '../validate/php'
import { lineAt } from '../validate/common'

export type { CheckStatus, QualityItem } from '../types'

const MAX_DETAILS = 12

function item(id: string, label: string, problems: string[], warnOnly = false): QualityItem {
  return {
    id,
    label,
    status: problems.length === 0 ? 'pass' : warnOnly ? 'warn' : 'fail',
    details: problems.length > MAX_DETAILS ? [...problems.slice(0, MAX_DETAILS), `… ve ${problems.length - MAX_DETAILS} tane daha`] : problems
  }
}

function grep(files: Map<string, string>, re: RegExp, filter: (path: string) => boolean = () => true): string[] {
  const hits: string[] = []
  for (const [path, content] of files) {
    if (!filter(path)) continue
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (const m of content.matchAll(g)) hits.push(`${path} (satır ${lineAt(content, m.index ?? 0)}): ${m[0].trim().slice(0, 80)}`)
  }
  return hits
}

/** docs/MIMARI.md'deki kalite kontrol listesi — Export ekranında gösterilir */
export function qualityChecklist(
  plan: Plan,
  pre: PreAnalysis,
  state: ProjectState,
  files: Map<string, string>,
  report?: TestReport | null,
  assets?: { placeholders: string[] } | null
): QualityItem[] {
  const { prefix, textdomain } = plan.theme
  const elementor = plan.mode === 'elementor-free'
  const isPhp = (p: string): boolean => p.endsWith('.php')
  const isMarkup = (p: string): boolean => /\/(patterns|parts|templates)\//.test(p)

  // 1. Bölümler
  const mapped = new Set(plan.sections.map((s) => s.htmlRef))
  const sectionProblems = pre.sections.filter((s) => !mapped.has(s.id)).map((s) => `${s.id} <${s.tag}> hiçbir ${elementor ? "widget'a" : "pattern'e"} eşlenmedi`)
  for (const s of plan.sections) {
    const main = plan.files.find((f) => f.sectionId === s.id && (f.kind === 'widget-php' || f.kind === 'pattern' || f.kind === 'template-part'))
    if (!main) sectionProblems.push(`${s.id}: ana dosyası planda yok`)
    else if (state.files[main.path]?.status !== 'ok') sectionProblems.push(`${main.path}: ${state.files[main.path]?.status ?? 'üretilmedi'}`)
  }

  // 2. Gömülü renk / metin
  const hardcoded = elementor
    ? grep(files, /^(?!.*(?:'default'|"default"|=>\s*\[|var\(--)).*#[0-9a-fA-F]{6}\b.*$/m, (p) => /\/widgets\/.*\.php$/.test(p))
    : grep(files, /(?:style="[^"]*|"(?:background|text|color)"\s*:\s*")#[0-9a-fA-F]{3,6}\b/, isMarkup)

  // 3. Pro bağımlılığı
  const pro = grep(files, /ElementorPro\\|elementor-pro|ELEMENTOR_PRO_VERSION|Theme_Builder|\\ElementorPro/, (p) => isPhp(p) || p.endsWith('.json'))

  // 4. Deprecated API
  const deprecated = grep(files, /\b_register_controls\b|\bScheme_(Color|Typography)\b|\b_content_template\b|elementor\/widgets\/widgets_registered|->register_widget_type\(/, isPhp)

  // 5. Doğrulama durumu
  const validation = plan.files.filter((f) => state.files[f.path]?.status !== 'ok').map((f) => `${f.path}: ${state.files[f.path]?.status ?? 'üretilmedi'}${state.files[f.path]?.errors ? ' — ' + state.files[f.path].errors!.split('\n')[0] : ''}`)

  // 6. Escape + çeviri
  const escape = grep(files, /\becho\s+\$[\w\[\]'"->]+\s*;(?!.*phpcs:ignore)/, (p) => isPhp(p) && !isMarkup(p))
  const domains = new Set<string>()
  for (const [path, c] of files) {
    if (!isPhp(path)) continue
    for (const m of c.matchAll(/\b(?:__|_e|_x|_n|esc_html__|esc_html_e|esc_attr__|esc_attr_e|esc_html_x|esc_attr_x)\(\s*(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*,\s*(?:'(?:\\.|[^'\\])*'\s*,\s*)?['"]([\w-]+)['"]/g)) {
      if (m[1] !== textdomain) domains.add(`${path}: text domain "${m[1]}" (beklenen "${textdomain}")`)
    }
  }

  // 7. Önek
  const prefixProblems: string[] = []
  for (const [path, c] of files) if (isPhp(path)) for (const i of checkPhpPrefix(c, prefix)) prefixProblems.push(`${path} (satır ${i.line}): ${i.message}`)

  return [
    item('sections', 'Tüm HTML bölümleri bir widget/blok şablonuna dönüştü', sectionProblems),
    item('hardcoded', 'Koda gömülü renk kalmadı', hardcoded, true),
    ...(elementor ? [item('pro', 'Elementor Pro bağımlılığı yok', pro)] : []),
    item('deprecated', 'Deprecated API yok', deprecated),
    item('validation', "Tüm PHP dosyaları php -l'den geçti, tüm JSON'lar parse ediliyor", validation),
    item('escape', 'Escape ve çeviri fonksiyonları eksiksiz', [...escape.map((e) => `escape edilmemiş echo: ${e}`), ...domains], true),
    item('prefix', 'Önek tüm global isimlerde kullanılmış', prefixProblems),
    item(
      'assets',
      'Görseller temada (yer tutucu yok)',
      (assets?.placeholders ?? []).map((p) => `${p}: kaynakta bulunamadı, yer tutucu yazıldı — gerçek görseli bu yola koyun`),
      true
    ),
    liveTestItem(report, state)
  ]
}

/** Son canlı WordPress testi (Playwright); hiç çalışmadıysa ya da sonra dosya değiştiyse uyarı */
function liveTestItem(report: TestReport | null | undefined, state: ProjectState): QualityItem {
  const label = 'Canlı WordPress testi (Playwright) geçti'
  if (!report) return item('live-test', label, ['Henüz çalıştırılmadı: Test ekranından başlatın'], true)
  const last = report.rounds.at(-1)?.issues ?? []
  const problems = report.error ? [report.error.split('\n')[0]] : last.filter((i) => i.severity === 'error').map((i) => `${i.file ?? '(dosya yok)'}: ${i.message}`)
  if (problems.length) return item('live-test', label, problems)
  const stale = state.updatedAt > report.finishedAt ? ['Dosyalar son testten sonra değişti; testi yeniden çalıştırın'] : []
  return item('live-test', label, [...stale, ...last.map((i) => `uyarı: ${i.file ?? '(dosya yok)'}: ${i.message}`)], true)
}
