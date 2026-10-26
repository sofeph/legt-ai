// pipeline.test.ts ve wptest.live.test.ts'in ortak kurulumu: fixture, plan kurucuları, sahte LLM
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractTokens } from '@core/html/extractTokens'
import { splitSections } from '@core/html/splitSections'
import type { ChatRequest, LLMProvider } from '@core/llm/provider'
import { buildFiles, normalizePlan } from '@core/pipeline/layout'
import { scaffoldPaths } from '@core/scaffold'
import type { BlockPlan, ElementorPlan, IntakeInput, Plan } from '@core/types'

export const root = join(__dirname, '..')
export const promptsDir = join(root, 'prompts')
export const scaffoldDir = join(root, 'core', 'scaffold')
export const html = readFileSync(join(__dirname, 'fixtures/landing.html'), 'utf8')
export const pre = { sections: splitSections(html), tokens: extractTokens(html) }
export const theme = { name: "Türkuaz Ajans", slug: 'turkuaz', prefix: 'trk', textdomain: 'turkuaz', language: 'tr' }
export const WIDGETS = ['header', 'hero', 'features', 'testimonials', 'faq', 'footer']
export const JS: Record<string, string> = { header: 'menu-toggle', testimonials: 'slider', faq: 'accordion' }

export function intake(mode: Plan['mode']): IntakeInput {
  return { mode, theme, sources: [{ name: 'landing.html', kind: 'html', content: html }], requests: { blog: true, woocommerce: false, multiPage: false, notes: '' } }
}

export async function elementorPlan(): Promise<ElementorPlan> {
  const plan = normalizePlan({
    mode: 'elementor-free',
    theme,
    tokens: { colors: { primary: '#0e7c86' }, breakpoints: { tablet: 1024, mobile: 767 } },
    sections: WIDGETS.map((w, i) => ({
      id: w,
      htmlRef: `section-${i + 1}`,
      widget: w === 'hero' ? 'hero' : `trk-${w}`, // biri öneksiz: normalize etmeli
      title: w,
      contentControls: ['title'],
      styleControls: [],
      repeater: null,
      js: JS[w] ?? 'none',
      proReplacement: null
    })),
    layout: { header: 'widget', footer: 'widget' },
    files: []
  }) as ElementorPlan
  plan.files = buildFiles(plan, pre, await scaffoldPaths(scaffoldDir, plan, pre))
  return plan
}

export async function blockPlan(withHeader = true): Promise<BlockPlan> {
  const sections = WIDGETS.map((w, i) => ({ id: w, htmlRef: `section-${i + 1}`, kind: 'pattern' as const, slug: w, title: w, blocks: [], repeat: null, js: JS[w] ?? 'none', className: null }))
  const p = { mode: 'block-theme' as const, theme, tokens: {}, sections: withHeader ? sections : sections.slice(1, -1), templates: ['index', 'front-page'], files: [] }
  const plan = normalizePlan(p) as BlockPlan
  const preUsed = withHeader ? pre : { ...pre, sections: pre.sections.slice(1, -1) }
  plan.files = buildFiles(plan, preUsed, await scaffoldPaths(scaffoldDir, plan, preUsed))
  return plan
}

// ---- Sahte LLM: istenen dosya türüne göre geçerli içerik döndürür ----

export function validContent(user: string, path: string): string {
  if (path.endsWith('.php') && path.includes('/widgets/')) {
    const name = /`get_name\(\)` → `([\w-]+)`/.exec(user)![1]
    const cls = /class adı `(Widget_\w+)`/i.exec(user)![1]
    return `<?php
namespace Trk\\Widgets;

if ( ! defined( 'ABSPATH' ) ) exit;

class ${cls} extends \\Elementor\\Widget_Base {
	public function get_name() { return '${name}'; }
	public function get_style_depends() { return [ '${name}' ]; }
	protected function register_controls() {
		$this->start_controls_section( 'content', [ 'label' => esc_html__( 'İçerik', 'turkuaz' ) ] );
		$this->add_control( 'title', [ 'type' => \\Elementor\\Controls_Manager::TEXT, 'default' => esc_html__( 'Başlık', 'turkuaz' ) ] );
		$this->end_controls_section();
	}
	protected function render() {
		$s = $this->get_settings_for_display();
		echo '<div class="${name}"><h2 class="${name}__title">' . esc_html( $s['title'] ) . '</h2></div>';
	}
}
`
  }
  if (path.endsWith('.php') && path.includes('/patterns/')) {
    const slug = /"slug": "([^"]+)"/.exec(user)![1]
    return `<?php
/**
 * Title: Bölüm
 * Slug: ${slug}
 * Categories: turkuaz
 */
?>
<!-- wp:group {"backgroundColor":"primary"} -->
<div class="wp-block-group has-primary-background-color has-background"><!-- wp:heading -->
<h2 class="wp-block-heading"><?php echo esc_html__( 'Başlık', 'turkuaz' ); ?></h2>
<!-- /wp:heading --></div>
<!-- /wp:group -->`
  }
  if (path.endsWith('.php')) return `<?php\nif ( ! defined( 'ABSPATH' ) ) exit;\n?><!doctype html>\n<html <?php language_attributes(); ?>><head><?php wp_head(); ?></head><body <?php body_class(); ?>><?php wp_body_open(); ?>\n`
  if (path.endsWith('theme.json')) return JSON.stringify({ version: 3, settings: { color: { palette: [{ slug: 'primary', color: '#0e7c86', name: 'Primary' }] } } }, null, 2)
  if (path.endsWith('.json')) {
    // Demo şablonu: home → hero, header/footer → kendi widget'ı (biri id'siz: içe aktarıcı tamamlamalı)
    const key = /demo\/(\w+)\.json$/.exec(path)?.[1] ?? 'home'
    const widget = key === 'home' ? 'trk-hero' : `trk-${key}`
    const w = { id: key === 'home' ? undefined : 'a1b2c3d', elType: 'widget', widgetType: widget, settings: {}, elements: [] }
    return JSON.stringify({ version: '0.4', title: key, type: 'page', content: [{ id: 'f0e1d2c', elType: 'section', settings: {}, elements: [{ id: '9a8b7c6', elType: 'column', settings: { _column_size: 100 }, elements: [w] }] }] })
  }
  if (path.endsWith('.html')) return '<!-- wp:group {"tagName":"header"} -->\n<header class="wp-block-group"><!-- wp:site-title /--></header>\n<!-- /wp:group -->'
  if (path.endsWith('.css')) return '.trk-x { color: var(--e-global-color-primary, #0e7c86); }'
  if (path.endsWith('.js')) return "(function () { window.addEventListener('elementor/frontend/init', function () {}); })();"
  return 'x'
}

export type Behavior = (user: string, path: string, callNo: number) => string | undefined

export function fakeProvider(behavior: Behavior = () => undefined): LLMProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = []
  return {
    calls,
    listModels: async () => [],
    chat: async (req) => {
      calls.push(req)
      const user = req.messages[1].content
      const path = /(?:Üretilecek dosya|Dosya): `([^`]+)`/.exec(user)![1]
      const custom = behavior(user, path, calls.filter((c) => c.messages[1].content.includes(`\`${path}\``)).length)
      // Onarım çağrısı: mevcut içerikteki yasaklı kalıbı düzeltip geri ver
      const repaired = user.startsWith('# REPAIR')
        ? /## Mevcut içerik\n([\s\S]*?)\n+## Çıktı/.exec(user)![1].replace('_register_controls', 'register_controls')
        : null
      const out = custom ?? `<<<FILE ${path}>>>\n${repaired ?? validContent(user, path)}\n<<<END>>>`
      req.onToken?.(out)
      return out
    }
  }
}
