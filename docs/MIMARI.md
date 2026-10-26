# LEGT AI (Libre Extra Gratis Theme AI) — Mimari ve Kurallar

LEGT AI, yerel LLM'ler (Ollama vb.) ile çalışan, açık kaynaklı ve ücretsiz bir WordPress tema üretici masaüstü uygulamasıdır. Kullanıcı örnek bir HTML verir, uygulama bunu analiz eder ve seçilen moda göre düzenlenebilir bir WordPress teması üretir.

---

## 🚀 Proje Özeti & Felsefesi

* **Proje Adı:** LEGT AI
* **Mimari:** Electron + Frontend (React/Fluent UI) + Node.js
* **Amaç:** Kullanıcının bilgisayarında yerel çalışan LLM'ler üzerinden, örnek HTML'den modern ve standartlara uygun WordPress temaları üretmek.
* **Üretim Modları:**
  1. **Block Theme (FSE):** `theme.json`, HTML blok şablonları, `functions.php`
  2. **Elementor Free:** Klasik tema + sürükle-bırak Elementor widget eklentisi (Elementor Pro gerektirmez)
* **Tasarım Dili:** Microsoft Fluent Design System (Acrylic / Mica efektleri, şeffaf katmanlar, modern masaüstü arayüzü).
* **Gizlilik & Özgürlük:** Tamamen yerel (offline-first), açık kaynak (GPLv3) ve ücretsiz. Hiçbir veri dışarı gönderilmez.

> Lisans notu: Üretilen WordPress temaları ve eklentileri WordPress gereği GPL uyumlu olmalı. Uygulama da GPLv3 seçilirse lisans tutarlılığı en basit haliyle sağlanır.

---

## 🛠️ Teknoloji Yığını (Tech Stack)

* **Desktop Framework:** Electron
* **Frontend:** React + Fluent UI (`@fluentui/react-components`) + Tailwind CSS
* **Dil:** TypeScript (main, preload ve renderer)
* **Local LLM Entegrasyonu:** Ollama API (`http://localhost:11434`) / OpenAI uyumlu yerel endpoint'ler (LM Studio, llama.cpp server vb.)
* **Dosya Yönetimi:** Node.js `fs` & `path` (yalnızca Electron IPC bridge üzerinden; renderer doğrudan dosya sistemine erişmez)
* **HTML Analizi:** `cheerio` veya `node-html-parser` (bölümlere ayırma, token çıkarma)
* **Paketleme:** `archiver` (tema ve eklentiyi ayrı .zip olarak)
* **Canlı test:** `playwright-core` + `runtime/` altında portable XAMPP (Apache, MariaDB, PHP), WordPress ve Elementor
* **WordPress Çıktı Standartları:**
  * Block mod: WP Block Theme (Gutenberg / Full Site Editing uyumlu)
  * Elementor mod: Klasik tema + Elementor 3.5+ Free uyumlu widget eklentisi

---

## 📂 Proje Dizin Yapısı

```
legt-ai/
├── electron/
│   ├── main.ts                 # Pencere, Mica/Acrylic, IPC kayıtları
│   ├── preload.ts              # contextBridge ile güvenli API
│   └── ipc/
│       ├── fs.ts               # Proje klasörü okuma/yazma (yalnızca izinli dizinler)
│       ├── llm.ts              # LLM çağrıları (stream, iptal)
│       ├── validate.ts         # php -l, JSON parse, yasaklı kalıp taraması
│       ├── package.ts          # zip üretimi
│       ├── wptest.ts           # canlı test: çalıştır, rapor, ekran görüntüsü, açık site
│       └── plugins.ts          # eklentileri yükle, aç/kapa, sağlayıcı listesi
├── core/
│   ├── llm/
│   │   ├── ollama.ts           # /api/chat, num_ctx, stream
│   │   └── openaiCompat.ts     # /v1/chat/completions
│   ├── html/
│   │   ├── siteFolder.ts       # public_html vb. klasörden HTML/CSS/JS toplar
│   │   ├── splitSections.ts    # HTML'i bölümlere ayırır (çok sayfalı girdide tekrarları tekilleştirir)
│   │   └── extractTokens.ts    # Renk, font, boşluk, breakpoint çıkarır (LLM'siz ön analiz)
│   ├── pipeline/
│   │   ├── analyze.ts          # ADIM 2: plan JSON'u
│   │   ├── generate.ts         # ADIM 3-5: dosya dosya üretim
│   │   ├── repair.ts           # Doğrulama hatasında düzeltme döngüsü
│   │   └── package.ts
│   ├── plugins/                # eklenti API'si (legtApi 1) ve yükleyici: sağlayıcı kaydı
│   ├── scaffold/               # LLM'siz, deterministik üretilen dosyalar
│   │   ├── block-theme/
│   │   └── elementor-free/
│   └── wptest/                 # ADIM 6b: canlı WordPress testi
│       ├── ports.ts            # rastgele boş port (20000-60999)
│       ├── runtime.ts          # XAMPP algılama, php.ini/httpd.conf/wp-config üretimi, Apache+MariaDB süreçleri
│       ├── browser.ts          # Playwright kontrolleri, Elementor editörü, senaryo yürütücü
│       ├── scenarios.ts        # LLM senaryo JSON dili (kod değil) + doğrulama
│       ├── attribute.ts        # PHP log / URL / yığın izi → üretilen dosya
│       ├── index.ts            # turlar: kur → test → LLM onarımı → tekrar test, gerilemede geri alma
│       └── php/                # setup.php (WP-CLI'siz kurulum), test mu-plugin'i
├── prompts/
│   ├── block-theme/
│   │   ├── system.md
│   │   ├── analyze.md
│   │   ├── file.md
│   │   ├── repair.md
│   │   ├── test-plan.md
│   │   └── test-repair.md
│   └── elementor-free/
│       ├── system.md           # Her çağrıda sabit: rol, Free kuralları, çıktı biçimi
│       ├── analyze.md          # ADIM 2: plan.json üretimi
│       ├── file.md             # ADIM 3-5: tek dosya üretimi (dosya türüne göre)
│       ├── repair.md           # ADIM 6: doğrulama hatası düzeltme
│       ├── test-plan.md        # ADIM 6b: etkileşim senaryoları (JSON)
│       └── test-repair.md      # ADIM 6b: canlı testte bulunan sorunu düzeltme
├── src/                        # React renderer
│   ├── pages/
│   │   ├── Intake.tsx          # HTML + marka bilgileri + mod seçimi
│   │   ├── Plan.tsx            # Analiz sonucu, düzenle/onayla
│   │   ├── Generate.tsx        # Dosya bazlı ilerleme, canlı log
│   │   ├── Test.tsx            # Canlı WordPress testi, turlar, ekran görüntüleri
│   │   └── Export.tsx          # Zip, klasörü aç, kurulum talimatı
│   ├── components/
│   ├── store/                  # Proje durumu (zustand vb.)
│   └── theme/                  # Fluent tema, Mica uyumlu arka planlar
├── runtime/                    # Portable XAMPP, WordPress, Elementor (git'te yalnızca manifest.json + README)
└── projects/                   # Kullanıcı projeleri (plan.json, çıktı dosyaları, log, test/)
```

---

## 🔁 Üretim Pipeline'ı

Sohbet tabanlı "devam yaz" akışı yerine uygulama adımları kendisi yönetir. Yerel modellerin bağlamı küçük olduğu için **her LLM çağrısı tek bir işe** odaklanır.

### ADIM 1 — Intake (LLM yok)
Kullanıcıdan alınır:
* Örnek HTML (yapıştır, dosya seç ya da **site klasörü seç**: `public_html` / `dist` gibi bir klasördeki tüm sayfalar + CSS/JS; `core/html/siteFolder.ts` — index önce, en fazla 25 sayfa, hazır kütüphaneler ve `node_modules`/`wp-*` klasörleri atlanır, WordPress kurulumu seçilirse uyarır)
* Tema adı, slug, önek (ör. `trk`). Önek tüm fonksiyon, class, handle ve text domain'lerde kullanılır. Doğrulama: `^[a-z][a-z0-9_]{1,9}$`
* Dil, ek istekler (blog, WooCommerce, çok sayfa)
* Mod: Block Theme veya Elementor Free

Ardından `splitSections.ts` HTML'i bölümlere ayırır, `extractTokens.ts` renk/font/boşluk değerlerini çıkarır. Bu ön analiz LLM'e verilecek bağlamı küçültür.

### ADIM 2 — Analiz (LLM, JSON çıktı)
* Ollama'da `format: "json"` kullanılır.
* LLM'e: ön analiz token'ları + bölüm özetleri (tam HTML değil) gider.
* Çıktı `plan.json` şemasına uymalı (aşağıda). Uymazsa en fazla 2 kez hata mesajıyla tekrar istenir.
* Plan `Plan.tsx` ekranında tablo olarak gösterilir. Kullanıcı widget adlarını, kontrolleri, dosya listesini düzenleyip **onaylamadan** üretim başlamaz.

### ADIM 3-5 — Dosya üretimi
* `plan.files` listesi bağımlılık sırasıyla işlenir. **Her dosya = bir LLM çağrısı.**
* **Paralel ajanlar:** bağımlılıkları (`dependsOn`) tamamlanmış dosyalar aynı anda en fazla N çağrıyla üretilir (`core/pool.ts`). N, Ayarlar > Paralel ajan: min 1, max 10, varsayılan 3. Canlı testte senaryo yazımı ve dosya onarımları da aynı sınırla paraleldir. Ollama'da gerçek paralellik için `OLLAMA_NUM_PARALLEL` ≥ N olmalı. `ProjectStore` aynı dosyaya (state.json, log numarası) yazımları sıraya koyar.
* Her çağrıya giden bağlam: system prompt + plan.json'un ilgili kısmı + o dosyanın ilgili HTML bölümü + bağımlı olduğu daha önce üretilmiş dosyaların imzaları (tam içerik değil).
* `core/scaffold/` altındaki deterministik dosyalar LLM'e hiç gönderilmez, şablondan doldurulur (aşağıya bak).
* LLM çıktısı şu işaretçiler arasında beklenir, dışındaki her şey atılır:
  ```
  <<<FILE trk-theme/functions.php>>>
  ...dosya içeriği...
  <<<END>>>
  ```
  (Kod JSON içine gömülmez; kaçış karakteri hataları yerel modellerde çok sık.)

### ADIM 6 — Doğrulama & Onarım
Her dosya üretildikten hemen sonra:
* PHP: sistemde `php` varsa `php -l`; yoksa en azından açılış etiketi ve parantez dengesi kontrolü
* JSON (theme.json, Elementor şablonları): `JSON.parse`
* Yasaklı kalıp taraması: `// ...`, `diğer kodlar`, `_register_controls`, `Scheme_Color`, `Scheme_Typography`, `ElementorPro\`, `TODO`
* Önek kontrolü: global fonksiyon ve class'lar önekle başlıyor mu
* Block Theme moduna özel:
  * Her `<!-- wp:x {...} -->` yorumundaki JSON `JSON.parse` ile geçerli olmalı
  * Açılan her blok `<!-- /wp:x -->` ile kapanmalı (yığın tabanlı denge kontrolü)
  * `templates/*.html` ve `parts/*.html` içinde PHP olmamalı
  * Pattern dosyalarında `Title:` ve `Slug:` başlığı bulunmalı
  * Blok işaretlemesinde ham hex renk olmamalı (yalnızca `theme.json` içinde serbest)
* Hata varsa `repair.ts`: dosya + hata mesajı LLM'e geri verilir, en fazla 2 deneme. Hâlâ hatalıysa dosya kırmızı işaretlenir, kullanıcı manuel düzeltme veya yeniden üretim seçer.

### ADIM 6b — Canlı test (son kontrol)
Statik doğrulama kodun *derlendiğini*, canlı test *çalıştığını* gösterir. `core/wptest/`:
* **Ortam:** `runtime/` altındaki portable XAMPP (`npm run setup:runtime` indirir). Her test rastgele iki portla (HTTP, MariaDB), şablondan kopyalanan temiz bir veri klasörüyle ve kendi `php.ini`/`httpd.conf`'uyla başlar. Site geçici klasörde kurulur (senkron klasörlere binlerce dosya yazılmaz). Çevrim dışı: `WP_HTTP_BLOCK_EXTERNAL`, tarayıcıda dış istekler engellenir.
* **Kurulum:** `php/setup.php` WP-CLI'siz kurar; Elementor modunda içerik widget'ları test sayfasına, header/footer widget'ları `{prefix}_layout` kayıtlarına konur ve Customizer'da seçilir. Block modda her pattern işaretli bir `core/group` içinde test sayfasına konur.
* **Playwright (deterministik):** HTTP durumu, PHP hataları (`debug.log`), JS/konsol hataları, 404 dosyalar, bölüm render edildi mi / boş mu, örnek HTML başlıkları görünüyor mu, tablet/mobilde yatay taşma, `wp_head`/`wp_body_open`/`wp_footer` çağrısı, Elementor editör önizlemesi.
* **Seçili LLM:** JS davranışı olan bölümler için `test-plan.md` ile senaryo yazar. Model kod değil, `scenarios.ts`'teki küçük JSON dilini üretir; seçicisi DOM'da olmayan senaryo atlanır (onarım tetiklemez).
* **Onarım:** Sorunlar `attribute.ts` ile dosyalara bağlanır (log yolu, URL, yığın izi, bölüm kimliği). Hatası olan her LLM dosyası `test-repair.md` ile onarılır, statik doğrulamadan geçmezse yazılmaz. Site yeniden kurulup test tekrarlanır (`rounds`, varsayılan 2). Bir onarım hata sayısını artırırsa yedekten geri alınır. Scaffold dosyalarına bağlanan sorunlar yalnızca raporlanır.
* **Çıktı:** `projects/{id}/test/report.json`, `test/shots/*.png`, `test/scenarios.json`, `test/backup/round-N/`. Export kalite listesinde "Canlı WordPress testi" maddesi olarak görünür.

### ADIM 7 — Paketleme
* Tema ve eklenti **ayrı** zip (`{slug}-theme.zip`, `{slug}-elementor-widgets.zip`)
* README.md ve kurulum adımları zip içinde

---

## 🧱 Deterministik Scaffold (LLM'e üretilmeyecek dosyalar)

Yerel modellerde kaliteyi en çok artıran şey, tasarıma bağlı olmayan dosyaları şablondan üretmektir. `{{prefix}}`, `{{slug}}`, `{{name}}`, `{{textdomain}}` yer tutucularıyla:

**Elementor Free modu:**
* Eklenti ana dosyası: Elementor yüklü mü, min. 3.5 sürüm, PHP 7.4+ kontrolleri ve admin uyarıları
* Widget kayıt sınıfı (`elementor/widgets/register`, özel kategori), widget dosyalarını `plan.widgets` listesinden otomatik dahil eder
* `{prefix}_layout` CPT'si + `add_post_type_support($cpt, 'elementor')`
* Customizer: "Aktif Header / Footer" seçimi, Ek CSS alanı
* Demo içe aktarıcı (`includes/demo-import.php` + plan token'larından `includes/demo-data.php`): Görünüm > {Tema} Demo sayfası, etkinleştirme bildirimi ve `wp {prefix} demo-import`. `demo/home.json` → statik ön sayfa, `header/footer.json` → layout + Customizer seçimi, ana menü, Elementor kit global renk/font'ları. Tekrar çalıştırılabilir; eksik/yinelenen Elementor id'lerini onarır, bilinmeyen widget'ları raporlar. Canlı test bu içe aktarıcıyı çalıştırıp demo sayfasını da gezer.
* `[{prefix}_template id="x"]` shortcode'u
* Tema: `style.css` başlığı, `index.php`, `404.php`, `search.php`, Elementor Canvas / Full Width şablonları, eklenti yoksa admin uyarısı

**Block Theme modu:**
* `style.css` başlığı, temel `functions.php` (enqueue, text domain), `index.html` iskeleti, `parts/` klasör yapısı

LLM yalnızca tasarıma bağlı dosyaları üretir: token CSS'i / `theme.json`, header/footer, widget'lar (PHP + CSS + JS), blok şablonları, demo JSON'ları.

---

## 📐 plan.json Şeması (özet)

```json
{
  "mode": "elementor-free",
  "theme": { "name": "", "slug": "", "prefix": "", "textdomain": "", "language": "tr" },
  "tokens": {
    "colors": { "primary": "#000000" },
    "fonts": { "heading": "", "body": "" },
    "spacing": [], "radius": [], "shadows": [],
    "breakpoints": { "tablet": 1024, "mobile": 767 }
  },
  "sections": [
    {
      "id": "hero",
      "htmlRef": "section-2",
      "widget": "trk-hero",
      "contentControls": ["title", "subtitle", "button_text", "button_url", "image"],
      "styleControls": ["typography", "background", "padding"],
      "repeater": null,
      "js": "none",
      "proReplacement": null
    }
  ],
  "layout": { "header": "widget", "footer": "widget" },
  "files": [
    { "path": "trk-elementor-widgets/widgets/class-hero.php", "source": "llm", "dependsOn": [], "sectionId": "hero" },
    { "path": "trk-elementor-widgets/trk-elementor-widgets.php", "source": "scaffold" }
  ]
}
```

---

## 🤖 LLM Entegrasyonu Kuralları

* Varsayılan sıcaklık: analiz `0.1`, kod `0.2`
* Ollama `num_ctx` model izin verdiği kadar yükseltilir (en az 8192 önerilir); kullanıcı ayarlardan değiştirebilir
* Önerilen model sınıfı: kod odaklı, 7B ve üzeri modeller (örn. Qwen Coder ailesi). 3B altı modeller için uyarı gösterilir.
* Tüm çağrılar stream edilir, `Generate.tsx`'te canlı gösterilir ve iptal edilebilir (AbortController)
* Her çağrı `projects/{id}/log/` altına kaydedilir (prompt + yanıt), hata ayıklama için
* Prompt dosyaları `prompts/` altında düz Markdown; uygulama `{{değişken}}` yer tutucularını doldurur. Promptlar kod içine gömülmez ki topluluk kolayca geliştirebilsin.
* Her çağrı = `system.md` (system mesajı) + `analyze.md` / `file.md` / `repair.md` (user mesajı). Sohbet geçmişi tutulmaz, her çağrı bağımsızdır.
* Yer tutucular: `{{name}} {{slug}} {{prefix}} {{Prefix}} {{textdomain}} {{language}} {{path}} {{fileKind}} {{tokens}} {{section}} {{sectionHtml}} {{dependencySignatures}} {{widgetName}} {{WidgetClass}} {{tabletBp}} {{mobileBp}} {{requests}} {{sections}} {{errors}} {{content}} {{attempt}}`; canlı testte ek olarak `{{renderedHtml}}` (bölümün canlı sitedeki DOM'u) ve `{{js}}` (planlanan JS davranışı). Doldurulmamış `{{...}}` kalırsa çağrı yapılmaz, hata loglanır.
* `{{dependencySignatures}}` `core/pipeline/generate.ts` tarafından çıkarılır: PHP'den class/fonksiyon adları, CSS'ten kök sınıflar, JS'ten handle adı. Tam dosya içeriği gönderilmez.

### Eklentiler
* Eklenti = `plugin.json` (`id`, `name`, `version`, `main`, `legtApi: 1`) + ESM `main` dosyası, `export function activate(ctx)`. Şimdilik tek uzantı noktası `ctx.registerProvider({ id, label, defaultBaseUrl, apiKey, remote, create(settings) → LLMProvider })`.
* Konum: kullanıcı veri klasöründe `plugins/` (kaynak koda girmez); geliştirirken `LEGT_PLUGINS_DIR`. Yeni bulunan eklenti **kapalı** başlar, Ayarlar > Eklentiler'den açılır (ana süreçte tam yetkiyle çalıştığı için).
* `remote: true` sağlayıcı seçilince Ayarlar'da "veri bilgisayardan çıkar" uyarısı gösterilir; offline-first ilkesi gereği bulut sağlayıcıları çekirdeğe değil eklentiye konur.
* API anahtarları `settings.json`'a düz yazılmaz: Electron `safeStorage` (Windows DPAPI / macOS Keychain) ile şifrelenir.

---

## 🧩 Elementor Free Kuralları (prompts/elementor-free için temel)

Elementor Pro'nun **olmadığı** varsayılır. Pro'ya özel hiçbir özelliğe bağımlılık olamaz; Pro yüklüyse ek özellikler kendiliğinden aktifleşebilir.

| Pro özelliği | Free çözümü |
|---|---|
| Theme Builder (header/footer/single/archive) | `{prefix}_layout` CPT + Customizer'dan seçim; tema `get_builder_content_for_display($id)` ile basar, seçim yoksa PHP fallback |
| Sticky / Motion Effects | Header widget'ında "Sticky" switcher'ı + kendi JS'i |
| Form widget | Kendi form widget'ı (nonce + `admin-post.php` + `wp_mail`) + CF7 shortcode seçeneği |
| Posts / Loop Grid | `WP_Query` kullanan "Yazı Listesi" widget'ı |
| Popup | Kendi modal widget'ı |
| Template widget | `[{prefix}_template id="x"]` shortcode'u |
| Custom CSS sekmesi | Widget'ta "Ek CSS sınıfı" kontrolü + Customizer Ek CSS |
| Dynamic Tags | `'dynamic' => ['active' => true]` eklenir ama widget onsuz da tam çalışır |

Widget gereksinimleri:
* Güncel API: `register_controls()`, `render()`, `content_template()`. Deprecated `_register_controls`, `Scheme_*` yasak.
* İçerik: MEDIA, URL, ICONS, TEXT/WYSIWYG, listeler için Repeater
* Stil: Typography, Background, Border, Box_Shadow group control'leri; `selectors` ile renk/boşluk
* `add_responsive_control` ile padding, margin, hizalama, kolon sayısı
* Renk/tipografi varsayılanları Global'lere bağlı (`Global_Colors`, `Global_Typography`)
* Varsayılan değerler örnek HTML içeriğiyle dolu; widget sürüklenince birebir görünmeli
* Asset'ler `get_style_depends()` / `get_script_depends()` ile yalnızca kullanılınca yüklenir
* JS: `elementorFrontend.hooks.addAction('frontend/element_ready/{widget}.default', ...)`, editörde yeniden render'da da çalışır, mümkünse vanilla JS, slider için Elementor'un Swiper'ı
* Tüm çıktılar escape edilir (`esc_html`, `esc_url`, `esc_attr`, `wp_kses_post`), tüm stringler çevrilebilir

Tema gereksinimleri:
* `add_theme_support`: title-tag, post-thumbnails, custom-logo, html5, responsive-embeds
* Token'lar `:root` CSS değişkeni, Elementor Global'leriyle fallback'li eşleşme: `var(--e-global-color-primary, #xxxxxx)`
* Elementor kapalıyken site çökmez

Demo:
* Ana sayfa, header, footer için Elementor şablon JSON'ları (yalnızca Free ve kendi widget'ları)
* README: tema yükle → Elementor'u kur → eklenti yükle → Görünüm > {Tema} Demo > içe aktar (elle kurulum alternatif olarak anlatılır)

---

## ✅ Kalite Kontrol Listesi (her üretim sonunda Export ekranında gösterilir)

* [ ] Tüm HTML bölümleri bir widget/blok şablonuna dönüştü
* [ ] Koda gömülü metin, görsel, renk kalmadı
* [ ] Elementor modunda Pro bağımlılığı yok
* [ ] Deprecated API yok
* [ ] Tüm PHP dosyaları `php -l`'den geçti, tüm JSON'lar parse ediliyor
* [ ] Escape ve çeviri fonksiyonları eksiksiz
* [ ] Önek tüm global isimlerde kullanılmış
* [ ] Canlı WordPress testi (Playwright) geçti

---

## 🧑‍💻 Geliştirme Kuralları

* Renderer'da Node API kullanma; her şey `preload.ts` üzerinden tipli IPC ile
* `contextIsolation: true`, `nodeIntegration: false`, dosya yazma yalnızca `projects/` ve kullanıcının seçtiği export klasörüne
* LLM sağlayıcısı arayüzü (`LLMProvider`) soyut kalsın; Ollama ve OpenAI uyumlu endpoint aynı arayüzü uygular
* Canlı test süreçleri (Apache, MariaDB, tarayıcı) uygulama kapanınca kapanır (`before-quit`); `runtime/` ikilileri git'e girmez
* Pipeline adımları UI'dan bağımsız (`core/`) ve test edilebilir olsun; her adım `plan.json` ve proje klasörü üzerinden durum tutar, uygulama kapanıp açılınca kaldığı dosyadan devam edebilir
* Fluent UI bileşenleri öncelikli; Tailwind yalnızca yerleşim ve boşluk için
* Yeni üretim modu eklemek = `prompts/{mod}/` + `core/scaffold/{mod}/` + plan şemasına mod alanı
