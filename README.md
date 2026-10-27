# LEGT AI — Libre Extra Gratis Theme AI

Yerel LLM'ler (Ollama, LM Studio, llama.cpp…) ile örnek HTML'den WordPress teması üreten, açık kaynak ve ücretsiz masaüstü uygulaması. Hiçbir veri dışarı gönderilmez.

Üretim modları: **Block Theme (FSE)** ve **Elementor Free** (klasik tema + Pro gerektirmeyen widget eklentisi).

## Hızlı başlangıç

| Sistem | Komut |
|---|---|
| Linux / macOS | `./start.sh` |
| Windows | `start.bat` (çift tıkla) |

Başlatıcı Node 20+ kontrolü yapar, bağımlılıkları kurar, Ollama yoksa onay alarak kurar (Linux: resmi betik, macOS: Homebrew, Windows: winget ya da resmi yükleyici), servisi başlatır ve kod modeli yoksa `qwen2.5-coder:7b` indirmeyi önerir. Komutlar: `dev` (varsayılan), `build`, `preview`, `test`, `typecheck`. Soruları otomatik onaylamak için `--yes`.

## Geliştirme

```bash
npm install
npm run dev        # Electron + Vite (HMR)
npm test           # vitest — core/ birim testleri
npm run typecheck
npm run build
```

Gereksinimler: Node 20+, yerel bir LLM sunucusu (varsayılan `http://localhost:11434`). Kod odaklı 7B+ model önerilir (ör. Qwen Coder ailesi). Sistemde `php` varsa (ya da `runtime/` kuruluysa portable XAMPP'ın PHP'si) üretilen dosyalar `php -l` ile de doğrulanır.

## Kaynak seçme

Örnek tasarım üç yoldan verilebilir: HTML'i yapıştırmak, dosya seçmek ya da **public_html klasörü seçmek**. Klasör seçilince içindeki sayfalar (alt klasörler dahil, en fazla 25), CSS, JS ve medya dosyaları (görsel/video; WordPress kurulumunda `wp-content/uploads`) toplanır. Medya temaya paketlenir, Elementor modunda demo içe aktarılırken Medya Kütüphanesi'ne de eklenir; jQuery/Bootstrap gibi hazır kütüphaneler ve `node_modules`, `.git`, `wp-*` klasörleri atlanır. Sayfalar arasında tekrar eden header/footer bir kez sayılır. Seçilen klasör bir WordPress kurulumuysa (PHP), sayfaları tarayıcıda "Farklı kaydet" ile almanız önerilir.

## Eklentiler

LEGT AI eklentilerle genişletilebilir; şimdilik eklentiler yeni LLM sağlayıcısı ekler. Bir eklenti `plugin.json` + ESM `activate(ctx)` dosyasından oluşur:

```js
// plugin.json: { "id": "ornek", "name": "Örnek", "version": "1.0.0", "main": "index.mjs", "legtApi": 1 }
export function activate(ctx) {
  ctx.registerProvider({
    id: 'ornek', label: 'Örnek sağlayıcı', defaultBaseUrl: 'http://localhost:9000', apiKey: 'optional', remote: false,
    create: (settings) => ({ listModels: async () => [...], chat: async (req) => '...' })
  })
}
```

Eklenti klasörünü **Ayarlar > Eklentiler > Klasör** ile açılan dizine kopyalayın, aynı yerden açın. Eklentiler uygulama içinde tam yetkiyle çalışır ve siz açana kadar kapalıdır; yalnızca güvendiğiniz eklentileri kullanın. API anahtarları işletim sisteminin anahtar deposuyla şifrelenerek saklanır.

## Hata ve token tasarrufu

Tasarımdan bağımsız dosyalar (Elementor modunda `header.php`, `footer.php`, demo JSON'ları) şablondan üretilir, LLM'e gitmez. Modelin sık yaptığı, anlamı belli hatalar (namespace sırası, uydurma Elementor metotları gibi) onarım çağrısı harcanmadan kodla düzeltilir; kalanlar Elementor'un gerçek metot listesine karşı doğrulanıp net mesajla onarıma gider. Her çağrıda yalnızca üretilen dosya türünün kuralları gönderilir ve system mesajı projedeki tüm çağrılarda aynı kalır (önbellek dostu). "Kaldığı yerden devam et", daha önce tamam sayılmış dosyaları da güncel kurallarla yeniden kontrol eder.

## Ollama kurulum ekranı

Ollama kurulu değilse, çalışmıyorsa ya da modeli yoksa uygulama açılışta **Ollama kurulumu** ekranını gösterir (kenar çubuğundan da açılır): Ollama'yı kurar (Windows'ta resmi yükleyiciyi indirip sessiz kurar, diğer sistemlerde indirme sayfasını açar), servisi başlatır, model indirir ve paralel ayarı yazar. "Hepsini otomatik yap" bu adımları sırayla çalıştırır.

## Paralel ajanlar

**Ayarlar > Paralel ajan** (1–10, varsayılan 3): bağımlılığı hazır dosyalar, canlı testteki senaryolar ve onarımlar aynı anda üretilir. Ollama'nın istekleri gerçekten paralel işlemesi için `OLLAMA_NUM_PARALLEL` en az bu değerde olmalı (her ajan ek bellek ister). Yerel Ollama kullanılırken üretim ve canlı test başlarken `OLLAMA_NUM_PARALLEL` (+ `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`) otomatik kontrol edilir; yetersizse Windows'ta kalıcı yazılır ve Ollama yeniden başlatılır, diğer sistemlerde gereken komut gösterilir.

## Demo içe aktarma (Elementor modu)

Üretilen eklenti **Görünüm > {Tema} Demo** sayfasıyla gelir: tek tıkla ana sayfa, header/footer layout'ları, ana menü ve Elementor global renk/fontları kurulur (WP-CLI: `wp {önek} demo-import`).

## Site adresi ve ekran görüntüsünden tema

HTML'iniz yoksa Kaynak ekranından iki yol daha var:

- **Site adresi:** sayfa gerçek tarayıcıda açılır; render edilmiş HTML, CSS ve görseller alınır, üç pencerede (masaüstü / tablet / mobil) tam sayfa ekran görüntüsü referans olarak saklanır. Yalnızca hakkınız olan siteleri kullanın; JavaScript çalıştırılmış hâliyle alınır.
- **Ekran görüntüsü:** görsel destekli bir model görüntüyü tek dosyalık HTML+CSS'e çevirir, sonra normal akış sürer. Görsel model yoksa uygulama yönlendirir: yerel model indirme (ör. `qwen2.5vl:7b`, ana kod modeli değişmez) ya da görsel girdiyi destekleyen bir bulut sağlayıcı eklentisi (veri bilgisayardan çıkar).

## Görsel benzerlik puanı

Canlı test, kaynak sayfayla üretilen siteyi aynı pencerelerde ölçer ve **1500 puan** üzerinden puanlar: piksel 500 · yerleşim 400 · tipografi 250 · renk 200 · içerik 150. **750 altı hata**, 1050 altı uyarıdır. Yazı boyutu, kalınlık, satır yüksekliği, renk, arka plan, yuvarlama gibi stil sapmaları LLM'siz CSS kuralına çevrilip widget CSS'ine yazılır (Elementor modu); kalan sapmalar ölçüleriyle onarım istemine gider. Sonuç Test ekranında bölüm ve pencere bazında görünür.

## Canlı test (son kontrol)

Test ortamı yoksa **4. Test** ekranındaki **Test ortamını kur** düğmesi portable XAMPP, WordPress ve Elementor'u indirip kurar (yaklaşık 300-400 MB, bir kez; npm gerekmez). Üretimden sonra **4. Test** ekranı temayı (ve Elementor modunda eklentiyi) portable XAMPP üzerinde gerçek bir WordPress'e kurar ve Playwright ile masaüstü / tablet / mobilde gezer. Seçili model etkileşim senaryoları yazar (menü, slider, SSS…), bulunan her sorun ilgili dosyaya bağlanır ve model o dosyayı onarır; site yeniden kurulup test tekrarlanır. Her test rastgele portlarla, geçici bir veritabanıyla çalışır; kendi XAMPP'ınız ya da 80/3306 portlarınız etkilenmez.

```bash
npm run setup:runtime   # bir kez: runtime/ altına portable XAMPP, WordPress, Elementor, Chromium
```

Ayrıntılar: [runtime/README.md](runtime/README.md). Canlı entegrasyon testi (yavaş, isteğe bağlı):

```bash
LEGT_LIVE=1 npx vitest run tests/wptest.live.test.ts                  # bash
$env:LEGT_LIVE='1'; npx vitest run tests/wptest.live.test.ts          # PowerShell
```

`LEGT_LIVE_MODEL=qwen2.5-coder:7b` eklenirse senaryo ve onarım çağrıları gerçek Ollama modeline gider.

## Yapı

| Klasör | İçerik |
|---|---|
| `electron/` | main süreç, preload (contextBridge), tipli IPC |
| `core/` | UI'dan bağımsız pipeline: HTML ön analizi, LLM sağlayıcıları, prompt doldurma, doğrulayıcılar, proje durumu |
| `prompts/` | Mod başına düz Markdown prompt'lar (`{{değişken}}` yer tutucuları) |
| `runtime/` | Canlı test ortamı (portable XAMPP, WordPress, Elementor); `npm run setup:runtime` indirir |
| `src/` | React + Fluent UI arayüzü |
| `tests/` | vitest testleri |

Ayrıntılı mimari ve kurallar: [docs/MIMARI.md](docs/MIMARI.md).

## Lisans

GPL-3.0-or-later. Üretilen temalar da WordPress gereği GPL uyumludur.
