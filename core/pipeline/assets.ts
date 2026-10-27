import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { Plan } from '../types'
import { pluginDir, themeDir } from './layout'

/** 1×1 gri yer tutucular (tarayıcıda doğrulandı); SVG ayrıca dosya adını gösterir */
const RASTER: Record<string, string> = {
  '.png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  '.gif': 'R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
  '.jpg': '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKwAD//Z',
  '.webp': 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA='
}
RASTER['.jpeg'] = RASTER['.jpg']

const REF_RE = /(?:^|['"(\s/])((?:assets\/)?(?:img|images|image|media)\/[\w.@-]+(?:\/[\w.@-]+)*\.(?:svg|png|jpe?g|webp|gif|avif|mp4|webm))\b/gim
const MEDIA_RE = /\.(svg|png|jpe?g|webp|gif|avif|ico|mp4|webm)$/i

function placeholderSvg(name: string): string {
  const label = basename(name).replace(/[<>&"]/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#e5e7eb"/><path d="M330 300l60-70 50 55 30-30 70 85H260z" fill="#c2c7d0"/><circle cx="330" cy="200" r="28" fill="#c2c7d0"/><text x="400" y="440" font-family="system-ui,sans-serif" font-size="22" fill="#6b7280" text-anchor="middle">${label}</text></svg>\n`
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  if (!existsSync(dir)) return out
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else out.push(p)
  }
  return out
}

export interface AssetReport {
  /** Kaynaklardan kopyalanan (hedef yol) */
  copied: string[]
  /** Kaynakta bulunamadığı için yer tutucu yazılan */
  placeholders: string[]
  /** Kodun başvurmadığı ama site klasöründen alınan medya: tema/assets/media altına (demo içe aktarmada Medya Kütüphanesi'ne) */
  bundled: string[]
}

/**
 * Üretilen kodun başvurduğu `assets/img/...` dosyalarını tamamlar: proje kaynaklarında (örnek site
 * klasöründen alınan görseller) aynı adlı dosya varsa kopyalar, yoksa yer tutucu yazar. LLM çağrısı yok;
 * aksi halde tema 404 görsellerle ve kırık düzenle teslim edilir.
 */
export async function completeAssets(projectDir: string, plan: Plan): Promise<AssetReport> {
  const output = join(projectDir, 'output')
  const roots = [themeDir(plan), ...(plan.mode === 'elementor-free' ? [pluginDir(plan)] : [])]
  const sourcesDir = join(projectDir, 'sources')
  // sources/_ref: görsel birebirlik için referans ekran görüntüleri; temaya paketlenmez
  const sources = (await walk(sourcesDir)).filter((f) => MEDIA_RE.test(f) && !/[\\/]_ref[\\/]/.test(f))
  const byName = new Map(sources.map((f) => [basename(f).toLowerCase(), f]))
  const report: AssetReport = { copied: [], placeholders: [], bundled: [] }
  const done = new Set<string>()
  const used = new Set<string>()

  for (const file of await walk(output)) {
    if (!/\.(php|html|css|js|json)$/i.test(file)) continue
    const rel = file.slice(output.length + 1).replace(/\\/g, '/')
    const ownRoot = roots.find((r) => rel.startsWith(r + '/'))
    if (!ownRoot) continue
    const src = await readFile(file, 'utf8')
    for (const m of src.matchAll(REF_RE)) {
      let ref = m[1].replace(/^\/+/, '')
      if (!ref.startsWith('assets/')) ref = `assets/${ref}`
      // CSS'teki göreli yol (../img/x.png) assets/css altından assets/img'e işaret eder: aynı hedef
      // Eklenti dosyası tema URI'siyle başvuruyorsa (get_template_directory_uri) görsel temada aranır
      const line = src.slice(src.lastIndexOf('\n', m.index ?? 0) + 1, src.indexOf('\n', m.index ?? 0))
      const targetRoot = /template_directory|stylesheet_directory|get_theme_file_uri/.test(line) ? themeDir(plan) : ownRoot
      const target = join(output, targetRoot, ref)
      const key = target.toLowerCase()
      if (done.has(key)) continue
      done.add(key)
      const found = byName.get(basename(ref).toLowerCase())
      // Kodun başvurduğu kaynak dosya assets/media'ya ikinci kez paketlenmesin (önceki çalıştırmada kopyalanmış olabilir)
      if (found) used.add(found)
      if (existsSync(target)) continue
      await mkdir(dirname(target), { recursive: true })
      const shown = `${targetRoot}/${ref}`
      if (found) {
        await copyFile(found, target)
        report.copied.push(shown)
        continue
      }
      const ext = extname(ref).toLowerCase()
      if (ext === '.svg') await writeFile(target, placeholderSvg(ref))
      else if (RASTER[ext]) await writeFile(target, Buffer.from(RASTER[ext], 'base64'))
      else continue
      report.placeholders.push(shown)
    }
  }

  // Site klasöründen gelen diğer medya: tema/assets/media/<göreli yol> (WordPress uploads ön eki atılır)
  for (const f of sources) {
    if (used.has(f)) continue
    const rel = f.slice(sourcesDir.length + 1).replace(/\\/g, '/').replace(/^wp-content\/uploads\//i, '')
    const target = join(output, themeDir(plan), 'assets', 'media', rel)
    if (existsSync(target)) continue
    await mkdir(dirname(target), { recursive: true })
    await copyFile(f, target)
    report.bundled.push(`${themeDir(plan)}/assets/media/${rel}`)
  }
  return report
}
