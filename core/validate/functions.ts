import list from './php-functions.json'
import type { ValidationIssue } from '../types'
import { lineAt } from './common'
import { phpSegments } from './php'

const KNOWN = new Set<string>(list.functions)
// Dil yapıları ve anahtar sözcükler: "x(" biçiminde görünür ama fonksiyon değildir
const KEYWORDS = new Set(['if', 'elseif', 'while', 'for', 'foreach', 'switch', 'return', 'isset', 'empty', 'unset', 'list', 'array', 'echo', 'print', 'include', 'include_once', 'require', 'require_once', 'die', 'exit', 'eval', 'catch', 'fn', 'function', 'match', 'declare', 'and', 'or', 'xor', 'not', 'use', 'new', 'clone', 'static', 'self', 'parent', 'global', 'instanceof', 'yield', 'throw', 'as', 'case', 'default', 'do', 'else', 'try', 'finally', 'class', 'interface', 'trait', 'enum', 'extends', 'implements', 'const', 'var', 'abstract', 'final', 'public', 'protected', 'private', 'readonly', 'namespace', 'goto', 'continue', 'break', 'endif', 'endwhile', 'endfor', 'endforeach', 'endswitch'])

/**
 * PHP kodunda dizge, yorum ve heredoc'ları boşlukla değiştirir (konumlar korunur). Soldan sağa tek geçiş:
 * dizgedeki "#fff" ya da "https://" yorum, yorumdaki tırnak dizge sanılmaz.
 */
export function maskPhp(src: string): string {
  const out = src.split('')
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      blank(i, j + 1)
      i = j + 1
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      const j = end < 0 ? src.length : end + 2
      blank(i, j)
      i = j
    } else if ((c === '/' && next === '/') || (c === '#' && next !== '[')) {
      let j = src.indexOf('\n', i)
      if (j < 0) j = src.length
      // ?> tek satırlık yorumu bitirir
      const close = src.indexOf('?>', i)
      if (close >= 0 && close < j) j = close
      blank(i, j)
      i = j
    } else if (c === '<' && src.startsWith('<<<', i)) {
      const m = /^<<<[ \t]*(['"]?)(\w+)\1\r?\n/.exec(src.slice(i))
      if (!m) {
        i += 3
        continue
      }
      const endRe = new RegExp(`\\n[ \\t]*${m[2]}\\b`, 'g')
      endRe.lastIndex = i + m[0].length - 1
      const end = endRe.exec(src)
      const j = end ? end.index + end[0].length : src.length
      blank(i, j)
      i = j
    } else i++
  }
  return out.join('')
}

const mask = maskPhp

/**
 * Dosyada tanımlanan global/namespace fonksiyonları. Sınıf metotları hariç: `get_x()` düz çağrısı
 * başka bir sınıftaki `get_x` metoduna gitmez (if/function_exists blokları içindekiler dahildir).
 */
export function definedFunctions(src: string): string[] {
  const code = mask(src)
  const out: string[] = []
  const stack: ('class' | 'block')[] = []
  let pendingClass = false
  for (const m of code.matchAll(/\b(class|interface|trait|enum)\s+\w+|\bfunction\s+&?\s*(\w+)\s*\(|[{}]/g)) {
    if (m[0] === '{') {
      stack.push(pendingClass ? 'class' : 'block')
      pendingClass = false
    } else if (m[0] === '}') stack.pop()
    else if (m[1]) pendingClass = true
    else if (m[2] && !stack.includes('class')) out.push(m[2].toLowerCase())
  }
  return out
}

/**
 * Tanımsız global fonksiyon çağrıları: PHP, WordPress çekirdeği ve Elementor'da yok, bu dosyada ya da
 * projenin diğer PHP dosyalarında tanımlanmamış, function_exists() ile de korunmuyor. Yerel modeller
 * get_reading_time() gibi "olması gereken" yardımcıları uydurur; WordPress'te "Call to undefined function".
 */
export function checkUndefinedFunctions(src: string, projectFunctions: Iterable<string> = []): ValidationIssue[] {
  // Yalnızca <?php ... ?> blokları: aradaki HTML / satır içi JS / CSS (content_template, <style>) PHP değildir
  const segs = phpSegments(src)
  let onlyPhp = src.replace(/[^\n]/g, ' ')
  for (const s of segs) onlyPhp = onlyPhp.slice(0, s.offset) + s.code + onlyPhp.slice(s.offset + s.code.length)
  const code = mask(onlyPhp)
  const own = new Set([...definedFunctions(src), ...[...projectFunctions].map((f) => f.toLowerCase())])
  const guarded = new Set([...src.matchAll(/function_exists\s*\(\s*['"]\\?(\w+)['"]/g)].map((m) => m[1].toLowerCase()))
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  // Önünde ->, ::, $, \ ile başlayan ad parçası, "function " ya da "new " olmayan çağrılar
  // Önünde "-" olan ad (linear-gradient(, minmax( içindeki CSS) PHP çağrısı sayılmaz
  for (const m of code.matchAll(/(?<![\w$>:\\-])(\\?)([A-Za-z_]\w*)\s*\(/g)) {
    const name = m[2]
    const lower = name.toLowerCase()
    const before = code.slice(Math.max(0, (m.index ?? 0) - 12), m.index).trimEnd()
    if (/\b(function|new|fn)$/.test(before) || /->$|::$/.test(before)) continue
    if (KEYWORDS.has(lower) || KNOWN.has(lower) || own.has(lower) || guarded.has(lower) || seen.has(lower)) continue
    if (list.extPrefixes.some((p) => lower.startsWith(p))) continue
    seen.add(lower)
    issues.push({
      rule: 'php-undefined-function',
      message: `Tanımsız fonksiyon: ${name}() — PHP'de, WordPress'te ve bu projede yok. Ya dosyada tanımlayın (önekli adla) ya da var olan bir WordPress fonksiyonu kullanın`,
      line: lineAt(src, m.index ?? 0)
    })
  }
  return issues
}
