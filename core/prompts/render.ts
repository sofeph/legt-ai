import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Mode } from '../types'

export type PromptName = 'system' | 'analyze' | 'file' | 'repair' | 'test-plan' | 'test-repair'

export class UnfilledPlaceholderError extends Error {
  constructor(public placeholders: string[]) {
    super(`Doldurulmamış yer tutucu: ${placeholders.join(', ')}`)
  }
}

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][\w]*)\s*\}\}/g

/**
 * `{{değişken}}` yer tutucularını doldurur. Nesneler JSON olarak basılır.
 * Doldurulmamış yer tutucu kalırsa hata fırlatır (çağrı yapılmaz).
 */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  const missing = new Set<string>()
  const out = template.replace(PLACEHOLDER_RE, (whole, key: string) => {
    if (!(key in vars) || vars[key] === undefined || vars[key] === null) {
      missing.add(key)
      return whole
    }
    const v = vars[key]
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  })
  if (missing.size) throw new UnfilledPlaceholderError([...missing])
  return out
}

/** HTML yorumları (<!-- ... -->) prompt'a gitmez; dosya içi not içindir */
export function stripAuthorComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, '')
}

export async function loadPrompt(promptsDir: string, mode: Mode, name: PromptName): Promise<string> {
  return stripAuthorComments(await readFile(join(promptsDir, mode, `${name}.md`), 'utf8'))
}

/** "trk" → "Trk", "my_shop" → "My_Shop" (PHP namespace için) */
export function pascalPrefix(prefix: string): string {
  return prefix
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('_')
}

/** "trk-hero-slider" → "Hero_Slider" (önek atılır) */
export function widgetClassName(widgetName: string, prefix: string): string {
  const bare = widgetName.startsWith(prefix + '-') ? widgetName.slice(prefix.length + 1) : widgetName
  return bare
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('_')
}
