# REPAIR — Doğrulamadan geçemeyen dosyayı düzelt

Aşağıdaki dosya otomatik doğrulamada hata verdi. Hataları düzelt, dosyanın geri kalanını DEĞİŞTİRME, işlevselliği azaltma, hiçbir bölümü kısaltma.

Dosya: `{{path}}`
Deneme: {{attempt}} / 2

## Hatalar
{{errors}}
<!-- Örnek: "php -l: Parse error: syntax error, unexpected '}' on line 142"
            "Yasaklı kalıp: _register_controls (satır 37)"
            "Önek eksik: global fonksiyon register_widgets()" -->

## Mevcut içerik
{{content}}

## Çıktı
YALNIZCA düzeltilmiş dosyanın TAM içeriği, şu biçimde:

<<<FILE {{path}}>>>
(tam içerik)
<<<END>>>
