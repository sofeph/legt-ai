import { describe, expect, it } from 'vitest'
import { extractFile, extractFileLenient, parseFileBlocks } from '@core/pipeline/fileBlocks'

describe('FILE işaretçileri', () => {
  it('işaretçi dışındaki metni atar', () => {
    const out = 'Tabii! İşte dosya:\n<<<FILE trk-theme/functions.php>>>\n<?php\necho 1;\n<<<END>>>\nUmarım beğenirsin'
    expect(parseFileBlocks(out)).toEqual([{ path: 'trk-theme/functions.php', content: '<?php\necho 1;' }])
    expect(extractFile(out, 'trk-theme/functions.php')).toBe('<?php\necho 1;\n')
  })
  it('kod bloğu çitlerini soyar', () => {
    const out = '<<<FILE a.css>>>\n```css\n.a{}\n```\n<<<END>>>'
    expect(extractFile(out, 'a.css')).toBe('.a{}\n')
  })
  it('prompt yankısındaki yer tutucu örneği atlar, son geçerli bloğu seçer', () => {
    const echo = 'Çıktı:\n<<<FILE a.php>>>\n(tam içerik)\n<<<END>>>\n'
    expect(extractFile(echo, 'a.php')).toBeNull()
    expect(extractFile(echo + '<<<FILE a.php>>>\n<?php echo 1;\n<<<END>>>', 'a.php')).toBe('<?php echo 1;\n')
  })
  it('END yoksa yarım dosyayı kabul etmez', () => {
    expect(extractFile('<<<FILE a.php>>>\n<?php\nfunction', 'a.php')).toBeNull()
  })
})

describe('extractFileLenient (canlı test onarımı)', () => {
  it('işaretçi varsa katı çıkarım; yarım işaretçi kabul edilmez', () => {
    expect(extractFileLenient('<<<FILE a.php>>>\n<?php x();\n<<<END>>>', 'a.php')).toBe('<?php x();\n')
    expect(extractFileLenient('<<<FILE a.php>>>\n<?php x();', 'a.php')).toBeNull()
  })
  it('tek ve kapalı ``` bloğu kabul edilir, birden fazlası tahmin edilmez', () => {
    expect(extractFileLenient('Düzeltildi:\n```php\n<?php x();\n```\n', 'a.php')).toBe('<?php x();\n')
    expect(extractFileLenient('```php\n<?php a();\n```\n```php\n<?php b();\n```', 'a.php')).toBeNull()
  })
  it('çitsiz yanıt dosya türünün başlangıcıyla başlamalı', () => {
    expect(extractFileLenient('<?php\nwp_footer();\n```', 'footer.php')).toBe('<?php\nwp_footer();\n')
    expect(extractFileLenient('İşte dosya: <?php x();', 'a.php')).toBeNull()
    expect(extractFileLenient('.a{color:red}', 'a.css')).toBeNull()
  })
})
