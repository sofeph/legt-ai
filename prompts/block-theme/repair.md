# REPAIR — Doğrulamadan geçemeyen dosyayı düzelt (Block Theme)

Aşağıdaki dosya otomatik doğrulamada hata verdi. Hataları düzelt, dosyanın geri kalanını DEĞİŞTİRME, işlevselliği azaltma, hiçbir bölümü kısaltma.

Dosya: `{{path}}`
Deneme: {{attempt}} / 2

## Hatalar
{{errors}}
<!-- Örnek: "theme.json: JSON.parse hatası, satır 48: Unexpected token }"
            "Blok yorumu JSON'u geçersiz: <!-- wp:group {\"layout\":{type:\"constrained\"}} -->"
            "Açılan blok kapanmadı: wp:columns (satır 12)"
            "Ham hex renk kullanılmış: #1a1a2e (satır 30), preset slug'ı kullan"
            "Template içinde PHP bulundu: templates/index.html" -->

## Mevcut içerik
{{content}}

## Çıktı
YALNIZCA düzeltilmiş dosyanın TAM içeriği, şu biçimde:

<<<FILE {{path}}>>>
(tam içerik)
<<<END>>>
