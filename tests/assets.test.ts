import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { completeAssets } from '@core/pipeline/assets'
import { elementorPlan } from './helpers'

let dir: string
const put = async (rel: string, content: string | Buffer): Promise<void> => {
  await mkdir(dirname(join(dir, rel)), { recursive: true })
  await writeFile(join(dir, rel), content)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'legt-assets-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('completeAssets', () => {
  it('başvurulan görseli kaynaktan kopyalar, yoksa yer tutucu yazar; kalan medyayı temaya paketler', async () => {
    const plan = await elementorPlan()
    await put('sources/img/hero.jpg', 'gercek-jpg')
    await put('sources/wp-content/uploads/2026/05/tanitim.mp4', 'video')
    await put(
      'output/turkuaz-elementor-widgets/widgets/class-hero.php',
      `<?php echo esc_url( get_template_directory_uri() . '/assets/img/hero.jpg' ); echo '<img src="' . esc_url( get_template_directory_uri() . '/assets/img/yok.png' ) . '">'; ?>`
    )
    await put('output/turkuaz/assets/css/theme.css', '.a{background:url(../img/desen.svg)}')
    const r = await completeAssets(dir, plan)
    expect(r.copied).toEqual(['turkuaz/assets/img/hero.jpg'])
    expect(r.placeholders.sort()).toEqual(['turkuaz/assets/img/desen.svg', 'turkuaz/assets/img/yok.png'])
    expect(r.bundled).toEqual(['turkuaz/assets/media/2026/05/tanitim.mp4'])
    expect(await readFile(join(dir, 'output/turkuaz/assets/img/hero.jpg'), 'utf8')).toBe('gercek-jpg')
    expect((await readFile(join(dir, 'output/turkuaz/assets/img/yok.png'))).subarray(1, 4).toString()).toBe('PNG')
    expect(await readFile(join(dir, 'output/turkuaz/assets/img/desen.svg'), 'utf8')).toContain('desen.svg')
    expect(existsSync(join(dir, 'output/turkuaz/assets/media/2026/05/tanitim.mp4'))).toBe(true)
    // İkinci çalıştırma: var olana dokunmaz
    expect(await completeAssets(dir, plan)).toEqual({ copied: [], placeholders: [], bundled: [] })
  })
})
