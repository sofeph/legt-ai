import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { safeSourceName, scanSiteFolder } from '@core/html/siteFolder'

let root: string
const put = async (rel: string, content = 'x'): Promise<void> => {
  await mkdir(dirname(join(root, rel)), { recursive: true })
  await writeFile(join(root, rel), content)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'legt-site-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('scanSiteFolder', () => {
  it('çok sayfalı statik site: index önce, alt sayfalar, CSS/JS; kütüphaneler ve gereksiz klasörler atlanır', async () => {
    await put('hakkimizda/index.html', '<h1>Hakkımızda</h1>')
    await put('index.html', '<h1>Ana</h1>')
    await put('iletisim.html', '<h1>İletişim</h1>')
    await put('css/style.css', '.a{color:red}')
    await put('css/bootstrap.min.css', '.b{}')
    await put('js/main.js', 'console.log(1)')
    await put('js/jquery-3.7.1.min.js', '!function(){}')
    await put('js/app.min.js', '!function(){}')
    await put('node_modules/x/index.html', 'x')
    await put('.git/HEAD', 'ref')
    await put('img/logo.png', 'png')
    const scan = await scanSiteFolder(root)
    // Kök index, sonra bölüm ana sayfaları (alt klasör index'leri), sonra diğer sayfalar
    expect(scan.sources.map((s) => `${s.kind}:${s.name}`)).toEqual(['html:index.html', 'html:hakkimizda/index.html', 'html:iletisim.html', 'css:css/style.css', 'js:js/main.js'])
    expect(scan.skipped.join('\n')).toMatch(/bootstrap\.min\.css \(hazır kütüphane\)/)
    expect(scan.skipped.join('\n')).toMatch(/jquery-3\.7\.1\.min\.js/)
    expect(scan.warnings).toEqual([])
  })

  it('WordPress kurulumu: statik HTML yoksa yol gösteren uyarı, PHP okunmaz', async () => {
    await put('wp-config.php', '<?php')
    await put('index.php', '<?php require "wp-blog-header.php";')
    await put('wp-content/themes/x/style.css', '.x{}')
    const scan = await scanSiteFolder(root)
    expect(scan.sources).toEqual([])
    expect(scan.warnings.join('\n')).toMatch(/WordPress kurulumu.*Farklı kaydet/)
  })

  it('düz PHP sitesi: HTML yoksa PHP sayfaları uyarıyla HTML olarak okunur', async () => {
    await put('index.php', '<html><body><h1><?php echo "Merhaba"; ?></h1></body></html>')
    const scan = await scanSiteFolder(root)
    expect(scan.sources.map((s) => `${s.kind}:${s.name}`)).toEqual(['html:index.php'])
    expect(scan.warnings[0]).toMatch(/PHP sayfaları HTML olarak okundu/)
  })

  it('sayfa sınırı ve çok büyük dosya', async () => {
    for (let i = 0; i < 30; i++) await put(`p${String(i).padStart(2, '0')}.html`, `<h1>${i}</h1>`)
    await put('css/buyuk.css', 'a'.repeat(1_600_000))
    const scan = await scanSiteFolder(root)
    expect(scan.sources.filter((s) => s.kind === 'html')).toHaveLength(25)
    expect(scan.skipped.filter((s) => /sayfa sınırı/.test(s))).toHaveLength(5)
    expect(scan.skipped.join('\n')).toMatch(/buyuk\.css \(1600 KB, çok büyük\)/)
  })
})

describe('safeSourceName', () => {
  it('klasör dışına çıkamaz', () => {
    expect(safeSourceName('../../etc/passwd')).toBe('etc/passwd')
    expect(safeSourceName('C:\\x\\..\\y.html')).toBe('x/y.html')
    expect(safeSourceName('blog/index.html')).toBe('blog/index.html')
    expect(safeSourceName('..')).toBe('kaynak.html')
  })
})
