/**
 * Bağımlı dosyaların imzaları ({{dependencySignatures}}): tam içerik yerine
 * class/fonksiyon adları, kontrol id'leri, CSS sınıfları, preset slug'ları.
 */

const uniq = (xs: string[], max = 60): string[] => [...new Set(xs.filter(Boolean))].slice(0, max)
const all = (src: string, re: RegExp, g = 1): string[] => [...src.matchAll(re)].map((m) => m[g])

function phpSignature(src: string): string[] {
  const lines: string[] = []
  const ns = /^\s*namespace\s+([\w\\]+)\s*;/m.exec(src)?.[1]
  if (ns) lines.push(`namespace: ${ns}`)
  const classes = all(src, /\bclass\s+(\w+)(\s+extends\s+[\w\\]+)?/g, 0).map((s) => s.replace(/\s+/g, ' '))
  if (classes.length) lines.push(`class: ${classes.join('; ')}`)
  const fns = uniq(all(src, /^\s*function\s+(\w+)\s*\(/gm))
  if (fns.length) lines.push(`global fonksiyonlar: ${fns.join(', ')}()`)
  const name = /function\s+get_name\s*\(\s*\)[^{]*\{\s*return\s+['"]([^'"]+)['"]/.exec(src)?.[1]
  if (name) lines.push(`widget adı (get_name): ${name}`)
  const controls = uniq(all(src, /add_(?:responsive_)?control\(\s*['"]([\w-]+)['"]/g), 80)
  if (controls.length) lines.push(`kontrol id'leri: ${controls.join(', ')}`)
  const groups = uniq(all(src, /add_group_control\([\s\S]*?['"]name['"]\s*=>\s*['"]([\w-]+)['"]/g))
  if (groups.length) lines.push(`group control adları: ${groups.join(', ')}`)
  const repeaters = uniq(all(src, /['"]type['"]\s*=>\s*\\?Elementor\\Controls_Manager::REPEATER[\s\S]{0,40}/g, 0)).length
  if (repeaters) lines.push('repeater: var')
  const cssClasses = uniq(
    [...all(src, /class\s*=\s*\\?["']([^"'<]*)/g), ...all(src, /['"]class['"]\s*,\s*['"]([^'"]+)['"]/g), ...all(src, /['"]class['"]\s*=>\s*['"]([^'"]+)['"]/g)]
      .flatMap((c) => c.split(/\s+/))
      .filter((c) => /^[a-z][\w-]*$/.test(c)),
    50
  )
  if (cssClasses.length) lines.push(`HTML sınıfları: ${cssClasses.join(' ')}`)
  const deps = all(src, /get_(style|script)_depends\s*\(\s*\)[^{]*\{\s*return\s*(\[[^\]]*\]|array\([^)]*\))/g, 0)
  if (deps.length) lines.push(...deps.map((d) => d.replace(/\s+/g, ' ')))
  const slug = /^\s*\*\s*Slug:\s*(\S+)/m.exec(src)?.[1]
  if (slug) lines.push(`pattern slug: ${slug}`)
  return lines
}

function cssSignature(src: string): string[] {
  const roots = uniq(all(src.replace(/\/\*[\s\S]*?\*\//g, ''), /\.([a-zA-Z][\w-]*)/g), 60)
  const vars = uniq(all(src, /(--[\w-]+)\s*:/g), 40)
  const lines = []
  if (roots.length) lines.push(`CSS sınıfları: ${roots.map((r) => '.' + r).join(' ')}`)
  if (vars.length) lines.push(`CSS değişkenleri: ${vars.join(' ')}`)
  return lines
}

function jsSignature(src: string): string[] {
  const hooks = uniq(all(src, /frontend\/element_ready\/([\w.-]+)/g))
  const sels = uniq(all(src, /querySelector(?:All)?\(\s*['"`]([^'"`]+)['"`]/g), 30)
  const lines = []
  if (hooks.length) lines.push(`element_ready hook'ları: ${hooks.join(', ')}`)
  if (sels.length) lines.push(`seçiciler: ${sels.join(' | ')}`)
  return lines
}

function themeJsonSignature(src: string): string[] {
  try {
    const j = JSON.parse(src) as {
      settings?: {
        color?: { palette?: { slug: string; color?: string }[] }
        typography?: { fontFamilies?: { slug: string }[]; fontSizes?: { slug: string }[] }
        spacing?: { spacingSizes?: { slug: string }[] }
        shadow?: { presets?: { slug: string }[] }
        layout?: { contentSize?: string; wideSize?: string }
      }
    }
    const s = j.settings ?? {}
    const slugs = (xs?: { slug: string }[]): string => (xs ?? []).map((x) => x.slug).join(', ') || '—'
    return [
      `renk preset'leri: ${slugs(s.color?.palette)}`,
      `font aileleri: ${slugs(s.typography?.fontFamilies)}`,
      `font boyutları: ${slugs(s.typography?.fontSizes)}`,
      `boşluk preset'leri: ${slugs(s.spacing?.spacingSizes)}`,
      `gölge preset'leri: ${slugs(s.shadow?.presets)}`,
      `layout: contentSize ${s.layout?.contentSize ?? '—'}, wideSize ${s.layout?.wideSize ?? '—'}`
    ]
  } catch {
    return ['(theme.json ayrıştırılamadı)']
  }
}

function htmlSignature(src: string): string[] {
  const classNames = uniq(all(src, /"className"\s*:\s*"([^"]+)"/g))
  const patterns = uniq(all(src, /wp:pattern\s+\{"slug":"([^"]+)"/g))
  const lines = []
  if (classNames.length) lines.push(`blok className'leri: ${classNames.join(', ')}`)
  if (patterns.length) lines.push(`pattern'ler: ${patterns.join(', ')}`)
  return lines
}

export function extractSignature(path: string, content: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  let lines: string[] = []
  if (ext === 'php') lines = [...phpSignature(content), ...(/\/patterns\//.test(path) ? htmlSignature(content) : [])]
  else if (ext === 'css') lines = cssSignature(content)
  else if (ext === 'js') lines = jsSignature(content)
  else if (/theme\.json$/.test(path)) lines = themeJsonSignature(content)
  else if (ext === 'html') lines = htmlSignature(content)
  return `### ${path}\n${lines.length ? lines.map((l) => `- ${l}`).join('\n') : '- (imza yok)'}`
}
