import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { FolderScan, IntakeSource } from '../types'

export type { FolderScan } from '../types'

export const FOLDER_LIMITS = { htmlFiles: 25, assetFiles: 40, fileBytes: 1_500_000, totalBytes: 8_000_000, depth: 6 } as const

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.idea', '.vscode', 'cgi-bin', 'vendor', 'bower_components', '.well-known', 'wp-admin', 'wp-includes', 'wp-content', 'cache', 'tmp', 'logs', 'error_log'])
// Hazır kütüphaneler tasarım token'ı taşımaz, LLM bağlamını doldurur
const VENDOR_RE = /(^|[/._-])(jquery|bootstrap|font-?awesome|fontawesome|swiper|slick|owl\.carousel|owl|aos|animate|gsap|lodash|popper|modernizr|lightbox|fancybox|magnific|isotope|masonry|wow|three|chart|moment|select2|datatables|tailwind)([._-]|$)/i
const EXT_KIND: Record<string, IntakeSource['kind']> = { '.html': 'html', '.htm': 'html', '.css': 'css', '.js': 'js', '.mjs': 'js' }

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

/** index.html önce, sonra sığdan derine, sonra ada göre */
function htmlOrder(a: string, b: string): number {
  const rank = (p: string): number => (/^index\.html?$/i.test(p) ? 0 : /(^|\/)index\.html?$/i.test(p) ? 1 : 2)
  return rank(a) - rank(b) || a.split('/').length - b.split('/').length || a.localeCompare(b)
}

/**
 * Site klasörünü tarar: HTML/CSS/JS (çok sayfalı siteler için alt klasörler dahil).
 * Yalnızca okur; isimler kök klasöre göre göreli yol (ör. "hakkimizda/index.html").
 */
export async function scanSiteFolder(root: string): Promise<FolderScan> {
  const found: { rel: string; kind: IntakeSource['kind']; size: number }[] = []
  const php: string[] = []
  const skipped: string[] = []
  const warnings: string[] = []

  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      const rel = relative(root, full).replace(/\\/g, '/')
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase()) || e.name.startsWith('.')) continue
        if (depth >= FOLDER_LIMITS.depth) {
          skipped.push(`${rel}/ (çok derin)`)
          continue
        }
        await walk(full, depth + 1)
        continue
      }
      if (!e.isFile()) continue
      const ext = extOf(e.name)
      if (ext === '.php') {
        php.push(rel)
        continue
      }
      const kind = EXT_KIND[ext]
      if (!kind) continue
      if (kind !== 'html' && (VENDOR_RE.test(e.name) || /\.min\.js$/i.test(e.name))) {
        skipped.push(`${rel} (hazır kütüphane)`)
        continue
      }
      const size = (await stat(full)).size
      if (size > FOLDER_LIMITS.fileBytes) {
        skipped.push(`${rel} (${Math.round(size / 1000)} KB, çok büyük)`)
        continue
      }
      found.push({ rel, kind, size })
    }
  }
  await walk(root, 0)

  const wordpress = existsSync(join(root, 'wp-config.php')) || existsSync(join(root, 'wp-content'))
  let htmls = found.filter((f) => f.kind === 'html').sort((a, b) => htmlOrder(a.rel, b.rel))
  if (!htmls.length && php.length && !wordpress) {
    // Statik HTML yoksa düz PHP sayfaları HTML olarak okunur (PHP kodu ön analizde metin gibi kalır)
    warnings.push('Klasörde .html yok; PHP sayfaları HTML olarak okundu. En iyi sonuç için sitenin tarayıcıda "Farklı kaydet" ile alınmış HTML\'ini kullanın.')
    htmls = php.sort(htmlOrder).map((rel) => ({ rel, kind: 'html' as const, size: 0 }))
  }
  if (wordpress) {
    warnings.push(
      htmls.length
        ? 'Bu klasör bir WordPress kurulumu içeriyor; WordPress dosyaları atlandı, yalnızca statik HTML/CSS/JS alındı.'
        : 'Bu klasör bir WordPress kurulumu (PHP); örnek alınacak statik HTML yok. Sitenin sayfalarını tarayıcıda "Farklı kaydet > Web sayfası, tamamı" ile kaydedip o klasörü seçin.'
    )
  }
  if (htmls.length > FOLDER_LIMITS.htmlFiles) {
    for (const f of htmls.slice(FOLDER_LIMITS.htmlFiles)) skipped.push(`${f.rel} (sayfa sınırı ${FOLDER_LIMITS.htmlFiles})`)
    htmls = htmls.slice(0, FOLDER_LIMITS.htmlFiles)
  }
  let assets = found.filter((f) => f.kind !== 'html').sort((a, b) => a.rel.localeCompare(b.rel))
  if (assets.length > FOLDER_LIMITS.assetFiles) {
    for (const f of assets.slice(FOLDER_LIMITS.assetFiles)) skipped.push(`${f.rel} (dosya sınırı ${FOLDER_LIMITS.assetFiles})`)
    assets = assets.slice(0, FOLDER_LIMITS.assetFiles)
  }

  const sources: IntakeSource[] = []
  let total = 0
  for (const f of [...htmls, ...assets]) {
    const content = await readFile(join(root, f.rel), 'utf8')
    if (total + content.length > FOLDER_LIMITS.totalBytes) {
      skipped.push(`${f.rel} (toplam boyut sınırı)`)
      continue
    }
    total += content.length
    sources.push({ name: f.rel, kind: f.kind, content })
  }
  if (!sources.some((s) => s.kind === 'html') && !wordpress) warnings.push('Seçilen klasörde HTML sayfası bulunamadı.')
  return { root, sources, skipped, warnings }
}

/** Proje klasörüne yazarken göreli yol: ../ ve sürücü harfi atılır */
export function safeSourceName(name: string): string {
  return (
    name
      .replace(/\\/g, '/')
      .split('/')
      .filter((p) => p && p !== '.' && p !== '..' && !/^[a-z]:$/i.test(p))
      .join('/') || 'kaynak.html'
  )
}
