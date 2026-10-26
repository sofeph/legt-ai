# TEST PLAN — Bölüm için etkileşim senaryoları (JSON)

<!-- Uygulama bu prompt'u canlı testte, JS davranışı olan her pattern / template part için bir kez çağırır.
     Model Playwright kodu yazmaz; yalnızca aşağıdaki JSON dilini üretir, uygulama yorumlar. -->

Bu çağrıda dosya ÜRETME. Aşağıdaki bölüm gerçek bir WordPress blok teması sitesinde render edildi. Görevin, bölümün JS davranışının ("{{js}}", tema JS'i: `{{path}}`) çalıştığını doğrulayan **2-4 kısa senaryo** yazmak.

## Plan bilgisi
{{section}}

## Render edilmiş HTML (canlı sitedeki DOM, bölüm kökü)
{{renderedHtml}}

## Kurallar
- Seçiciler bölüm köküne GÖRE yazılır ve YALNIZCA yukarıdaki HTML'de gerçekten bulunan sınıf/eleman/öznitelikleri kullanır. Kökün kendisi için `"&"`.
- Uydurma seçici yazma; HTML'de olmayan bir sınıf varsa senaryo atlanır.
- Her senaryo bağımsızdır (sayfa her senaryodan önce yeniden yüklenir) ve en az bir `expect` içerir.
- Yalnızca JS'in yaptığı davranışı test et (slider, sayaç, sticky, aç/kapa...). `core/navigation` bloğunun kendi mobil menüsünü test etme.
- Yalnızca küçük ekranda görünen davranış için önce `{"do":"viewport","name":"mobile"}`.

## İzinli adımlar
Eylemler:
- `{"do":"click","selector":"..."}` · `{"do":"hover","selector":"..."}` · `{"do":"focus","selector":"..."}`
- `{"do":"fill","selector":"...","value":"..."}` · `{"do":"press","key":"Enter|Escape|Tab|Space|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End"}`
- `{"do":"wait","ms":500}` (en fazla 2000) · `{"do":"viewport","name":"desktop|tablet|mobile"}`

Beklentiler (her biri 3 sn'ye kadar bekler):
- `{"expect":"visible","selector":"..."}` · `{"expect":"hidden","selector":"..."}` · `{"expect":"exists","selector":"..."}`
- `{"expect":"class","selector":"...","contains":"is-active"}` (sınıf listesinde tam sınıf adı)
- `{"expect":"attr","selector":"...","name":"aria-expanded","contains":"true"}`
- `{"expect":"text","selector":"...","contains":"..."}` · `{"expect":"count","selector":"...","min":2}`

## Önceki denemenin hataları
{{errors}}

## Çıktı
YALNIZCA şu biçimde geçerli JSON:

{"scenarios":[{"name":"Slider sonraki slayta geçer","steps":[{"do":"click","selector":".{{prefix}}-slider__next"},{"expect":"class","selector":".{{prefix}}-slider__slide:nth-child(2)","contains":"is-active"}]}]}
