# FILE — Tek dosya üretimi

Üretilecek dosya: `{{path}}`
Dosya türü: {{fileKind}}   <!-- widget-php | widget-css | widget-js | theme-css | theme-header | theme-footer | demo-json | readme -->

## Plan bağlamı
### Tasarım token'ları
{{tokens}}

### Bu dosyanın bölümü
{{section}}

### İlgili HTML bölümü (kaynak)
{{sectionHtml}}

### Bağımlı dosyaların imzaları
(class adları, CSS sınıfları, JS handle'ları; bunlarla uyumlu kal)
{{dependencySignatures}}

## Dosya türüne göre gereksinimler

### widget-php
- Dosya şöyle başlar (sıra zorunlu): `<?php`, `namespace {{Prefix}}\Widgets;`, `use` satırları, sonra `if ( ! defined( 'ABSPATH' ) ) exit;`
- Class adı `Widget_{{WidgetClass}}`, `\Elementor\Widget_Base`'den türer
- `get_name()` → `{{widgetName}}`, `get_categories()` → `['{{prefix}}']`, `get_icon()` uygun bir `eicon-*`
- `get_style_depends()` → `['{{widgetName}}']`, JS varsa `get_script_depends()` → `['{{widgetName}}']`
- `register_controls()`:
  - İçerik sekmesi: bölümdeki tüm metin, görsel (MEDIA), link (URL), ikon (ICONS); tekrar eden öğeler için `\Elementor\Repeater`
  - Metin/görsel/link kontrollerinde `'dynamic' => ['active' => true]`
  - Stil sekmesi: her ana öğe için ayrı section; `Group_Control_Typography` (global default bağlı), renk (`Global_Colors`), `Group_Control_Background`, `Group_Control_Border`, `Group_Control_Box_Shadow`
  - `add_responsive_control`: padding, margin, hizalama, varsa kolon sayısı ve boşluk
  - Bölüm JS içeriyorsa davranış ayarları (otomatik oynatma, hız, sticky açık/kapalı vb.)
  - "Ek CSS sınıfı" TEXT kontrolü
  - Varsayılanlar kaynak HTML'deki metin, görsel URL'si ve öğe sayısıyla birebir
- `render()`: `get_settings_for_display()`, kaynak HTML'in yapısını koru, sınıfları `{{prefix}}-` önekiyle yeniden adlandır, her çıktıyı escape et, `add_render_attribute` kullan
- `content_template()`: `render()` ile aynı çıktıyı veren Underscore/Backbone şablonu
- Kaynak HTML'deki hiçbir metin, renk veya görsel koda gömülü kalmaz

### widget-css
- Yalnızca bu widget'ın `.{{prefix}}-{ad}` kapsamı altında
- Renkler `var(--e-global-color-*, #fallback)`, fontlar `var(--e-global-typography-*-font-family, fallback)`
- Breakpoint'ler: tablet `{{tabletBp}}px`, mobil `{{mobileBp}}px`
- Kaynak HTML'in görünümünü birebir yakala

### widget-js
- Vanilla JS, IIFE içinde
- `window.addEventListener('elementor/frontend/init', ...)` içinde `elementorFrontend.hooks.addAction('frontend/element_ready/{{widgetName}}.default', ($scope) => { ... })`
- `$scope[0]` üzerinden çalış; global seçici kullanma (sayfada widget birden fazla olabilir)
- Ayarları PHP'den `data-settings` attribute'u ile oku
- Slider: `elementorFrontend.utils.swiper` ile Elementor'un Swiper'ı
- Editörde yeniden render'da tekrar init olmasına izin ver, eski dinleyicileri temizle

### theme-css
- `:root` altında tüm token'lar, Elementor Global fallback'li
- Temel reset, tipografi, `.{{prefix}}-container`, Elementor kapalıyken fallback header/footer stili

### theme-header / theme-footer
- (Yeni projelerde scaffold üretir; eski planlar için) `<?php wp_head(); ?>`, `wp_body_open()`, `wp_footer()` eksiksiz; layout'u `{{prefix}}_render_layout( 'header' )` / `( 'footer' )` ile bas, false dönerse sade PHP fallback

### demo-json
- (Yeni projelerde scaffold üretir) `{ "version": "0.4", "title": "", "type": "page", "content": [ ... ] }`, yalnızca bağımlı dosya imzalarındaki `{{prefix}}-*` widget adları, `content` boş olamaz

### readme
- Kurulum: tema zip'i yükle → eklenti zip'ini yükle → Elementor > Şablonlar > İçe Aktar ile JSON'ları al → Layout'lar menüsünde header/footer oluştur → Görünüm > Özelleştir'den seç → Elementor > Site Ayarları'nda Global renk/font'ları kontrol et
- Widget listesi ve her birinin ne yaptığı

## Çıktı
YALNIZCA şu biçimde, öncesinde ve sonrasında metin olmadan:

<<<FILE {{path}}>>>
(tam içerik)
<<<END>>>
