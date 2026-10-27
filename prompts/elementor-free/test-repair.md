# TEST REPAIR — Canlı WordPress testinde bulunan sorunları düzelt

<!-- Canlı test (portable XAMPP + WordPress + Elementor + Playwright) bu dosyaya bağlanan
     sorunları buldu. Örnek {{errors}}:
       1. [php] PHP fatal: Uncaught Error: Class "Elementor\Group_Control_Typography" not found ...
       2. [render] trk-hero sayfada render edilmedi (kayıt, get_name() ya da render() hatası)
       3. [overflow] mobile (390px): yatay taşma, sayfa 512px genişliğinde — trk-hero
       4. [scenario] trk-faq — "Soru açılır" adım 2 başarısız: expect attr ... → aria-expanded="false" -->

Aşağıdaki dosya statik doğrulamadan geçti ama **gerçek bir WordPress {{name}} sitesinde** (Elementor Free, Pro yok) test edilince sorun çıkardı. Sorunların kök nedenini bul ve dosyayı düzelt.

Dosya: `{{path}}` ({{fileKind}})
Widget: `{{widgetName}}` — sınıf: `{{WidgetClass}}`
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
- İçeriği asla koda gömerek "düzeltme": yazı/kategori/menü içeriği WordPress'ten (WP_Query, get_terms, `{{prefix}}_render_menu`) okunmaya devam etsin; yazı yoksa boş durum mesajı bas. Metin varsayılanları yalnızca Elementor kontrolünde olsun.
- Görünüm sorunlarında kaynak HTML'e (yukarıdaki "Örnek HTML") yaklaş: sınıf adlarını, yapıyı ve CSS değerlerini değiştirerek kaynaktan uzaklaşma.
- Yalnızca listelenen sorunları çöz; çalışan davranışı, kontrol id'lerini, sınıf ve handle adlarını DEĞİŞTİRME (diğer dosyalar bunlara bağlı).
- Taşma sorunlarında: sabit genişlik yerine `max-width: 100%`, `flex-wrap`, `minmax(0, 1fr)`, uzun kelimeler için `overflow-wrap: anywhere`; `{{tabletBp}}px` ve `{{mobileBp}}px` medya sorgularını kullan.
- JS sorunlarında: `elementorFrontend.hooks.addAction('frontend/element_ready/{{widgetName}}.default', ...)` içinde, kök elemana göre seç; editörde yeniden render'da da çalışsın.
- `[scenario]` sorunu testin kendisinin yanlış olmasından kaynaklanıyor olabilir. Kod örnek HTML'deki davranışı zaten doğru yapıyorsa dosyayı AYNEN geri döndür.
- Dosyanın geri kalanını kısaltma; `// ...`, TODO, yer tutucu YASAK.

## Çıktı
YALNIZCA düzeltilmiş dosyanın TAM içeriği, şu biçimde:

<<<FILE {{path}}>>>
(tam içerik)
<<<END>>>
