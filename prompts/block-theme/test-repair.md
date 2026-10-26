# TEST REPAIR — Canlı WordPress testinde bulunan sorunları düzelt

<!-- Canlı test (portable XAMPP + WordPress + Playwright) bu dosyaya bağlanan sorunları buldu. Örnek {{errors}}:
       1. [render] turkuaz/hero sayfada render edilmedi
       2. [content] turkuaz/hero: örnek HTML'deki başlıkların hiçbiri görünmüyor
       3. [overflow] mobile (390px): yatay taşma, sayfa 512px genişliğinde
       4. [console] JS hatası: Cannot read properties of null (reading 'addEventListener') -->

Aşağıdaki dosya statik doğrulamadan geçti ama **gerçek bir WordPress {{name}} sitesinde** (blok teması, Full Site Editing) test edilince sorun çıkardı. Sorunların kök nedenini bul ve dosyayı düzelt.

Dosya: `{{path}}` ({{fileKind}})
Onarım turu: {{attempt}}

## Bulunan sorunlar
{{errors}}

## Bu bölümün canlı sitede render edilmiş HTML'i
{{renderedHtml}}

## Örnek HTML (hedef görünüm)
{{sectionHtml}}

## Bağımlı dosyaların imzaları
{{dependencySignatures}}

## Mevcut içerik
{{content}}

## Kurallar
- Yalnızca listelenen sorunları çöz; pattern slug'ını, `className`'leri ve preset slug'larını DEĞİŞTİRME (diğer dosyalar bunlara bağlı).
- Blok işaretlemesi geçerli kalmalı: her `<!-- wp:x {...} -->` JSON'u geçerli, her blok kapanıyor, ham hex renk yok.
- Taşma sorunlarında: sabit genişlik yerine `max-width: 100%`, `flex-wrap`, `minmax(0, 1fr)`; `{{tabletBp}}px` ve `{{mobileBp}}px` medya sorgularını kullan.
- JS sorunlarında: eleman yoksa sessizce çık (`if (!el) return;`), her bölüm örneği için ayrı çalış (`querySelectorAll('.{{prefix}}-...')`).
- `[scenario]` sorunu testin kendisinin yanlış olmasından kaynaklanıyor olabilir. Kod örnek HTML'deki davranışı zaten doğru yapıyorsa dosyayı AYNEN geri döndür.
- Dosyanın geri kalanını kısaltma; `// ...`, TODO, yer tutucu YASAK.

## Çıktı
YALNIZCA düzeltilmiş dosyanın TAM içeriği, şu biçimde:

<<<FILE {{path}}>>>
(tam içerik)
<<<END>>>
