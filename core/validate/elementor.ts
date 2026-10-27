import api from './elementor-widget-api.json'
import type { ValidationIssue } from '../types'
import { lineAt } from './common'

const KNOWN = new Set<string>(api.methods)
const MAGIC = new Set(['__construct', '__get', '__set', '__isset', '__call', '__toString'])

/** Basit düzenleme mesafesi (öneri için; isimler kısa) */
function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[b.length]
}

function suggest(name: string): string | undefined {
  let best: { m: string; s: number } | undefined
  for (const m of KNOWN) {
    // Ön ek eşleşmesi (print_render_attribute → print_render_attribute_string) mesafeden önce gelir
    const s = m.startsWith(name) || name.startsWith(m) ? Math.abs(m.length - name.length) * 0.1 : distance(name, m)
    if (!best || s < best.s) best = { m, s }
  }
  return best && best.s <= Math.max(3, name.length / 3) ? best.m : undefined
}

/**
 * Widget sınıfında `$this->x()` / `parent::x()` çağrıları ya dosyada tanımlı ya da Elementor
 * Widget_Base hiyerarşisinde var olmalı. Yerel modeller API uydurur; uydurulan metot WordPress'te
 * "Call to undefined method" ölümcül hatası verir ve sayfadaki bütün widget'ları düşürür.
 */
export function checkElementorApi(src: string): ValidationIssue[] {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/(\/\/|#(?!\[))[^\n]*/g, (s) => ' '.repeat(s.length))
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, (s) => s.replace(/[^\n]/g, ' '))
  // Bu dosyada tanımlı metotlar (trait/yardımcı metotlar dahil)
  const own = new Set([...code.matchAll(/function\s+&?\s*(\w+)\s*\(/g)].map((m) => m[1]))
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  for (const m of code.matchAll(/(?:\$this->|parent::)(\w+)\s*\(/g)) {
    const name = m[1]
    if (own.has(name) || KNOWN.has(name) || MAGIC.has(name) || seen.has(name)) continue
    seen.add(name)
    const hint = suggest(name)
    issues.push({
      rule: 'elementor-api',
      message: `Elementor'da olmayan metot: ${m[0].replace(/\s*\($/, '')}()${hint ? ` — doğrusu muhtemelen $this->${hint}()` : ''} (Elementor ${api.elementor} Widget_Base)`,
      line: lineAt(src, m.index ?? 0)
    })
  }
  return issues
}

/** Header/navbar/footer widget'ı menüyü yalnızca Repeater'dan basıyorsa: menü WordPress'ten yönetilmeli */
export function checkDynamicMenu(path: string, content: string): ValidationIssue[] {
  if (!/\/class-(?:[\w-]*-)?(header|navbar|nav|menu|footer)(?:-\d+)?\.php$/.test(path)) return []
  if (!/Controls_Manager::REPEATER/.test(content) || /_render_menu\s*\(/.test(content)) return []
  return [
    {
      rule: 'dynamic-menu',
      message:
        "Menü Repeater'a gömülmüş, WordPress menüsü kullanılmıyor: 'menu' SELECT kontrolü ('options' => <önek>_menu_options()) ekle ve render()'da <önek>_render_menu( $settings['menu'], 'primary' | 'footer', '<önek>-menu' ) çağır; false dönerse Repeater yedeğini bas"
    }
  ]
}
