import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generate } from '@core/pipeline/generate'
import { ProjectStore } from '@core/project/store'
import { loadPrompt, selectKindRules } from '@core/prompts/render'
import { autoFix } from '@core/validate/autofix'
import { checkElementorApi } from '@core/validate/elementor'
import { checkUndefinedFunctions, definedFunctions, maskPhp } from '@core/validate/functions'
import { checkNamespaceFirst } from '@core/validate/php'
import { validateFile } from '@core/validate'
import { elementorPlan, fakeProvider, intake, pre, promptsDir, scaffoldDir, validContent } from './helpers'

const BAD = `<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

namespace Trk\\Widgets;

use Elementor\\Widget_Base;

class Widget_Hero extends Widget_Base {}
`

describe('autoFix', () => {
  it('ABSPATH kontrolünü namespace\'in önünden alır, gerisine dokunmaz', () => {
    const { content, fixes } = autoFix('w/class-hero.php', BAD)
    expect(fixes).toEqual(['namespace satırı dosyanın başına alındı'])
    expect(content.startsWith('<?php\nnamespace Trk\\Widgets;\n\nif ( ! defined')).toBe(true)
    expect(content).toContain("use Elementor\\Widget_Base;\n\nclass Widget_Hero")
    expect(checkNamespaceFirst(content)).toEqual([])
  })

  it('zaten doğruysa, declare varsa ya da bloklu namespace ise dokunmaz', () => {
    const ok = `<?php\n/** doc */\ndeclare(strict_types=1);\nnamespace A;\nif (!defined('ABSPATH')) exit;\n`
    expect(autoFix('a.php', ok)).toEqual({ content: ok, fixes: [] })
    const block = `<?php\necho 1;\nnamespace A { }\n`
    expect(autoFix('a.php', block).fixes).toEqual([])
  })

  it('BOM ve <?php öncesi boşluk', () => {
    const r = autoFix('a.php', '﻿\n  <?php echo 1;')
    expect(r.content).toBe('<?php echo 1;')
    expect(r.fixes).toEqual(['UTF-8 BOM kaldırıldı', '<?php öncesindeki boşluk kaldırıldı'])
    expect(autoFix('a.css', '﻿.a{}').content).toBe('.a{}')
  })
})

describe('Elementor API kontrolü', () => {
  const W = 'trk-elementor-widgets/widgets/class-x.php'
  const widget = (body: string): string => `<?php
namespace Trk\\Widgets;
if ( ! defined( 'ABSPATH' ) ) exit;
class Widget_X extends \\Elementor\\Widget_Base {
	public function get_name() { return 'trk-x'; }
	private function helper() { return 1; }
	protected function render() {
		$s = $this->get_settings_for_display();
		$this->add_render_attribute( 'w', 'class', 'trk-x' );
		$this->helper();
		// $this->yorumdaki_metot() sayılmaz
		${body}
	}
}
`
  it('gerçek ve dosyada tanımlı metotlar geçer; uydurma metot önerisiyle yakalanır', () => {
    expect(checkElementorApi(widget("echo 'x';"))).toEqual([])
    const issues = checkElementorApi(widget('$this->get_post_categories();'))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ rule: 'elementor-api', line: 12 })
    expect(issues[0].message).toMatch(/get_post_categories/)
  })

  it('kesin eşleşmesi olan uydurma kodla düzeltilir, doğrulamadan geçer', async () => {
    const bad = widget("echo '<div ' . $this->print_render_attribute( 'w' ) . '>';")
    expect(checkElementorApi(bad)[0].message).toMatch(/doğrusu muhtemelen \$this->print_render_attribute_string\(\)/)
    const { content, fixes } = autoFix(W, bad)
    expect(fixes).toEqual(['$this->print_render_attribute() → $this->print_render_attribute_string()'])
    expect(checkElementorApi(content)).toEqual([])
    const issues = await validateFile(W, content, { mode: 'elementor-free', slug: 'turkuaz', prefix: 'trk', usePhpLint: false })
    expect(issues.filter((i) => i.rule === 'elementor-api')).toEqual([])
    // Widget dışındaki dosyalara ve kendi tanımladığı aynı adlı metoda dokunulmaz
    expect(autoFix('turkuaz/functions.php', bad).fixes).toEqual([])
    expect(autoFix(W, bad.replace('private function helper()', 'private function print_render_attribute()')).fixes).toEqual([])
  })
})

describe('namespace içinde niteliksiz sınıflar', () => {
  it('WP_*, PHP ve use edilmemiş Elementor sınıflarını tam adla yazar; use edilenlere ve dizgelere dokunmaz', () => {
    const src = `<?php
namespace Ut\\Widgets;

use Elementor\\Repeater;

class Widget_Grid extends \\Elementor\\Widget_Base {
	protected function register_controls() {
		$r = new Repeater();
		$this->add_control( 'n', [ 'type' => Controls_Manager::NUMBER, 'label' => 'new WP_Query yazısı' ] );
		$this->add_group_control( Group_Control_Typography::get_type(), [ 'global' => [ 'default' => Global_Typography::TYPOGRAPHY_PRIMARY ] ] );
	}
	protected function render() {
		$q = new WP_Query( [ 'posts_per_page' => 3 ] );
		if ( $q instanceof WP_Query ) {}
		try { $d = new DateTime(); } catch ( Exception $e ) {}
		$x = new Local_Helper();
	}
}
`
    const { content, fixes } = autoFix('ut-elementor-widgets/widgets/class-grid.php', src)
    expect(content).toContain('new \\WP_Query( [')
    expect(content).toContain('instanceof \\WP_Query')
    expect(content).toContain("'type' => \\Elementor\\Controls_Manager::NUMBER")
    expect(content).toContain('\\Elementor\\Group_Control_Typography::get_type()')
    expect(content).toContain('\\Elementor\\Core\\Kits\\Documents\\Tabs\\Global_Typography::TYPOGRAPHY_PRIMARY')
    expect(content).toContain('new \\DateTime()')
    expect(content).toContain('catch ( \\Exception $e )')
    expect(content).toContain('new Repeater()') // use ile alınmış
    expect(content).toContain('new Local_Helper()') // bilinmeyen sınıf: dokunulmaz
    expect(content).toContain("'label' => 'new WP_Query yazısı'") // dizge
    expect(content).toContain('extends \\Elementor\\Widget_Base')
    expect(fixes[0]).toMatch(/^namespace içinde tam sınıf adı: /)
    // Namespace'siz dosyada global ad zaten doğru
    expect(autoFix('t/functions.php', '<?php\n$q = new WP_Query( [] );\n').fixes).toEqual([])
  })
})

describe('tanımsız fonksiyon kontrolü', () => {
  const src = `<?php
namespace Ut\\Widgets;
function ut_helper() { return 1; }
if ( ! function_exists( 'ut_guarded' ) ) {
	function ut_guarded() {}
}
class W extends \\Elementor\\Widget_Base {
	protected function get_reading_time( $c ) { return 1; }
	protected function render() {
		echo esc_html( get_the_title() ) . ut_helper() . ut_shared();
		echo '<a href="https://x.test/#a">' . "renk: #fff; // değil" . '</a>';
		$css = 'grid-template-columns: repeat(3, minmax(0, 1fr)); background: linear-gradient(red, blue);';
		$h = <<<CSS
.a { width: clamp(1rem, 2vw, 3rem); }
CSS;
		echo $this->get_reading_time( 'x' );
		if ( function_exists( 'pro_only' ) ) { pro_only(); }
		echo get_reading_time();
		echo \\WP_Query::class;
	}
	protected function content_template() {
		?><# var a = items.push( view.render() ); #><div style="width: calc(100% - 2px)"></div><?php
	}
}
`
  it('yalnızca gerçek tanımsız global çağrıyı bulur', () => {
    const issues = checkUndefinedFunctions(src, ['ut_shared'])
    expect(issues.map((i) => i.message.split(':')[1].trim().split(' ')[0])).toEqual(['get_reading_time()'])
    expect(issues[0].line).toBe(18)
  })

  it('global tanımlar: metotlar hariç, function_exists blokları dahil', () => {
    expect(definedFunctions(src).sort()).toEqual(['ut_guarded', 'ut_helper'])
  })

  it('maskPhp: dizgedeki # ve //, yorumdaki tırnak, heredoc', () => {
    const m = maskPhp(`<?php $a = '#fff'; // it's\n$b = "x//y"; /* 'q */ $c = <<<T\nfoo(\nT;\n$d = 1;`)
    expect(m).toContain('$a =')
    expect(m).toContain('$d = 1;')
    expect(m).not.toMatch(/fff|it|x\/\/y|foo/)
    expect(m.length).toBe(`<?php $a = '#fff'; // it's\n$b = "x//y"; /* 'q */ $c = <<<T\nfoo(\nT;\n$d = 1;`.length)
  })
})

describe('checkNamespaceFirst', () => {
  it('php olmadan da yakalar', async () => {
    expect(checkNamespaceFirst(BAD)).toMatchObject([{ rule: 'php-namespace-first', line: 6 }])
    const issues = await validateFile('trk-elementor-widgets/widgets/class-hero.php', BAD, { mode: 'elementor-free', slug: 'turkuaz', prefix: 'trk', usePhpLint: false })
    expect(issues.map((i) => i.rule)).toContain('php-namespace-first')
  })
})

describe('token tasarrufu', () => {
  it('file.md yalnızca o türün kurallarını gönderir', async () => {
    const md = await loadPrompt(promptsDir, 'elementor-free', 'file')
    const css = selectKindRules(md, 'widget-css')
    expect(css).toContain('### widget-css')
    expect(css).not.toContain('### widget-php')
    expect(css).not.toContain('### demo-json')
    expect(css).toContain('## Çıktı')
    expect(css.length).toBeLessThan(md.length * 0.75)
    expect(selectKindRules(md, 'theme-footer')).toContain('### theme-header / theme-footer')
    expect(selectKindRules(md, 'bilinmeyen')).toBe(md)
    const block = await loadPrompt(promptsDir, 'block-theme', 'file')
    expect(selectKindRules(block, 'pattern')).toContain('### pattern')
    expect(selectKindRules(block, 'pattern')).not.toContain('### theme-json')
  })

  it('bir projedeki tüm çağrılarda system mesajı birebir aynı (önbellek), user mesajı yalnızca kendi türünü içerir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legt-cache-'))
    try {
      const store = new ProjectStore(dir)
      const plan = await elementorPlan()
      const id = await store.create(intake(plan.mode), pre)
      await store.savePlan(id, plan, 'approved')
      const p = fakeProvider()
      await generate({ provider: p, promptsDir, scaffoldDir, store, projectId: id, numCtx: 8192, usePhpLint: false })
      expect(new Set(p.calls.map((c) => c.messages[0].content)).size).toBe(1)
      const cssCall = p.calls.find((c) => c.messages[1].content.includes('Dosya türü: widget-css'))!.messages[1].content
      expect(cssCall).not.toContain('### widget-php')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('model ABSPATH\'i öne koysa bile onarım çağrısı harcanmaz', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legt-fix-'))
    try {
      const store = new ProjectStore(dir)
      const plan = await elementorPlan()
      const id = await store.create(intake(plan.mode), pre)
      await store.savePlan(id, plan, 'approved')
      const p = fakeProvider((user, path) => {
        if (!path.includes('/widgets/')) return undefined
        // Tipik yerel model hatası: ABSPATH namespace'ten önce
        const good = validContent(user, path)
        const bad = good.replace("namespace Trk\\Widgets;\n\nif ( ! defined( 'ABSPATH' ) ) exit;", "if ( ! defined( 'ABSPATH' ) ) exit;\n\nnamespace Trk\\Widgets;")
        expect(bad).not.toBe(good)
        return `<<<FILE ${path}>>>\n${bad}\n<<<END>>>`
      })
      const state = await generate({ provider: p, promptsDir, scaffoldDir, store, projectId: id, numCtx: 8192, usePhpLint: false })
      expect(Object.values(state.files).every((f) => f.status === 'ok')).toBe(true)
      expect(p.calls.some((c) => c.messages[1].content.startsWith('# REPAIR'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('Elementor global sabitleri', () => {
  it('uydurma TYPOGRAPHY_BODY gerçek sabite çevrilir, geçerliler dokunulmaz', async () => {
    const { autoFix } = await import('@core/validate/autofix')
    const { checkGlobalConstants } = await import('@core/validate/elementor')
    const src = "<?php\nuse Elementor\Core\Kits\Documents\Tabs\Global_Typography;\n$a = Global_Typography::TYPOGRAPHY_BODY; $b = Global_Typography::TYPOGRAPHY_PRIMARY;"
    expect(checkGlobalConstants(src)).toHaveLength(1)
    const fixed = autoFix('x-elementor-widgets/widgets/class-a.php', src)
    expect(fixed.content).toContain('Global_Typography::TYPOGRAPHY_TEXT')
    expect(fixed.content).toContain('Global_Typography::TYPOGRAPHY_PRIMARY')
    expect(checkGlobalConstants(fixed.content)).toEqual([])
  })
})
