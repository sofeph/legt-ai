import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pascalPrefix, renderTemplate, stripAuthorComments, UnfilledPlaceholderError, widgetClassName } from '@core/prompts/render'

// docs/MIMARI.md'de belgelenen yer tutucular
const DOCUMENTED = 'name slug prefix Prefix textdomain language path fileKind tokens section sectionHtml dependencySignatures widgetName WidgetClass tabletBp mobileBp classRule requests sections errors content attempt'.split(' ')
const allVars = Object.fromEntries(DOCUMENTED.map((k) => [k, `<${k}>`]))

describe('renderTemplate', () => {
  it('string ve nesneleri doldurur', () => {
    expect(renderTemplate('a {{x}} b {{ y }}', { x: '1', y: { k: 2 } })).toBe('a 1 b {\n  "k": 2\n}')
  })
  it('doldurulmamış yer tutucuda hata fırlatır', () => {
    expect(() => renderTemplate('{{a}} {{b}}', { a: 'x' })).toThrow(UnfilledPlaceholderError)
  })
  it('yazar yorumlarını atar', () => {
    expect(stripAuthorComments('a <!-- not {{x}} --> b')).toBe('a  b')
  })
})

describe('prompts/', () => {
  for (const mode of ['block-theme', 'elementor-free']) {
    for (const name of ['system', 'analyze', 'file', 'repair']) {
      it(`${mode}/${name}.md yalnızca belgelenmiş yer tutucuları kullanır`, () => {
        const md = stripAuthorComments(readFileSync(join(__dirname, '..', 'prompts', mode, `${name}.md`), 'utf8'))
        expect(() => renderTemplate(md, allVars)).not.toThrow()
      })
    }
  }
})

describe('isimlendirme', () => {
  it('önek ve widget class adı', () => {
    expect(pascalPrefix('trk')).toBe('Trk')
    expect(pascalPrefix('my_shop')).toBe('My_Shop')
    expect(widgetClassName('trk-hero-slider', 'trk')).toBe('Hero_Slider')
  })
})
