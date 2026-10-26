import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plan } from '../types'
import { pluginDir, themeDir } from './layout'

export interface PackageResult {
  zips: string[]
  missing: string[]
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** Klasörü, zip içinde `rootName/` altında olacak şekilde sıkıştırır (WordPress yükleyicisinin beklediği yapı) */
export async function zipDir(srcDir: string, destZip: string, rootName: string): Promise<void> {
  const { ZipArchive } = await import('archiver')
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destZip)
    const zip = new ZipArchive({ zlib: { level: 9 } })
    out.on('close', () => resolve())
    out.on('error', reject)
    zip.on('error', reject)
    zip.on('warning', (e: Error) => reject(e))
    zip.pipe(out)
    zip.directory(srcDir, rootName)
    void zip.finalize()
  })
}

/**
 * ADIM 7: tema ve eklenti AYRI zip.
 *   {slug}-theme.zip              → {slug}/
 *   {slug}-elementor-widgets.zip  → {slug}-elementor-widgets/
 */
export async function packageProject(outputDir: string, plan: Plan, destDir: string): Promise<PackageResult> {
  await mkdir(destDir, { recursive: true })
  const targets: [string, string][] = [[themeDir(plan), `${plan.theme.slug}-theme.zip`]]
  if (plan.mode === 'elementor-free') targets.push([pluginDir(plan), `${plan.theme.slug}-elementor-widgets.zip`])

  const result: PackageResult = { zips: [], missing: [] }
  for (const [dir, zipName] of targets) {
    const src = join(outputDir, dir)
    if (!(await exists(src))) {
      result.missing.push(dir)
      continue
    }
    const dest = join(destDir, zipName)
    await zipDir(src, dest, dir)
    result.zips.push(dest)
  }
  return result
}

/** output/ altındaki tüm dosyalar (göreli yol → içerik), kalite kontrolü için */
export async function readOutputTree(outputDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(join(dir, e.name), r)
      else if (/\.(php|css|js|json|html|md|txt)$/i.test(e.name)) files.set(r, await readFile(join(dir, e.name), 'utf8'))
    }
  }
  await walk(outputDir, '')
  return files
}
