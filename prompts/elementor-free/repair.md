# REPAIR — Doğrulamadan geçemeyen dosyayı düzelt

Aşağıdaki dosya otomatik doğrulamada hata verdi. Hataları düzelt, dosyanın geri kalanını DEĞİŞTİRME, işlevselliği azaltma, hiçbir bölümü kısaltma.

Dosya: `{{path}}`
Deneme: {{attempt}} / 2

## Hatalar
{{errors}}
<!-- Örnek: "php -l: Parse error: syntax error, unexpected '}' on line 142"
            "Yasaklı kalıp: _register_controls (satır 37)"
            "Önek eksik: global fonksiyon register_widgets()" -->

## Düzeltme ipuçları
- "Elementor'da olmayan sabit/metot": hata mesajındaki geçerli listeden birini kullan; yeni ad uydurma.
- "Menü Repeater'a gömülmüş" / "Liste içeriği gömülü": içeriği WordPress'ten oku (`{{prefix}}_render_menu`, `WP_Query`, `get_terms`); Repeater yalnızca yedek olsun.
- Hata dışındaki hiçbir şeyi (kontrol id'leri, sınıflar, CSS) değiştirme.

## Mevcut içerik
{{content}}

## Çıktı
YALNIZCA düzeltilmiş dosyanın TAM içeriği, şu biçimde:

<<<FILE {{path}}>>>
(tam içerik)
<<<END>>>
