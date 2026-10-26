import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from 'php-parser'
import type { ValidationIssue } from '../types'
import { checkBracketBalance, lineAt } from './common'

/** <?php ... ?> kod parçaları (offset'leriyle) */
export function phpSegments(src: string): { code: string; offset: number }[] {
  const segs: { code: string; offset: number }[] = []
  const re = /<\?(?:php\b|=)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length
    const end = src.indexOf('?>', start)
    segs.push({ code: src.slice(start, end < 0 ? src.length : end), offset: start })
    if (end < 0) break
    re.lastIndex = end + 2
  }
  return segs
}

/** php yoksa kullanılan hafif kontrol: açılış etiketi + parantez dengesi */
export function checkPhpLight(src: string): ValidationIssue[] {
  if (!/^\s*<\?php\b/.test(src)) return [{ rule: 'php-open-tag', message: 'Dosya <?php ile başlamıyor', line: 1 }]
  const segs = phpSegments(src)
  if (segs.length === 1) return checkBracketBalance(segs[0].code, { hashComments: true }, segs[0].offset, src)
  // PHP blokları arasında HTML olabilir ({ ?> html <?php }); birleşik kontrolde satır numarası anlamsız
  return checkBracketBalance(segs.map((s) => s.code).join('\n'), { hashComments: true }).map(({ line: _l, ...r }) => r)
}

let engine: Engine | null = null

/**
 * php kurulu değilken saf JS PHP ayrıştırıcısı (glayzzle/php-parser, PHP 8 sözdizimi).
 * Parantez dengesinden çok daha fazlasını yakalar: eksik ;, hatalı ifade, kapanmamış string...
 */
export function checkPhpSyntax(src: string): ValidationIssue[] {
  engine ??= new Engine({ parser: { php8: true, suppressErrors: false, extractDoc: false }, ast: { withPositions: false } })
  try {
    engine.parseCode(src, 'file.php')
    return []
  } catch (e) {
    const err = e as Error & { lineNumber?: number }
    const message = err.message.replace(/^Parse Error : /, '').replace(/ on line \d+$/, '')
    return [{ rule: 'php-syntax', message: `PHP sözdizimi hatası: ${message}`, line: err.lineNumber }]
  }
}

let phpBinary = 'php'
let phpAvailable: Promise<boolean> | null = null

/** PATH'te php yoksa portable XAMPP'ın php'si kullanılabilir */
export function setPhpBinary(bin: string): void {
  phpBinary = bin
  phpAvailable = null
}

export function hasPhp(): Promise<boolean> {
  phpAvailable ??= new Promise((res) => execFile(phpBinary, ['-v'], (err) => res(!err)))
  return phpAvailable
}

/** `php -l` (php kuruluysa). Kurulu değilse null döner. */
export async function phpLint(src: string): Promise<ValidationIssue[] | null> {
  if (!(await hasPhp())) return null
  const dir = await mkdtemp(join(tmpdir(), 'legt-lint-'))
  const file = join(dir, 'f.php')
  try {
    await writeFile(file, src)
    return await new Promise((res) => {
      execFile(phpBinary, ['-n', '-l', '-d', 'display_errors=1', file], (err, stdout, stderr) => {
        if (!err) return res([])
        const msg = (stdout + stderr).split('\n').find((l) => /error/i.test(l)) ?? 'php -l başarısız'
        const line = /on line (\d+)/.exec(msg)
        res([{ rule: 'php-lint', message: `php -l: ${msg.replace(file, '').replace(/\s+in\s*$/, '').trim()}`, line: line ? +line[1] : undefined }])
      })
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Global fonksiyon / class / namespace önek kontrolü. Yorum ve string'ler atılır,
 * class/fonksiyon gövdesi içindekiler (metotlar, closure'lar) global sayılmaz.
 */
export function checkPhpPrefix(src: string, prefix: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const Prefix = prefix.charAt(0).toUpperCase() + prefix.slice(1)
  // Yığın ve namespace parçalar arasında korunur: render() içindeki `?> html <?php` geçişinden
  // sonra hâlâ class gövdesindeyiz (aksi halde content_template() global fonksiyon sanılır)
  const stack: ('scope' | 'block')[] = []
  let pending: 'scope' | null = null
  let ns: RegExpExecArray | null = null
  for (const seg of phpSegments(src)) {
    const code = seg.code
      .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
      .replace(/(\/\/|#(?!\[))[^\n]*/g, (s) => ' '.repeat(s.length))
      .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, (s) => s.replace(/[^\n]/g, ' '))
    const segNs = /^\s*namespace\s+([\w\\]+)\s*;/m.exec(code)
    if (segNs) {
      ns = segNs
      if (!ns[1].toLowerCase().startsWith(prefix.toLowerCase())) {
        issues.push({ rule: 'prefix', message: `Namespace önekle başlamıyor: ${ns[1]} (beklenen ${Prefix}\\...)`, line: lineAt(src, seg.offset + ns.index) })
      }
    }
    // Basit yığın: hangi süslü parantez bir class/function gövdesi açıyor?
    const tokenRe = /\b(class|interface|trait|enum|function)\s+(&\s*)?([A-Za-z_]\w*)|\bfunction\s*\(|\bfn\s*\(|[{}]|;/g
    let m: RegExpExecArray | null
    while ((m = tokenRe.exec(code))) {
      const tok = m[0]
      if (tok === '{') {
        stack.push(pending ?? 'block')
        pending = null
      } else if (tok === '}') stack.pop()
      else if (tok === ';') {
        if (pending) pending = null
      } else {
        const inScope = stack.includes('scope')
        if (m[1] && !inScope) {
          const name = m[3]
          const isClass = m[1] !== 'function'
          const ok = isClass
            ? ns !== null || name.toLowerCase().startsWith(prefix.toLowerCase() + '_')
            : name.toLowerCase().startsWith(prefix.toLowerCase() + '_')
          if (!ok) {
            issues.push({
              rule: 'prefix',
              message: isClass
                ? `Önek eksik: global class ${name} (beklenen ${Prefix}_... veya ${Prefix}\\ namespace'i)`
                : `Önek eksik: global fonksiyon ${name}() (beklenen ${prefix}_...)`,
              line: lineAt(src, seg.offset + m.index)
            })
          }
        }
        pending = 'scope'
      }
    }
  }
  return issues
}
