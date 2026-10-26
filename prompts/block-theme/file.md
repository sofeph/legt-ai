# FILE — Tek dosya üretimi (Block Theme)

Üretilecek dosya: `{{path}}`
Dosya türü: {{fileKind}}   <!-- theme-json | template-part | pattern | template | theme-css | theme-js | readme -->

## Plan bağlamı
### Tasarım token'ları
{{tokens}}

### Bu dosyanın bölümü
{{section}}

### İlgili HTML bölümü (kaynak)
{{sectionHtml}}

### Bağımlı dosyaların imzaları
(preset slug'ları, pattern slug'ları, CSS sınıfları; bunlarla uyumlu kal)
{{dependencySignatures}}

## Dosya türüne göre gereksinimler

### theme-json
- `"version": 3`, `$schema` dahil
- `settings.color.palette`: token renkleri, slug ve çevrilebilir olmayan düz `name`
- `settings.color`: `custom: true`, `defaultPalette: false`, `defaultGradients: false`
- `settings.typography.fontFamilies`: heading ve body; Google Font ise `fontFace` ile `file:./assets/fonts/...` (dosyalar yoksa sistem fallback'li `fontFamily` yığını)
- `settings.typography.fontSizes`: token'lardan, `fluid` destekli
- `settings.spacing.spacingSizes` veya `spacingScale`, `units: ["px","em","rem","%","vw","vh"]`
- `settings.shadow.presets` token gölgeleri
- `settings.layout`: `contentSize` ve `wideSize`
- `styles`: body arka plan/metin rengi, tipografi, `elements` (link, heading, button) ve gerektiği kadar `blocks` stili; değerler `var:preset|color|primary` biçiminde
- `templateParts`: header (`area: "header"`), footer (`area: "footer"`)
- `customTemplates` gerekirse; `patterns` boş bırakılabilir

### template-part (`parts/header.html`, `parts/footer.html`)
- Saf blok işaretlemesi, PHP YOK
- Header: `core/group` (tagName header) içinde `core/site-logo` veya `core/site-title`, `core/navigation` (`overlayMenu: "mobile"`), gerekirse `core/buttons`
- Footer: `core/group` (tagName footer), kolonlar, `core/social-links`, telif satırı
- Kaynak HTML'in düzenini ve sırasını koru; renkler preset slug'ı ile

### pattern (`patterns/{ad}.php`)
- Başlık yorumu zorunlu:
  ```
  <?php
  /**
   * Title: {Başlık}
   * Slug: {{slug}}/{ad}
   * Categories: {{slug}}
   * Inserter: yes
   */
  ?>
  ```
- Ardından tam blok işaretlemesi; kaynak HTML'deki tüm metinler `esc_html__()` / `esc_html_e()` ile, görseller `get_theme_file_uri()` ile
- Tekrar eden öğeler plan'daki `repeat.count` kadar, her biri kaynak HTML'deki içerikle dolu
- `js` varsa en dıştaki `core/group`'a plan'daki `className`
- Blok yorumundaki JSON ile HTML'deki sınıf ve stiller birebir uyumlu olmalı (ör. `"backgroundColor":"primary"` → `class="... has-primary-background-color has-background"`)

### template (`templates/{ad}.html`)
- Saf blok işaretlemesi, PHP YOK
- `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->` ile başla, footer ile bitir
- `front-page`: plan'daki pattern'leri sırasıyla `<!-- wp:pattern {"slug":"{{slug}}/{ad}"} /-->` olarak çağır
- `index` / `archive` / `search`: `core/query` + `core/post-template` + `core/query-pagination`, sonuç yoksa `core/query-no-results`
- `single` / `page`: `core/post-title`, `core/post-featured-image`, `core/post-content`; single'da tarih ve `core/comments`
- `404`: başlık, açıklama, `core/search`

### theme-css (`assets/css/theme.css`)
- Yalnızca `theme.json`'ın karşılayamadığı stiller: hover/geçişler, `{{prefix}}-*` sınıflı JS bölümleri, kaynak HTML'e özgü süslemeler
- Renkler ve fontlar her zaman `var(--wp--preset--color--*)`, `var(--wp--preset--font-family--*)`
- Editörde de yüklenecek şekilde yazılır (`add_editor_style`)

### theme-js (`assets/js/theme.js`)
- Vanilla JS, IIFE, `DOMContentLoaded` sonrası
- Her davranış `.{{prefix}}-*` sınıfı üzerinden, sayfada birden fazla örnek olabilir
- Slider için harici kütüphane yerine CSS scroll-snap + küçük JS kontrolü tercih et

### readme
- Kurulum: tema zip'ini yükle → etkinleştir → Görünüm > Düzenleyici'de ana sayfayı kontrol et → Stiller'den renk/font ayarla → Pattern'ler kategorisinde `{{name}}` bölümlerini kullan
- Pattern listesi ve her birinin ne olduğu

## Çıktı
YALNIZCA şu biçimde, öncesinde ve sonrasında metin olmadan:

<<<FILE {{path}}>>>
(tam içerik)
<<<END>>>
