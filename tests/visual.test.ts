import { describe, expect, it } from 'vitest'
import { compare, colorSimilarity, MAX_SCORE, PASS_SCORE, pixelSimilarity, ramp, verdict, type VNode, type VPrint } from '@core/visual/score'

const node = (k: string, over: Partial<VNode> = {}): VNode => ({
  k,
  tag: 'h2',
  x: 0,
  y: 0,
  w: 400,
  h: 40,
  fs: 32,
  fw: 700,
  lh: 40,
  ls: 0,
  color: 'rgb(17, 17, 17)',
  bg: 'rgba(0, 0, 0, 0)',
  radius: 0,
  align: 'left',
  tt: 'none',
  path: 'div:nth-of-type(1) > h2:nth-of-type(1)',
  ...over
})

const print = (items: VNode[], over: Partial<VPrint> = {}): VPrint => ({ w: 1200, h: 400, bg: 'rgb(255, 255, 255)', items, ...over })

describe('görsel puan', () => {
  it('aynı sayfa tam puan alır', () => {
    const p = print([node('Merhaba'), node('Devam', { tag: 'a', y: 60, path: 'a:nth-of-type(1)' })])
    const c = compare(p, p, 1)
    expect(c.score.total).toBe(MAX_SCORE)
    expect(c.diffs).toEqual([])
    expect(verdict(c.score.total)).toBe('pass')
  })

  it('tipografi ve renk farkını ölçer, düzeltme farklarını üretir', () => {
    const src = print([node('Merhaba')])
    const gen = print([node('Merhaba', { fs: 20, color: 'rgb(200, 30, 30)' })])
    const c = compare(src, gen, 1)
    expect(c.score.total).toBeLessThan(MAX_SCORE)
    expect(c.diffs.map((d) => d.prop).sort()).toEqual(['color', 'font-size'])
    expect(c.diffs.find((d) => d.prop === 'font-size')).toMatchObject({ want: '32px', have: '20px' })
  })

  it('eksik içerik ve bambaşka yerleşim 750 eşiğinin altına düşer', () => {
    const src = print([node('A'), node('B', { y: 50 }), node('C', { y: 100 }), node('D', { y: 150 })])
    const gen = print([node('Z', { x: 600, y: 900, w: 100, h: 300 })], { h: 1600 })
    const c = compare(src, gen, 0.1)
    expect(c.score.total).toBeLessThan(PASS_SCORE)
    expect(verdict(c.score.total)).toBe('fail')
    expect(c.missing).toHaveLength(4)
  })

  it('piksel verisi yoksa kalan bileşenler 1500’e ölçeklenir', () => {
    const p = print([node('Merhaba')])
    expect(compare(p, p, null).score.total).toBe(MAX_SCORE)
  })

  it('yardımcılar', () => {
    expect(ramp(2, 4, 100)).toBe(1)
    expect(ramp(52, 4, 100)).toBeCloseTo(0.5, 1)
    expect(colorSimilarity('rgb(0, 0, 0)', 'rgb(0, 0, 0)')).toBe(1)
    expect(colorSimilarity('rgb(0, 0, 0)', 'rgba(0, 0, 0, 0)')).toBe(0)
    expect(pixelSimilarity(0)).toBe(1)
    expect(pixelSimilarity(0.25)).toBe(0)
  })
})

describe('görsel düzeltme bloğu ve ekran görüntüsü girişi', () => {
  it('kuralları birleştirir, bloğu yazar ve eskisini değiştirir', async () => {
    const { applyBlock, mergeRules, renderBlock } = await import('@core/wptest/visual')
    const vps = { desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 1100 }, mobile: { width: 414, height: 844 } }
    const rules = mergeRules([{ vp: 'desktop', sel: '.w h2', prop: 'font-size', val: '30px' }], [{ vp: 'desktop', sel: '.w h2', prop: 'font-size', val: '40px' }, { vp: 'mobile', sel: '.w h2', prop: 'font-size', val: '24px' }])
    expect(rules).toHaveLength(2)
    const block = renderBlock(rules, vps)
    expect(block).toContain('.w h2 { font-size: 40px !important; }')
    expect(block).toContain('@media (max-width: 414px)')
    const once = applyBlock('a{color:red}', block)
    const twice = applyBlock(once, renderBlock([{ vp: 'desktop', sel: '.w p', prop: 'color', val: 'red' }], vps))
    expect(twice.match(/legt:visual:start/g)).toHaveLength(1)
    expect(twice).toContain('.w p { color: red !important; }')
    expect(twice).not.toContain('font-size: 40px')
    expect(applyBlock(twice, '')).not.toContain('legt:visual')
  })

  it('ekran görüntüsünden gelen HTML’de görseller yer tutucu SVG olur', async () => {
    const { localizeImages } = await import('@core/pipeline/fromScreenshot')
    const r = localizeImages('<html><body><img src="https://x/a.jpg" width="640" height="360"><img src="b.png"><img src="https://x/a.jpg"></body></html>')
    expect(r.media.map((m) => m.name)).toEqual(['img/gorsel-1.svg', 'img/gorsel-2.svg'])
    expect(r.html).toContain('src="img/gorsel-1.svg"')
    expect(Buffer.from(r.media[0].content, 'base64').toString()).toContain('width="640" height="360"')
  })

  it('görsel model adlarını tanır', async () => {
    const { isVisionName, imageMime } = await import('@core/llm/vision')
    expect(['qwen2.5vl:7b', 'llava:13b', 'llama3.2-vision:11b', 'gemma3:4b'].every(isVisionName)).toBe(true)
    expect(isVisionName('qwen2.5-coder:7b')).toBe(false)
    expect(imageMime('/9j/4AAQ')).toBe('image/jpeg')
    expect(imageMime('iVBORw0')).toBe('image/png')
  })
})
