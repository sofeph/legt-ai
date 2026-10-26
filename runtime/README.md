# runtime/ — taşınabilir canlı test ortamı

LEGT AI'nin son kontrol adımı (Test ekranı) üretilen temayı gerçek bir WordPress'e kurup Playwright ile test eder. Gereken her şey bu klasörde durur; sisteme hiçbir şey kurulmaz, kullanıcının kendi XAMPP'ına, 80/3306 portlarına ya da `xampp-control` ayarlarına dokunulmaz.

```bash
npm run setup:runtime                 # hepsini indir (XAMPP ~226 MB, WordPress, Elementor, Chromium)
npm run setup:runtime -- --no-browser # Chromium yerine sistemdeki Edge / Chrome kullanılır
npm run setup:runtime -- --force      # sürüm değiştiyse yeniden kur (manifest.json)
```

| Klasör | İçerik |
|---|---|
| `xampp/` | Portable XAMPP (Apache, MariaDB, PHP). Gereksiz bileşenler (Tomcat, Perl, phpMyAdmin…) açılırken atlanır |
| `mysql-data-template/` | Bozulmamış MariaDB veri klasörü; her test bunun kopyasıyla başlar |
| `wordpress/` | WordPress çekirdeği |
| `plugins/elementor/` | Elementor (ücretsiz) |
| `browsers/` | Playwright Chromium (isteğe bağlı) |
| `.cache/` | İndirilen zip'ler |

Yalnızca `manifest.json` ve bu dosya git'e girer; ikili dosyalar `.gitignore`'dadır.

## Bir test nasıl çalışır

1. **Rastgele portlar:** 20000–60999 aralığından boş iki port seçilir (HTTP ve MariaDB). Çakışma olursa yeni portlarla tekrar denenir.
2. **İzole site:** Site, veritabanı ve loglar işletim sisteminin geçici klasöründe (`%TEMP%/legt-ai-wptest/{proje}`) tutulur; binlerce WordPress dosyası OneDrive gibi senkron klasörlere yazılmaz. `php.ini` ve `httpd.conf` her test için üretilir.
3. **Kurulum:** `core/wptest/php/setup.php` (WP-CLI gerekmez) veritabanını sıfırlar, WordPress'i kurar, temayı ve eklentileri etkinleştirir, tüm bölümleri içeren bir test sayfası oluşturur. Site çevrim dışıdır (`WP_HTTP_BLOCK_EXTERNAL`, tarayıcıda dış istekler engellenir).
4. **Playwright:** masaüstü / tablet / mobilde ana sayfa, test sayfası, yazı, arama ve 404 gezilir; PHP hataları, JS hataları, 404 dosyalar, boş ya da hiç render edilmeyen bölümler, örnek HTML'deki başlıkların görünmemesi, yatay taşma, `wp_head`/`wp_footer` eksikliği ve (Elementor modunda) editörün açılıp açılmadığı kontrol edilir.
5. **Seçili model:** JS davranışı olan her bölüm için etkileşim senaryoları yazar (JSON; kod çalıştırılmaz). Her sorun ilgili dosyaya bağlanır ve model dosyayı onarır; site yeniden kurulup test tekrarlanır. Bir onarım sorunları artırırsa geri alınır.

## Windows dışı sistemler

Portable XAMPP yalnızca Windows için var. Linux / macOS'ta Apache 2.4, MariaDB ve PHP 8 (mysqli, mbstring, gd, intl…) kurup `apache/bin/httpd`, `mysql/bin/mysqld`, `php/php` düzeninde bir klasörü `LEGT_XAMPP_DIR` ortam değişkeniyle gösterin; WordPress ve Elementor yine `npm run setup:runtime` ile iner.

## Paketlenmiş uygulama

Kurulu LEGT AI, `runtime/` klasörünü uygulamanın (`LEGT AI.exe`) yanında arar; başka bir yer için `LEGT_RUNTIME_DIR`. Aynı betik `LEGT_RUNTIME_DIR` ile o klasöre kurulum yapabilir.
