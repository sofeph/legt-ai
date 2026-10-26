import type { Plan, TestIssue } from '../types'
import { pluginDir, themeDir } from '../pipeline/layout'

/**
 * Test sitesindeki yol / URL'leri `output/` altındaki dosya yollarına çevirir.
 *   .../wp-content/themes/{slug}/x.php           → {slug}/x.php
 *   http://127.0.0.1:p/wp-content/plugins/{dir}/a.js?ver=1 → {dir}/a.js
 */
export class Attributor {
  private roots: string[]

  constructor(private plan: Plan) {
    this.roots = [`themes/${themeDir(plan)}/`, ...(plan.mode === 'elementor-free' ? [`plugins/${pluginDir(plan)}/`] : [])]
  }

  /** Dosya yolu ya da URL → output yolu (bizim dosyamız değilse undefined) */
  toOutput(pathOrUrl: string | undefined): string | undefined {
    if (!pathOrUrl) return undefined
    const p = pathOrUrl.replace(/\\/g, '/').replace(/[?#].*$/, '')
    for (const root of this.roots) {
      const i = p.indexOf(`/wp-content/${root}`)
      if (i >= 0) return root.slice(root.indexOf('/') + 1) + p.slice(i + `/wp-content/${root}`.length)
    }
    return undefined
  }

  /** Metindeki (yığın izi, hata mesajı) ilk bizim dosyamız; `file.php:12`, `file.php(12)`, `url:12:5` biçimleri */
  firstOwned(text: string): { file: string; line?: number } | undefined {
    const re = /((?:[A-Za-z]:)?[^\s"'()<>]*\/wp-content\/(?:themes|plugins)\/[^\s"'()<>:]+?\.(?:php|js|css|html|json))(?:(?:\?[^\s:)]*)?(?::(\d+)|\((\d+)\)| on line (\d+)))?/g
    for (const m of text.replace(/\\/g, '/').matchAll(re)) {
      const file = this.toOutput(m[1])
      if (file) {
        const line = m[2] ?? m[3] ?? m[4]
        return { file, ...(line ? { line: +line } : {}) }
      }
    }
    return undefined
  }

  /** Plan'da olan (üretilmiş) dosya mı? */
  inPlan(file: string | undefined): boolean {
    return !!file && this.plan.files.some((f) => f.path === file)
  }
}

export interface PhpLogEntry {
  level: 'fatal' | 'parse' | 'warning' | 'notice' | 'deprecated' | 'other'
  message: string
}

/** WordPress debug.log: her kayıt "[tarih] PHP <Tür>:  mesaj" ile başlar, yığın izi sonraki satırlarda */
export function parseDebugLog(log: string): PhpLogEntry[] {
  const entries: PhpLogEntry[] = []
  for (const chunk of log.split(/\r?\n(?=\[\d)/)) {
    const m = /^\[[^\]]+\]\s+(?:PHP\s+)?([A-Za-z ]+?)(?: error)?:\s+([\s\S]*)$/.exec(chunk.trim())
    if (!m) continue
    const t = m[1].toLowerCase()
    const level: PhpLogEntry['level'] = /fatal/.test(t) ? 'fatal' : /parse/.test(t) ? 'parse' : /warning/.test(t) ? 'warning' : /notice/.test(t) ? 'notice' : /deprecated/.test(t) ? 'deprecated' : 'other'
    entries.push({ level, message: m[2].trim() })
  }
  return entries
}

/**
 * debug.log → test sorunları. Bizim dosyalarımızdan gelen her şey raporlanır; çekirdek/Elementor
 * kaynaklı kayıtlar yalnızca ölümcülse (site çöker) ya da yığın izinde bizim dosyamız varsa.
 */
export function phpIssues(log: string, attr: Attributor): TestIssue[] {
  const seen = new Set<string>()
  const issues: TestIssue[] = []
  for (const e of parseDebugLog(log)) {
    const owned = attr.firstOwned(e.message)
    const fatal = e.level === 'fatal' || e.level === 'parse'
    if (!owned && !fatal) continue
    const head = e.message.split('\n')[0].slice(0, 400)
    const key = `${e.level}|${head}`
    if (seen.has(key)) continue
    seen.add(key)
    issues.push({
      kind: 'php',
      severity: fatal || e.level === 'warning' ? 'error' : 'warning',
      message: `PHP ${e.level}: ${head}`,
      ...(owned ? { file: owned.file } : {}),
      detail: e.message.slice(0, 3000)
    })
  }
  return issues
}

/** Aynı sorunun farklı sayfa/viewport'larda tekrarını tekilleştirir (ilk URL kalır) */
export function dedupeIssues(issues: TestIssue[]): TestIssue[] {
  const out = new Map<string, TestIssue>()
  for (const i of issues) {
    const key = `${i.kind}|${i.file ?? ''}|${i.sectionId ?? ''}|${i.message}`
    const prev = out.get(key)
    if (!prev) out.set(key, i)
    else if (i.viewport && prev.viewport && !prev.viewport.split(', ').includes(i.viewport)) prev.viewport += `, ${i.viewport}`
  }
  return [...out.values()]
}
