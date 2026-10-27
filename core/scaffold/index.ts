import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { pascalPrefix, widgetClassName } from '../prompts/render'
import { pluginDir, sectionRole, themeDir } from '../pipeline/layout'
import type { BlockSection, ElementorPlan, ElementorSection, Plan, PreAnalysis } from '../types'

/**
 * LLM'e gitmeyen, şablondan doldurulan dosyalar.
 *   core/scaffold/{mode}/theme/**   → {slug}/**
 *   core/scaffold/{mode}/plugin/**  → {slug}-elementor-widgets/**   (__plugin__ → klasör adı)
 *   core/scaffold/block-theme/fallback/parts/*  → plan'da header/footer bölümü yoksa
 * Ayrıca plan'a bağlı dinamik dosyalar: widget manifest'i, front-page.html, README.md
 */

const TEXT: Record<'tr' | 'en', Record<string, string>> = {
  tr: {
    noResults: 'Gösterilecek içerik bulunamadı.',
    search: 'Ara',
    notFoundTitle: 'Sayfa bulunamadı',
    notFoundText: 'Aradığınız sayfa taşınmış ya da silinmiş olabilir. Aramayı deneyin.'
  },
  en: {
    noResults: 'No content found.',
    search: 'Search',
    notFoundTitle: 'Page not found',
    notFoundText: 'The page you are looking for may have been moved or deleted. Try searching.'
  }
}

export function scaffoldVars(plan: Plan): Record<string, string> {
  const { name, slug, prefix, textdomain, language } = plan.theme
  const t = TEXT[language.toLowerCase().startsWith('tr') ? 'tr' : 'en']
  return {
    name,
    slug,
    prefix,
    Prefix: pascalPrefix(prefix),
    PREFIX: prefix.toUpperCase(),
    textdomain,
    language,
    year: String(new Date().getFullYear()),
    pluginDir: pluginDir(plan),
    ...Object.fromEntries(Object.entries(t).map(([k, v]) => [`t_${k}`, v]))
  }
}

function escapeFor(ext: string, value: string): string {
  if (ext === 'php') return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  if (ext === 'html') return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  if (ext === 'css') return value.replace(/\*\//g, '* /')
  return value
}

/** {{var}} doldurur; bilinmeyen yer tutucu kalırsa hata (şablon hatası) */
export function fillScaffold(template: string, vars: Record<string, string>, ext: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    if (!(key in vars)) throw new Error(`Scaffold şablonunda bilinmeyen yer tutucu: ${whole}`)
    return escapeFor(ext, vars[key])
  })
}

async function walk(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out.sort()
}

interface Source {
  out: string
  /** Şablon dosyası (diskten) ya da dinamik üretici */
  from: string | ((plan: Plan, pre: PreAnalysis) => string)
}

function hasRole(plan: Plan, pre: PreAnalysis, role: 'header' | 'footer'): boolean {
  return plan.sections.some((s) => sectionRole(s, pre, 'widget' in s ? s.widget : s.slug) === role)
}

async function sources(scaffoldDir: string, plan: Plan, pre: PreAnalysis): Promise<Source[]> {
  const base = join(scaffoldDir, plan.mode)
  const T = themeDir(plan)
  const P = pluginDir(plan)
  const list: Source[] = []
  for (const f of await walk(join(base, 'theme'))) list.push({ out: `${T}/${relative(join(base, 'theme'), f).replace(/\\/g, '/')}`, from: f })

  if (plan.mode === 'elementor-free') {
    for (const f of await walk(join(base, 'plugin'))) {
      const rel = relative(join(base, 'plugin'), f).replace(/\\/g, '/').replace('__plugin__', P)
      list.push({ out: `${P}/${rel}`, from: f })
    }
    list.push({ out: `${P}/includes/widgets-manifest.php`, from: widgetManifest })
    list.push({ out: `${P}/includes/demo-data.php`, from: demoData })
    list.push({ out: `${P}/includes/demo-content.php`, from: demoContent })
    // Demo şablonları plandan: home = içerik widget'ları sırayla, header/footer = kendi widget'ı
    list.push({ out: `${P}/demo/home.json`, from: (p, pr) => demoJson(p as ElementorPlan, pr, 'home') })
    if (hasRole(plan, pre, 'header')) list.push({ out: `${P}/demo/header.json`, from: (p, pr) => demoJson(p as ElementorPlan, pr, 'header') })
    if (hasRole(plan, pre, 'footer')) list.push({ out: `${P}/demo/footer.json`, from: (p, pr) => demoJson(p as ElementorPlan, pr, 'footer') })
    list.push({ out: `${T}/README.md`, from: readme })
    list.push({ out: `${P}/README.md`, from: readme })
  } else {
    for (const role of ['header', 'footer'] as const) {
      if (!hasRole(plan, pre, role)) list.push({ out: `${T}/parts/${role}.html`, from: join(base, 'fallback', 'parts', `${role}.html`) })
    }
    list.push({ out: `${T}/templates/front-page.html`, from: frontPage })
    list.push({ out: `${T}/README.md`, from: readme })
  }
  return list
}

/** Plan ekranındaki dosya listesi için yalnızca yollar */
export async function scaffoldPaths(scaffoldDir: string, plan: Plan, pre: PreAnalysis): Promise<string[]> {
  return (await sources(scaffoldDir, plan, pre)).map((s) => s.out)
}

/** Tüm scaffold dosyalarını içerikleriyle üretir (yol → içerik) */
export async function renderScaffold(scaffoldDir: string, plan: Plan, pre: PreAnalysis): Promise<Map<string, string>> {
  const vars = scaffoldVars(plan)
  const out = new Map<string, string>()
  for (const s of await sources(scaffoldDir, plan, pre)) {
    const ext = s.out.slice(s.out.lastIndexOf('.') + 1)
    out.set(s.out, typeof s.from === 'string' ? fillScaffold(await readFile(s.from, 'utf8'), vars, ext) : s.from(plan, pre))
  }
  return out
}

// ---- Dinamik dosyalar ----

const phpStr = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** includes/widgets-manifest.php — plan.files'tan (kullanıcı düzenlemeleri dahil) */
function widgetManifest(plan: Plan): string {
  const P = pluginDir(plan) + '/'
  const ns = pascalPrefix(plan.theme.prefix)
  const rows = (plan as Extract<Plan, { mode: 'elementor-free' }>).sections.flatMap((s: ElementorSection) => {
    const of = (kind: string): string => plan.files.find((f) => f.kind === kind && f.sectionId === s.id)?.path.replace(P, '') ?? ''
    const file = of('widget-php')
    if (!file) return []
    const cls = `\\${ns}\\Widgets\\Widget_${widgetClassName(s.widget, plan.theme.prefix)}`
    return [
      `\tarray(\n\t\t'name'  => ${phpStr(s.widget)},\n\t\t'class' => ${phpStr(cls)},\n\t\t'file'  => ${phpStr(file)},\n\t\t'css'   => ${phpStr(of('widget-css'))},\n\t\t'js'    => ${phpStr(of('widget-js'))},\n\t),`
    ]
  })
  return `<?php
/**
 * Widget listesi — LEGT AI tarafından plan.json'dan üretildi.
 *
 * @package ${ns}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

return array(
${rows.join('\n')}
);
`
}

/** Kararlı 7 haneli hex Elementor kimliği (aynı plan → aynı JSON) */
function elId(seed: string): string {
  let h = 0x811c9dc5
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
  return (h & 0xfffffff).toString(16).padStart(7, '0')
}

/**
 * demo/{home,header,footer}.json — Elementor şablon formatı. Widget ayarları boş: widget'ın
 * varsayılanları (örnek HTML'in içeriği) kullanılır, yani demo tam olarak widget'ın kendisidir.
 */
function demoJson(plan: ElementorPlan, pre: PreAnalysis, kind: 'home' | 'header' | 'footer'): string {
  const role = (s: ElementorSection): string => sectionRole(s, pre, s.widget)
  const firstOf = (r: string): ElementorSection | undefined => plan.sections.find((s) => role(s) === r)
  const header = firstOf('header')
  const footer = firstOf('footer')
  const sections = kind === 'home' ? plan.sections.filter((s) => s !== header && s !== footer) : [kind === 'header' ? header : footer].filter((s): s is ElementorSection => !!s)
  const content = sections.map((s) => ({
    id: elId(`${kind}:${s.id}:section`),
    elType: 'section',
    settings: { layout: 'full_width', gap: 'no' },
    elements: [
      {
        id: elId(`${kind}:${s.id}:column`),
        elType: 'column',
        settings: { _column_size: 100 },
        elements: [{ id: elId(`${kind}:${s.id}:widget`), elType: 'widget', widgetType: s.widget, settings: {}, elements: [] }],
        isInner: false
      }
    ],
    isInner: false
  }))
  const title = kind === 'home' ? `${plan.theme.name} — Ana sayfa` : `${plan.theme.name} — ${kind === 'header' ? 'Header' : 'Footer'}`
  return JSON.stringify({ version: '0.4', title, type: kind === 'home' ? 'page' : 'section', content, page_settings: [] }, null, 2) + '\n'
}

const CSS_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?([ds.,%]+)|hsla?([ds.,%deg]+))$/i

/**
 * includes/demo-data.php — demo içe aktarıcının Elementor global renk/font'ları için.
 * Plan token'ı boşsa ön analizdeki en sık renk/font kullanılır.
 */
function demoData(plan: Plan, pre: PreAnalysis): string {
  const t = plan.tokens as { colors?: Record<string, unknown>; fonts?: Record<string, unknown> }
  const freq = pre.tokens.colors.map((c) => c.value).filter((v) => CSS_COLOR_RE.test(v))
  const colors = (['primary', 'secondary', 'text', 'accent'] as const).map((k, i) => {
    const v = typeof t.colors?.[k] === 'string' ? (t.colors[k] as string).trim() : ''
    return [k, CSS_COLOR_RE.test(v) ? v : (freq[i] ?? '')] as const
  })
  const family = (v: unknown): string => (typeof v === 'string' ? v.split(',')[0].replace(/["']/g, '').trim() : '')
  const fallback = family(pre.tokens.fonts[0]?.family)
  const heading = family(t.fonts?.heading) || fallback
  const body = family(t.fonts?.body) || fallback
  const ns = pascalPrefix(plan.theme.prefix)
  return `<?php
/**
 * Demo içe aktarıcının Elementor global renk ve fontları — LEGT AI tarafından plan.json'dan üretildi.
 *
 * @package ${ns}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

return array(
	'colors' => array(
${colors.map(([k, v]) => `		${phpStr(k)} => ${phpStr(v)},`).join('\n')}
	),
	'fonts'  => array(
		'heading' => ${phpStr(heading)},
		'body'    => ${phpStr(body)},
	),
);
`
}

/**
 * includes/demo-content.php — örnek HTML'deki yazı kartlarından demo yazıları ve kategoriler.
 * İçe aktarıcı bunları gerçek WordPress yazısı olarak ekler; widget'lar WP_Query ile okur.
 */
function demoContent(plan: Plan, pre: PreAnalysis): string {
  const d = pre.demo ?? { posts: [], categories: [] }
  const ns = pascalPrefix(plan.theme.prefix)
  return `<?php
/**
 * Demo yazıları ve kategoriler — LEGT AI tarafından örnek HTML'den üretildi.
 *
 * @package ${ns}
 */

if ( ! defined( 'ABSPATH' ) ) exit;

return array(
	'categories' => array(
${d.categories.map((c) => `		${phpStr(c)},`).join('\n')}
	),
	'posts'      => array(
${d.posts.map((p) => `		array(
			'title'    => ${phpStr(p.title)},
			'excerpt'  => ${phpStr(p.excerpt)},
			'image'    => ${phpStr(p.image)},
			'category' => ${phpStr(p.category)},
		),`).join('\n')}
	),
);
`
}

/** templates/front-page.html — pattern'ler plan sırasıyla */
function frontPage(plan: Plan, pre: PreAnalysis): string {
  const patterns = (plan.sections as BlockSection[])
    .filter((s) => sectionRole(s, pre, s.slug) === 'content' || sectionRole(s, pre, s.slug) === 'nav')
    .map((s) => `<!-- wp:pattern ${JSON.stringify({ slug: s.slug })} /-->`)
  return [
    '<!-- wp:template-part {"slug":"header","tagName":"header"} /-->',
    '',
    '<!-- wp:group {"tagName":"main","layout":{"type":"default"}} -->',
    '<main class="wp-block-group">',
    patterns.join('\n\n'),
    '</main>',
    '<!-- /wp:group -->',
    '',
    '<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->',
    ''
  ].join('\n')
}

function readme(plan: Plan, pre: PreAnalysis): string {
  const { name } = plan.theme
  const T = themeDir(plan)
  if (plan.mode === 'elementor-free') {
    const P = pluginDir(plan)
    const widgets = plan.sections.map((s) => `| \`${s.widget}\` | ${s.title ?? s.id} | ${s.js && s.js !== 'none' ? s.js : '—'} |`)
    return `# ${name}

LEGT AI ile üretilmiş klasik WordPress teması + Elementor (Free) widget eklentisi. Elementor Pro gerektirmez.

## Paketler

- \`${T}-theme.zip\` — tema (\`${T}/\`)
- \`${T}-elementor-widgets.zip\` — widget eklentisi (\`${P}/\`)

## Kurulum

1. **Görünüm > Temalar > Yeni ekle > Tema yükle** ile \`${T}-theme.zip\` dosyasını yükleyip etkinleştirin.
2. **Eklentiler > Yeni ekle** ile **Elementor**'u (ücretsiz) kurup etkinleştirin.
3. **Eklentiler > Yeni ekle > Eklenti yükle** ile \`${T}-elementor-widgets.zip\` dosyasını yükleyip etkinleştirin.
4. **Görünüm > ${name} Demo > Demo içeriğini içe aktar** düğmesine basın (etkinleştirince çıkan bildirimden de açılır). Tek tıkla:
   - \`demo/home.json\` → "Ana Sayfa" (statik ön sayfa yapılır)
   - \`demo/header.json\` / \`demo/footer.json\` → ${name} Layout'ları ve **Görünüm > Özelleştir > Header / Footer** seçimi
   - ana menü (\`primary\` konumu) ve **Elementor > Site Ayarları** global renk / fontları

   Tekrar çalıştırmak aynı kayıtları günceller. WP-CLI: \`wp ${plan.theme.prefix} demo-import [--no-front-page] [--no-menu] [--no-kit]\`
5. Sayfaları Elementor ile düzenleyin; widget'lar Global renk ve fontlara bağlıdır.

Elle kurmak isterseniz: **Elementor > Şablonlar > İçe aktar** ile \`demo/\` klasöründeki JSON'ları alın, **${name} Layout'ları** menüsünde Header/Footer oluşturup şablonları ekleyin, **Görünüm > Özelleştir > Header / Footer**'dan seçin.

Herhangi bir sayfaya layout eklemek için kısa kod: \`[${plan.theme.prefix}_template id="123"]\`

## Widget'lar

Elementor panelinde **${name}** kategorisi altında:

| Widget | Bölüm | JS |
|---|---|---|
${widgets.join('\n')}

## Lisans

GPL-3.0-or-later
`
  }
  const patterns = (plan.sections as BlockSection[])
    .filter((s) => sectionRole(s, pre, s.slug) === 'content' || sectionRole(s, pre, s.slug) === 'nav')
    .map((s) => `| \`${s.slug}\` | ${s.title ?? s.id} |`)
  return `# ${name}

LEGT AI ile üretilmiş WordPress blok teması (Full Site Editing). WordPress 6.4+ gerektirir.

## Kurulum

1. **Görünüm > Temalar > Yeni ekle > Tema yükle** ile \`${T}-theme.zip\` dosyasını yükleyip etkinleştirin.
2. **Görünüm > Düzenleyici**'de ana sayfayı kontrol edin; tüm bölümler blok olarak düzenlenebilir.
3. **Düzenleyici > Stiller** bölümünden renk ve fontları ayarlayın (\`theme.json\` preset'leri).
4. Yeni sayfalarda **Pattern'ler > ${name}** kategorisindeki bölümleri kullanın.

## Pattern'ler

| Slug | Bölüm |
|---|---|
${patterns.join('\n')}

## Lisans

GPL-3.0-or-later
`
}
