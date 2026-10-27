import { describe, expect, it } from 'vitest'
import { checkBlockMarkup, checkPatternHeader, checkRawHex } from '@core/validate/blocks'
import { checkForbidden } from '@core/validate/common'
import { checkPhpLight, checkPhpPrefix, checkPhpSyntax } from '@core/validate/php'
import { validateFile } from '@core/validate'

const rules = (xs: { rule: string }[]): string[] => xs.map((x) => x.rule)

describe('yasaklı kalıplar', () => {
  it('satır numarasıyla bulur', () => {
    const r = checkForbidden("<?php\nprotected function _register_controls() {}\n// ...\n")
    expect(r.map((x) => [x.message, x.line])).toEqual([
      ['Yasaklı kalıp: // ...', 3],
      ['Yasaklı kalıp: _register_controls', 2]
    ])
  })
  it('register_controls serbest', () => {
    expect(checkForbidden('protected function register_controls() {}')).toEqual([])
  })
})

describe('PHP', () => {
  it('açılış etiketi ve parantez dengesi', () => {
    expect(rules(checkPhpLight('echo 1;'))).toEqual(['php-open-tag'])
    expect(checkPhpLight("<?php\nif (a) {\n  echo '}';\n")[0]).toMatchObject({ rule: 'brackets', line: 2 })
    expect(checkPhpLight("<?php\nfunction a() { return [1, 2]; }\n")).toEqual([])
  })
  it('JS ayrıştırıcı ile sözdizimi (php yokken)', () => {
    expect(checkPhpSyntax("<?php\n$x = ;\n")).toMatchObject([{ rule: 'php-syntax', line: 2 }])
    expect(checkPhpSyntax("<?php\nnamespace A;\nclass B { public function x(): ?int { return $this?->y ?? null; } }")).toEqual([])
    expect(checkPhpSyntax("<?php if ( $x ) : ?><div>a</div><?php endif; ?>")).toEqual([])
  })
  it('global fonksiyon öneki; metotlar ve closure içi serbest', () => {
    const src = `<?php
if ( ! function_exists( 'trk_setup' ) ) {
  function trk_setup() {}
}
function register_widgets() {}
class Trk_Walker { public function walk() { $f = function () {}; } }
class Walker {}
add_action( 'init', function () { echo 'x'; } );
`
    expect(checkPhpPrefix(src, 'trk').map((i) => [i.message.split(' (')[0], i.line])).toEqual([
      ['Önek eksik: global fonksiyon register_widgets()', 5],
      ['Önek eksik: global class Walker', 7]
    ])
  })
  it('namespace varsa class adı serbest, namespace önekli olmalı', () => {
    expect(checkPhpPrefix('<?php\nnamespace Trk\\Widgets;\nclass Widget_Hero {}', 'trk')).toEqual([])
    expect(rules(checkPhpPrefix('<?php\nnamespace Foo;\nclass A {}', 'trk'))).toEqual(['prefix'])
  })
})

describe('blok işaretlemesi', () => {
  it('geçerli işaretleme', () => {
    const ok = `<!-- wp:group {"tagName":"header","layout":{"type":"constrained"}} -->
<header class="wp-block-group"><!-- wp:site-title /--><!-- wp:navigation {"overlayMenu":"mobile"} /--></header>
<!-- /wp:group -->`
    expect(checkBlockMarkup(ok)).toEqual([])
  })
  it('geçersiz JSON, kapanmayan ve yanlış sıralı bloklar', () => {
    expect(rules(checkBlockMarkup('<!-- wp:group {layout:{type:"constrained"}} -->\n<!-- /wp:group -->'))).toEqual(['block-json'])
    expect(checkBlockMarkup('<!-- wp:columns -->\n<!-- wp:column -->\n<!-- /wp:column -->')).toMatchObject([{ rule: 'block-balance', line: 1 }])
    expect(rules(checkBlockMarkup('<!-- wp:group -->\n<!-- wp:columns -->\n<!-- /wp:group -->\n<!-- /wp:columns -->'))).toContain('block-balance')
  })
  it('pattern JSON içindeki PHP JSON hatası sayılmaz', () => {
    expect(checkBlockMarkup(`<!-- wp:image {"url":"<?php echo esc_url( get_theme_file_uri( "a.jpg" ) ); ?>"} -->\n<!-- /wp:image -->`)).toEqual([])
  })
  it('ham hex; link çapası ve HTML entity hariç', () => {
    const src = `<!-- wp:group {"style":{"color":{"background":"#1a1a2e"}}} --><div style="color:#fff"><a href="#add">x</a>&#8212;</div><!-- /wp:group -->`
    expect(checkRawHex(src).map((i) => i.message)).toEqual([
      "Ham hex renk kullanılmış: #fff, preset slug'ı kullan",
      "Ham hex renk kullanılmış: #1a1a2e, preset slug'ı kullan"
    ])
  })
  it('pattern başlığı', () => {
    expect(checkPatternHeader('<?php\n/**\n * Title: Hero\n * Slug: trk-tema/hero\n */\n?>', 'trk-tema')).toEqual([])
    expect(rules(checkPatternHeader('<?php\n/**\n * Title: Hero\n */\n?>', 'trk-tema'))).toEqual(['pattern-header'])
  })
})

describe('validateFile yönlendirmesi', () => {
  const ctx = { mode: 'block-theme' as const, slug: 'trk-tema', prefix: 'trk', usePhpLint: false }
  it('template içinde PHP', async () => {
    expect(rules(await validateFile('trk-tema/templates/index.html', '<?php echo 1; ?>', ctx))).toContain('no-php')
  })
  it('theme.json parse hatası', async () => {
    expect(rules(await validateFile('trk-tema/theme.json', '{"version": 3,}', ctx))).toEqual(['json'])
  })
  it('JS sözdizimi', async () => {
    expect(rules(await validateFile('a/assets/js/theme.js', '(function(){', ctx))).toEqual(['js-syntax'])
    expect(await validateFile('a/assets/js/theme.js', '(function(){})()', ctx)).toEqual([])
  })
})

describe('checkPhpPrefix: ?> ... <?php geçişleri', () => {
  it('render() içinde HTML\'e geçildikten sonraki metotlar global sayılmaz', () => {
    const src = `<?php
namespace Urt\Widgets;
class Widget_Hero extends \Elementor\Widget_Base {
	protected function render() {
		?>
		<div><?php echo esc_html( 'x' ); ?></div>
		<?php
	}
	protected function content_template() {
		?>
		<# if ( settings.title ) { #><h2>{{ settings.title }}</h2><# } #>
		<?php
	}
}
`
    expect(checkPhpPrefix(src, 'urt')).toEqual([])
    // Sınıf kapandıktan sonraki öneksiz global fonksiyon yine yakalanır
    expect(checkPhpPrefix(src.replace(/\n$/, '\nfunction helper() {}\n'), 'urt').map((i) => i.message)).toEqual(['Önek eksik: global fonksiyon helper() (beklenen urt_...)'])
  })
})

describe('checkDynamicMenu', () => {
  const repeater = "$this->add_control( 'items', array( 'type' => \Elementor\Controls_Manager::REPEATER ) );"
  it('Repeater ile gömülü header menüsünü reddeder', async () => {
    const { checkDynamicMenu } = await import('@core/validate/elementor')
    expect(checkDynamicMenu('x-elementor-widgets/widgets/class-header.php', repeater)).toHaveLength(1)
    expect(checkDynamicMenu('x-elementor-widgets/widgets/class-header.php', `${repeater} ut_render_menu( $s['menu'], 'primary', 'ut-menu' );`)).toEqual([])
    expect(checkDynamicMenu('x-elementor-widgets/widgets/class-hero.php', repeater)).toEqual([])
  })
})

describe('checkDynamicQuery', () => {
  it('gömülü yazı listesini reddeder, WP_Query kullananı kabul eder', async () => {
    const { checkDynamicQuery } = await import('@core/validate/elementor')
    const path = 'x-elementor-widgets/widgets/class-post-list.php'
    expect(checkDynamicQuery(path, "$items = array( array( 'title' => 'A' ) );")).toHaveLength(1)
    expect(checkDynamicQuery(path, '$q = new \WP_Query( $args );')).toEqual([])
    expect(checkDynamicQuery('x-elementor-widgets/widgets/class-hero.php', 'x')).toEqual([])
  })
})
