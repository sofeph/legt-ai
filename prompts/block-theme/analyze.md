# ANALYZE — Block Theme plan çıkarımı

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
1. Header bölümü → `parts/header.html`, footer bölümü → `parts/footer.html`. Diğer her bölüm TAM OLARAK bir pattern'e eşlenir.
2. Pattern slug'ı `{{slug}}/{ad}`, dosyası `patterns/{ad}.php`. `{ad}` kebab-case.
3. `blocks` alanına bölümün kurulacağı ana çekirdek blokları yaz (ör. `["core/cover","core/heading","core/buttons"]`). Yalnızca system prompt'taki listedekileri kullan.
4. Yazı/kart listeleri, kategori listeleri ve menüler elle çoğaltılmaz: `core/query` + `core/post-template` ya da `core/navigation` / `core/categories` ile kurulur (`blocks` alanına bunları yaz, `repeat` verme). `repeat` yalnızca WordPress'te karşılığı olmayan içerik için.
4a. Tekrar eden öğe (kart, liste, SSS) varsa `repeat` alanını doldur: `{ "count": 3, "block": "core/column" }`. SSS için `core/details` kullan.
5. `js` alanı şunlardan biri: `none`, `slider`, `counter`, `sticky`, `menu-toggle`, `custom`. `none` değilse `className` alanına `{{prefix}}-{ad}` yaz.
6. Token'larda emin olmadığın değeri uydurma; ön analizde yoksa boş bırak.
7. Renk slug'ları: `base`, `contrast`, `primary`, `secondary`, `accent`, gerekirse `muted`, `surface`. Font slug'ları: `heading`, `body`.
8. Blog veya çok sayfa istendiyse `templates` listesine `single`, `archive`, `page`, `search`, `404` ekle; `index` ve `front-page` her zaman var.
9. `files` listesi YAZMA; dosya listesini uygulama bölümlerden kendisi üretir.

## Şema
{
  "mode": "block-theme",
  "theme": { "name": "{{name}}", "slug": "{{slug}}", "prefix": "{{prefix}}", "textdomain": "{{textdomain}}", "language": "{{language}}" },
  "tokens": {
    "colors": { "base": "", "contrast": "", "primary": "", "secondary": "", "accent": "" },
    "fonts": { "heading": "", "body": "" },
    "fontSizes": [],
    "spacing": [], "radius": [], "shadows": [],
    "contentWidth": "", "wideWidth": ""
  },
  "sections": [
    {
      "id": "",
      "htmlRef": "",
      "kind": "pattern",
      "slug": "",
      "title": "",
      "blocks": [],
      "repeat": null,
      "js": "none",
      "className": null
    }
  ],
  "templates": ["index", "front-page"]
}
