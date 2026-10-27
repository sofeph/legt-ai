import { Script } from 'node:vm'
import type { Mode, ValidationIssue } from '../types'
import { checkBlockMarkup, checkNoPhp, checkPatternHeader, checkRawHex } from './blocks'
import { checkBracketBalance, checkForbidden } from './common'
import { checkDynamicMenu, checkElementorApi } from './elementor'
import { checkUndefinedFunctions } from './functions'
import { checkNamespaceFirst, checkPhpLight, checkPhpPrefix, checkPhpSyntax, phpLint } from './php'

export interface ValidateContext {
  mode: Mode
  slug: string
  prefix: string
  /** false ise php kurulu olsa bile php -l atlanır (testler için) */
  usePhpLint?: boolean
  /** Projenin diğer PHP dosyalarında tanımlı fonksiyonlar; verilmezse tanımsız fonksiyon kontrolü yapılmaz */
  projectFunctions?: Iterable<string>
}

export function checkJson(src: string): ValidationIssue[] {
  try {
    JSON.parse(src)
    return []
  } catch (e) {
    const msg = (e as Error).message
    const pos = /position (\d+)/.exec(msg)
    const line = pos ? src.slice(0, +pos[1]).split('\n').length : (/line (\d+)/.exec(msg)?.[1] ?? undefined)
    return [{ rule: 'json', message: `JSON.parse hatası: ${msg}`, line: line ? +line : undefined }]
  }
}

export function checkJs(src: string): ValidationIssue[] {
  try {
    new Script(src)
    return []
  } catch (e) {
    const line = /:(\d+)/.exec((e as Error).stack ?? '')?.[1]
    return [{ rule: 'js-syntax', message: `JS sözdizimi hatası: ${(e as Error).message}`, line: line ? +line : undefined }]
  }
}

/** Dosya yolundan ve moddan hangi kuralların uygulanacağını çıkarır */
export async function validateFile(path: string, content: string, ctx: ValidateContext): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []
  const p = path.replace(/\\/g, '/')
  const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase()
  const isBlockMarkup = ctx.mode === 'block-theme' && /\/(templates|parts)\/[^/]+\.html$/.test(p)
  const isPattern = ctx.mode === 'block-theme' && /\/patterns\/[^/]+\.php$/.test(p)
  const isWidget = ctx.mode === 'elementor-free' && /-elementor-widgets\/widgets\/[^/]+\.php$/.test(p)

  if (!content.trim()) return [{ rule: 'empty', message: 'Dosya boş' }]
  if (ext !== 'md') issues.push(...checkForbidden(content))

  switch (ext) {
    case 'php': {
      const lint = ctx.usePhpLint === false ? null : await phpLint(content)
      // php -l yoksa: açılış etiketi + JS ayrıştırıcı ile tam sözdizimi kontrolü
      issues.push(...(lint ?? [...checkPhpLight(content).filter((i) => i.rule === 'php-open-tag'), ...checkPhpSyntax(content)]))
      // php -l varsa bunu zaten yakalar; çift raporlanmasın
      if (!lint?.some((i) => /namespace/i.test(i.message))) issues.push(...checkNamespaceFirst(content))
      issues.push(...checkPhpPrefix(content, ctx.prefix))
      if (isWidget) issues.push(...checkElementorApi(content), ...checkDynamicMenu(p, content))
      if (ctx.projectFunctions) issues.push(...checkUndefinedFunctions(content, ctx.projectFunctions))
      if (isPattern) {
        issues.push(...checkPatternHeader(content, ctx.slug), ...checkBlockMarkup(content), ...checkRawHex(content))
      }
      break
    }
    case 'json':
      issues.push(...checkJson(content))
      break
    case 'js':
      issues.push(...checkJs(content))
      break
    case 'css':
      issues.push(...checkBracketBalance(content))
      break
    case 'html':
      if (isBlockMarkup) issues.push(...checkNoPhp(content), ...checkBlockMarkup(content), ...checkRawHex(content))
      break
  }
  return issues
}

export function formatIssues(path: string, issues: ValidationIssue[]): string {
  return issues.map((i) => `${path}${i.line ? ` (satır ${i.line})` : ''}: ${i.message}`).join('\n')
}
