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

/**
 * Token tasarrufu: "## Dosya türüne göre gereksinimler" bölümünden yalnızca bu dosyanın türüne ait
 * "### tür" alt bölümü kalır (başlık "### theme-header / theme-footer" gibi birden çok tür sayabilir).
 * Her çağrıda tek dosya üretildiği için diğer türlerin kuralları modele gereksiz bağlamdır.
 */
export function selectKindRules(md: string, kind: string): string {
  const start = md.search(/^## Dosya türüne göre gereksinimler\s*$/m)
  if (start < 0) return md
  const afterHeading = md.indexOf('\n', start) + 1
  const nextH2 = md.slice(afterHeading).search(/^## /m)
  const end = nextH2 < 0 ? md.length : afterHeading + nextH2
  const body = md.slice(afterHeading, end)
  const parts = body.split(/^(?=### )/m)
  const kept = parts.filter((p) => {
    if (!p.startsWith('### ')) return p.trim() !== ''
    const kinds = p
      .slice(4, p.indexOf('\n') < 0 ? undefined : p.indexOf('\n'))
      .replace(/\([^)]*\)/g, '')
      .split('/')
      .map((k) => k.trim())
    return kinds.includes(kind)
  })
  // Tür eşleşmezse (yeni tür, elle eklenen dosya) bölüm olduğu gibi kalır
  if (!kept.some((p) => p.startsWith('### '))) return md
  return md.slice(0, afterHeading) + '\n' + kept.join('').trim() + '\n\n' + md.slice(end)
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
