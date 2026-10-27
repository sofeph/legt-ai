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

const GLOBAL_CONSTANTS: Record<string, string[]> = {
  Global_Colors: ['COLOR_PRIMARY', 'COLOR_SECONDARY', 'COLOR_TEXT', 'COLOR_ACCENT'],
  Global_Typography: ['TYPOGRAPHY_PRIMARY', 'TYPOGRAPHY_SECONDARY', 'TYPOGRAPHY_TEXT', 'TYPOGRAPHY_ACCENT']
}

/** Uydurma Global_Colors / Global_Typography sabiti (ör. TYPOGRAPHY_BODY) çalışma anında ölümcül hata verir */
export function checkGlobalConstants(content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  for (const m of content.matchAll(/\b(Global_Colors|Global_Typography)::([A-Z_]+)/g)) {
    const valid = GLOBAL_CONSTANTS[m[1]]
    if (valid.includes(m[2]) || seen.has(m[0])) continue
    seen.add(m[0])
    issues.push({
      rule: 'elementor-api',
      message: `Elementor'da olmayan sabit: ${m[0]} — geçerli olanlar: ${valid.map((v) => `${m[1]}::${v}`).join(', ')}`,
      line: lineAt(content, m.index ?? 0)
    })
  }
  return issues
}

/** Yazı/arşiv/ilgili yazı listesi widget'ı içeriği sorgudan değil gömülü öğelerden basıyorsa hata */
export function checkDynamicQuery(path: string, content: string): ValidationIssue[] {
  if (!/\/class-[\w-]*(post-list|post-grid|post-feed|posts|related|recent|archive-content|category-archive|search-results|blog)[\w-]*\.php$/.test(path)) return []
  if (/\b(WP_Query|get_posts|have_posts|get_terms|wp_get_recent_posts|the_post|get_search_query)\b/.test(content)) return []
  return [
    {
      rule: 'dynamic-content',
      message: "Liste içeriği gömülü (statik): yazıları WP_Query/get_posts, kategorileri get_terms ile WordPress'ten oku; Repeater yalnızca yazı yokken boş durum için olabilir"
    }
  ]
}

/** render() içindeki satır içi HTML ve literal HTML dizgeleri: görünen düz metin koda gömülü kalmamalı */
export function checkStaticText(content: string): ValidationIssue[] {
  const start = content.search(/function\s+render\s*\(/)
  if (start < 0) return []
  const rest = content.slice(start)
  const endRel = rest.slice(10).search(/\n\s*(?:public|protected|private)\s+function\s/)
  const region = endRel < 0 ? rest : rest.slice(0, endRel + 10)
  const letters = /\p{L}{3,}/u
  const visible = (html: string): string =>
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const found: string[] = []
  // 1) ?> ... <?php arası satır içi HTML: PHP blokları (öznitelik içindekiler dahil) çıkarılır, kalan metin düğümleri bakılır
  let html = ''
  let pos = 0
  let inPhp = true
  while (pos < region.length) {
    if (inPhp) {
      const close = region.indexOf('?>', pos)
      if (close < 0) break
      pos = close + 2
      inPhp = false
    } else {
      const open = /<\?(?:php|=)/.exec(region.slice(pos))
      const end = open ? pos + open.index : region.length
      html += region.slice(pos, end) + ' \u0001 '
      pos = open ? end + open[0].length : region.length
      inPhp = true
    }
  }
  const stripped = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  for (const node of stripped.split(/<[^>]*>/)) {
    const text = visible(node.replace(/\u0001/g, ' '))
    if (letters.test(text)) found.push(text.slice(0, 50))
  }
  // 2) echo / print ile basılan literal HTML (değişken, printf yer tutucusu ve çeviri çağrısı içermeyenler)
  for (const m of region.matchAll(/\b(?:echo|print)\s+(['"])((?:\\.|(?!\1)[^\\])*)\1\s*;/g)) {
    if (/[$%{]/.test(m[2])) continue
    const text = visible(m[2])
    if (letters.test(text)) found.push(text.slice(0, 50))
  }
  if (!found.length) return []
  return [
    {
      rule: 'static-content',
      message: `Statik metin koda gömülü: ${found.slice(0, 3).map((t) => JSON.stringify(t)).join(', ')}${found.length > 3 ? ` (+${found.length - 3})` : ''} — her görünen metin Elementor kontrolünden ($settings; varsayılanı kaynak HTML'deki metin) ya da WordPress API'sinden (WP_Query, get_bloginfo, menü...) gelmeli`
    }
  ]
}
