import { createServer } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { captureUrl } from '@core/html/siteUrl'
import { openBrowser } from '@core/wptest/browser'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64')

it('site adresinden kaynak toplar', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/style.css') {
      res.setHeader('content-type', 'text/css')
      res.end('body{margin:0;font-family:Arial} .hero{background:url(img/bg.png);padding:40px;color:#123456} h1{font-size:40px}')
    } else if (req.url === '/img/bg.png' || req.url === '/logo.png') {
      res.setHeader('content-type', 'image/png')
      res.end(PNG)
    } else {
      res.setHeader('content-type', 'text/html')
      res.end('<!doctype html><html><head><meta charset="utf-8"><title>Deneme</title><link rel="stylesheet" href="/style.css"><script>document.title="JS"</script></head><body><section class="hero"><h1>Merhaba dünya</h1><img src="/logo.png" alt="logo"></section></body></html>')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  // Tarayıcı yoksa (CI) test atlanır
  const browser = await openBrowser(join(__dirname, '..', 'runtime', 'browsers'), () => undefined).catch(() => null)
  if (!browser) {
    server.close()
    return
  }
  try {
    const scan = await captureUrl(browser, `http://127.0.0.1:${port}/`, () => undefined)
    const html = scan.sources.find((s) => s.kind === 'html')!.content
    expect(html).not.toContain('<script')
    expect(html).not.toContain('animation:none')
    expect(html).toContain('Merhaba dünya')
    expect(html).toMatch(/href="css\/style\.css"/)
    expect(html).toMatch(/src="img\/logo\.png"/)
    const css = scan.sources.find((s) => s.kind === 'css')!
    expect(css.name).toBe('css/style.css')
    expect(css.content).toContain('url("../img/bg.png")')
    expect(scan.sources.filter((s) => s.name.startsWith('_ref/')).map((s) => s.name).sort()).toEqual(['_ref/desktop.png', '_ref/mobile.png', '_ref/tablet.png'])
    expect(scan.sources.some((s) => s.name === 'img/logo.png')).toBe(true)
  } finally {
    await browser.close()
    server.close()
  }
}, 120000)
