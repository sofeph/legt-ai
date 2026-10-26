# ANALYZE — Elementor Free plan çıkarımı

Görevin: aşağıdaki ön analizden bir `plan.json` üretmek. YALNIZCA geçerli JSON döndür. Markdown, açıklama, kod bloğu işareti yazma.

## Girdi

### Kullanıcı istekleri
{{requests}}

### Ön analiz token'ları (extractTokens.ts çıktısı)
{{tokens}}

### Bölüm özetleri (splitSections.ts çıktısı)
Her bölüm: id, etiket, başlıklar, metin örnekleri, görsel sayısı, link sayısı, tekrar eden öğe sayısı, ilgili JS davranışı.
{{sections}}

## Kurallar
1. Her HTML bölümü TAM OLARAK bir widget'a eşlenir. Bölüm atlama.
2. Widget adları `{{prefix}}-` ile başlar, kebab-case: `{{prefix}}-hero`, `{{prefix}}-features`.
3. Tekrar eden öğe (kart, liste, slide, SSS) varsa `repeater` alanını doldur: `{ "name": "items", "fields": [...] }`.
4. `js` alanı şunlardan biri: `none`, `slider`, `tabs`, `accordion`, `counter`, `sticky`, `modal`, `menu-toggle`, `custom`.
5. Bölüm Pro özelliği gerektiriyorsa `proReplacement` alanına Free çözümünü yaz (`cpt-layout`, `custom-sticky`, `custom-form`, `wp-query-list`, `custom-modal`, `shortcode-template`). Gerekmiyorsa `null`.
6. Header ve footer bölümleri de widget olur; `layout.header` ve `layout.footer` değeri `"widget"`.
7. Token'larda emin olmadığın değeri uydurma; ön analizde yoksa boş bırak.
8. Renk anahtarları Elementor Global'leriyle eşleşsin: `primary`, `secondary`, `text`, `accent`, gerekirse ek olarak `custom_1`, `custom_2`...
9. `files` listesi YAZMA; dosya listesini uygulama bölümlerden kendisi üretir.

## Şema
{
  "mode": "elementor-free",
  "theme": { "name": "{{name}}", "slug": "{{slug}}", "prefix": "{{prefix}}", "textdomain": "{{textdomain}}", "language": "{{language}}" },
  "tokens": {
    "colors": { "primary": "", "secondary": "", "text": "", "accent": "" },
    "fonts": { "heading": "", "body": "" },
    "spacing": [], "radius": [], "shadows": [],
    "breakpoints": { "tablet": 1024, "mobile": 767 }
  },
  "sections": [
    {
      "id": "",
      "htmlRef": "",
      "widget": "",
      "title": "",
      "contentControls": [],
      "styleControls": [],
      "repeater": null,
      "js": "none",
      "proReplacement": null
    }
  ],
  "layout": { "header": "widget", "footer": "widget" }
}
