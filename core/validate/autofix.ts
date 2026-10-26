/**
 * LLM çıktısındaki bilinen, anlamı belli hataları kodla düzeltir. Onarım için LLM çağrısı
 * harcanmaz (yerel modelde dakikalar, ücretli serviste para). Yalnızca güvenli dönüşümler:
 * davranışı değiştirmez, dosyanın geri kalanına dokunmaz.
 */
export interface AutoFixResult {
  content: string
  fixes: string[]
}

/** PHP: namespace (ve declare) dosyanın ilk ifadesi olmalı; model ABSPATH kontrolünü öne koyuyor */
function hoistNamespace(src: string): { content: string; fixed: boolean } {
  const open = /^\s*<\?php\b/.exec(src)
  if (!open) return { content: src, fixed: false }
  const nsRe = /^[ \t]*namespace\s+[\w\\]+\s*;[ \t]*\r?\n?/m
  const ns = nsRe.exec(src)
  if (!ns) return { content: src, fixed: false }
  const before = src.slice(open[0].length, ns.index)
  // Önünde yalnızca yorum / boşluk / declare varsa zaten doğru
  const stripped = before
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(\/\/|#)[^\n]*/g, '')
    .replace(/declare\s*\([^)]*\)\s*;/g, '')
    .trim()
  if (!stripped) return { content: src, fixed: false }
  // Bloklu namespace ("namespace X { }") ya da birden fazla namespace: dokunma
  if (/namespace\s+[\w\\]*\s*\{/.test(src) || (src.match(/^[ \t]*namespace\s+/gm) ?? []).length > 1) return { content: src, fixed: false }
  const declares = before.match(/declare\s*\([^)]*\)\s*;/g) ?? []
  const rest = (before.replace(/declare\s*\([^)]*\)\s*;\s*/g, '') + src.slice(ns.index + ns[0].length)).replace(/^\s*\n/, '')
  const head = [open[0].trimStart(), ...declares, ns[0].trim()].join('\n')
  return { content: `${head}\n\n${rest.replace(/^\n+/, '')}`, fixed: true }
}

/**
 * Yerel modellerin sık uydurduğu Elementor metotları → aynı işi yapan gerçek metot. Yalnızca imzası ve
 * anlamı birebir aynı olanlar; emin olunmayanlar doğrulamada "elementor-api" hatası olarak LLM'e gider.
 */
const ELEMENTOR_ALIASES: Record<string, string> = {
  print_render_attribute: 'print_render_attribute_string',
  print_render_attributes: 'print_render_attribute_string',
  get_render_attributes_string: 'get_render_attribute_string',
  get_settings_display: 'get_settings_for_display',
  get_display_settings: 'get_settings_for_display'
}

const PHP_GLOBALS = new Set(['Exception', 'Throwable', 'Error', 'TypeError', 'ErrorException', 'InvalidArgumentException', 'RuntimeException', 'LogicException', 'JsonException', 'DateTime', 'DateTimeImmutable', 'DateTimeZone', 'DateInterval', 'ArrayObject', 'ArrayIterator', 'stdClass', 'Closure', 'Generator', 'Traversable', 'Countable', 'DOMDocument', 'SimpleXMLElement'])
const ELEMENTOR_CLASSES: Record<string, string> = {
  Widget_Base: 'Elementor',
  Controls_Manager: 'Elementor',
  Repeater: 'Elementor',
  Utils: 'Elementor',
  Icons_Manager: 'Elementor',
  Plugin: 'Elementor',
  Embed: 'Elementor',
  Group_Control_Typography: 'Elementor',
  Group_Control_Background: 'Elementor',
  Group_Control_Border: 'Elementor',
  Group_Control_Box_Shadow: 'Elementor',
  Group_Control_Text_Shadow: 'Elementor',
  Group_Control_Image_Size: 'Elementor',
  Group_Control_Css_Filter: 'Elementor',
  Global_Colors: 'Elementor\\Core\\Kits\\Documents\\Tabs',
  Global_Typography: 'Elementor\\Core\\Kits\\Documents\\Tabs'
}

/**
 * Namespace'li dosyada `new WP_Query`, `Controls_Manager::TEXT` gibi niteliksiz sınıf adları
 * `Ut\Widgets\WP_Query` diye aranır ve ölümcül hata verir. use ile alınmamış, dosyada tanımlanmamış
 * bilinen global (WP_*, PHP) ve Elementor sınıfları tam adla yazılır.
 */
function qualifyClasses(src: string): { content: string; names: string[] } {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/(\/\/|#(?!\[))[^\n]*/g, (s) => ' '.repeat(s.length))
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, (s) => s.replace(/[^\n]/g, ' '))
  if (!/^\s*namespace\s+[\w\\]+\s*;/m.test(code)) return { content: src, names: [] }
  const imported = new Set<string>()
  for (const m of code.matchAll(/^\s*use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm)) imported.add(m[2] ?? m[1].split('\\').pop()!)
  const declared = new Set([...code.matchAll(/\b(?:class|interface|trait|enum)\s+(\w+)/g)].map((m) => m[1]))
  const target = (name: string): string | undefined => {
    if (imported.has(name) || declared.has(name)) return undefined
    if (/^WP_\w+$/.test(name) || PHP_GLOBALS.has(name)) return `\\${name}`
    const ns = ELEMENTOR_CLASSES[name]
    return ns ? `\\${ns}\\${name}` : undefined
  }
  const edits: { at: number; len: number; text: string }[] = []
  // new X(, instanceof X, X::, catch (X $e), extends X, tip ipuçları (X $var)
  const re = /(?<![\\\w$>])(\b(?:new|instanceof|extends|implements)\s+|\bcatch\s*\(\s*|[(,]\s*)?([A-Z]\w*)(?=\s*(?:::|\(|\s+\$|\s*\{|\s*[,)]))/g
  for (const m of code.matchAll(re)) {
    const name = m[2]
    const isRef = m[1] !== undefined || code.slice((m.index ?? 0) + m[0].length).trimStart().startsWith('::')
    if (!isRef || ['self', 'static', 'parent'].includes(name)) continue
    // Fonksiyon çağrısı değil (Foo( ) yalnızca new/instanceof sonrasında sınıf sayılır)
    const after = code.slice((m.index ?? 0) + m[0].length).trimStart()
    if (after.startsWith('(') && !/new\s+$/.test(m[1] ?? '')) continue
    const full = target(name)
    if (full) edits.push({ at: (m.index ?? 0) + (m[1]?.length ?? 0), len: name.length, text: full })
  }
  if (!edits.length) return { content: src, names: [] }
  let out = src
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len)
  return { content: out, names: [...new Set(edits.map((e) => e.text))] }
}

export function autoFix(path: string, content: string): AutoFixResult {
  const fixes: string[] = []
  let out = content
  if (out.charCodeAt(0) === 0xfeff) {
    // BOM, <?php'den önce çıktı sayılır: "headers already sent" ve namespace hatası
    out = out.slice(1)
    fixes.push('UTF-8 BOM kaldırıldı')
  }
  if (/\.php$/i.test(path)) {
    if (/^\s+<\?php/.test(out)) {
      out = out.replace(/^\s+/, '')
      fixes.push('<?php öncesindeki boşluk kaldırıldı')
    }
    const ns = hoistNamespace(out)
    if (ns.fixed) {
      out = ns.content
      fixes.push('namespace satırı dosyanın başına alındı')
    }
    const q = qualifyClasses(out)
    if (q.names.length) {
      out = q.content
      fixes.push(`namespace içinde tam sınıf adı: ${q.names.join(', ')}`)
    }
    if (/-elementor-widgets\/widgets\//.test(path.replace(/\\/g, '/'))) {
      for (const [wrong, right] of Object.entries(ELEMENTOR_ALIASES)) {
        const re = new RegExp(`(\\$this->)${wrong}(\\s*\\()`, 'g')
        // Sınıf bu adla kendi metodunu tanımladıysa uydurma değildir
        if (re.test(out) && !new RegExp(`function\\s+${wrong}\\s*\\(`).test(out)) {
          out = out.replace(re, `$1${right}$2`)
          fixes.push(`$this->${wrong}() → $this->${right}()`)
        }
      }
    }
  }
  return { content: out, fixes }
}
