import type { ValidationIssue } from '../types'

export function lineAt(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

const FORBIDDEN: [RegExp, string][] = [
  [/\/\/\s*\.\.\./, '// ...'],
  [/\/\*\s*\.\.\.\s*\*\//, '/* ... */'],
  [/diğer kodlar/i, 'diğer kodlar'],
  [/\b_register_controls\b/, '_register_controls'],
  [/\bScheme_Color\b/, 'Scheme_Color'],
  [/\bScheme_Typography\b/, 'Scheme_Typography'],
  [/ElementorPro\\/, 'ElementorPro\\'],
  [/\bTODO\b/, 'TODO']
]

export function checkForbidden(content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [re, label] of FORBIDDEN) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (const m of content.matchAll(g)) {
      issues.push({ rule: 'forbidden', message: `Yasaklı kalıp: ${label}`, line: lineAt(content, m.index ?? 0) })
    }
  }
  return issues
}

/** Yorum ve string'leri atlayarak (), [], {} dengesini kontrol eder (CSS/JS/PHP kod kısmı için) */
export function checkBracketBalance(code: string, opts: { hashComments?: boolean } = {}, baseOffset = 0, full = code): ValidationIssue[] {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const stack: { ch: string; at: number }[] = []
  let i = 0
  while (i < code.length) {
    const c = code[i]
    const n = code[i + 1]
    if (c === '/' && n === '/') {
      while (i < code.length && code[i] !== '\n') i++
      continue
    }
    if (opts.hashComments && c === '#' && n !== '[') {
      while (i < code.length && code[i] !== '\n') i++
      continue
    }
    if (c === '/' && n === '*') {
      const end = code.indexOf('*/', i + 2)
      i = end < 0 ? code.length : end + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      i++
      while (i < code.length && code[i] !== c) i += code[i] === '\\' ? 2 : 1
      i++
      continue
    }
    if (c === '(' || c === '[' || c === '{') stack.push({ ch: c, at: i })
    else if (c in pairs) {
      const top = stack.pop()
      if (!top || top.ch !== pairs[c]) {
        return [{ rule: 'brackets', message: `Beklenmeyen '${c}'`, line: lineAt(full, baseOffset + i) }]
      }
    }
    i++
  }
  if (stack.length) {
    const top = stack[stack.length - 1]
    return [{ rule: 'brackets', message: `Kapanmamış '${top.ch}'`, line: lineAt(full, baseOffset + top.at) }]
  }
  return []
}
