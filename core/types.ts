// Paylaşılan tipler. Renderer bu dosyayı yalnızca `import type` ile kullanır.

export type Mode = 'block-theme' | 'elementor-free'

export const PREFIX_RE = /^[a-z][a-z0-9_]{1,9}$/

export interface ThemeIdentity {
  name: string
  slug: string
  prefix: string
  textdomain: string
  language: string
}

export interface IntakeSource {
  /** Dosya adı (yapıştırılan içerik için "pasted.html") */
  name: string
  /** media: görsel / video (content base64; projeye ikili yazılır, intake.json'a girmez) */
  kind: 'html' | 'css' | 'js' | 'media'
  content: string
}

export interface IntakeInput {
  mode: Mode
  theme: ThemeIdentity
  sources: IntakeSource[]
  requests: {
    blog: boolean
    woocommerce: boolean
    multiPage: boolean
    notes: string
  }
}

/** Bir site klasörünü (public_html, dist, www...) tarama sonucu */
/** Site adresi / ekran görüntüsü girişinin sonucu */
export interface UrlScan {
  /** Son adres (yönlendirmeden sonra) ya da ekran görüntüsünün dosya yolu */
  url: string
  title: string
  sources: IntakeSource[]
  warnings: string[]
}

export interface FolderScan {
  root: string
  sources: IntakeSource[]
  /** Atlanan dosyalar ve nedeni (kullanıcıya gösterilir) */
  skipped: string[]
  warnings: string[]
}

// ---- Ön analiz (LLM'siz) ----

export interface SectionSummary {
  id: string // section-1, section-2...
  tag: string
  role: 'header' | 'footer' | 'nav' | 'content'
  classes: string[]
  headings: string[]
  textSamples: string[]
  images: number
  links: number
  buttons: number
  forms: number
  repeated: { selector: string; count: number } | null
  jsHints: string[]
  /** Kaynak HTML (dosya üretiminde {{sectionHtml}} olarak gider, analize gitmez) */
  html: string
}

export interface ExtractedTokens {
  colors: { value: string; count: number }[]
  cssVariables: Record<string, string>
  fonts: { family: string; count: number }[]
  googleFonts: string[]
  fontSizes: { value: string; count: number }[]
  spacing: { value: string; count: number }[]
  radius: { value: string; count: number }[]
  shadows: { value: string; count: number }[]
  breakpoints: number[]
}

/** Örnek HTML'deki yazı kartlarından çıkarılan demo içerik (demo içe aktarıcı gerçek yazı olarak ekler) */
export interface DemoPost {
  title: string
  excerpt: string
  /** Görsel dosya adı (temanın medyasıyla eşleşirse öne çıkan görsel olur) */
  image: string
  category: string
}

export interface DemoLink {
  title: string
  url: string
}

export interface DemoContent {
  posts: DemoPost[]
  categories: string[]
  /** Örnek HTML'deki header / footer menü bağlantıları (demo menüleri bunlarla kurulur) */
  menus?: { primary: DemoLink[]; footer: DemoLink[] }
}

export interface PreAnalysis {
  sections: SectionSummary[]
  tokens: ExtractedTokens
  /** Eski projelerde yoktur */
  demo?: DemoContent
}

// ---- plan.json ----

export type FileKind =
  // elementor-free
  | 'widget-php'
  | 'widget-css'
  | 'widget-js'
  | 'theme-css'
  | 'theme-header'
  | 'theme-footer'
  | 'demo-json'
  // block-theme
  | 'theme-json'
  | 'template-part'
  | 'pattern'
  | 'template'
  | 'theme-js'
  // ortak
  | 'readme'
  | 'scaffold'

export interface PlanFile {
  path: string
  source: 'llm' | 'scaffold'
  kind?: FileKind
  dependsOn?: string[]
  sectionId?: string
}

export interface ElementorSection {
  id: string
  htmlRef: string
  widget: string
  title?: string
  contentControls: string[]
  styleControls: string[]
  repeater: { name: string; fields: string[] } | null
  js: string
  proReplacement: string | null
}

export interface BlockSection {
  id: string
  htmlRef: string
  kind: 'pattern' | 'part'
  slug: string
  title?: string
  blocks: string[]
  repeat: { count: number; block: string } | null
  js: string
  className: string | null
}

interface PlanBase {
  theme: ThemeIdentity
  tokens: Record<string, unknown>
  files: PlanFile[]
}

export interface ElementorPlan extends PlanBase {
  mode: 'elementor-free'
  /**
   * 'source': widget CSS'i LLM'siz, kaynak CSS kuralları widget kapsamına alınarak üretilir ve widget PHP'si
   * kaynak HTML'in sınıf adlarını korur (birebir görünüm). Yoksa eski davranış: CSS'i LLM yazar.
   */
  cssMode?: 'source' | 'llm'
  sections: ElementorSection[]
  layout: { header: string; footer: string }
}

export interface BlockPlan extends PlanBase {
  mode: 'block-theme'
  sections: BlockSection[]
  templates: string[]
}

export type Plan = ElementorPlan | BlockPlan

// ---- LLM ayarları ----

export interface LLMSettings {
  /** "ollama", "openai-compat" ya da bir eklentinin kaydettiği sağlayıcı kimliği */
  provider: string
  baseUrl: string
  model: string
  numCtx: number
  apiKey?: string
  /** Ekran görüntüsünden HTML için görsel destekli model (Ollama / OpenAI uyumlu); boşsa seçili model ya da kurulu ilk görsel model */
  visionModel?: string
  /** Aynı anda çalışan LLM ajanı sayısı (1-10, varsayılan 3); Ollama'da OLLAMA_NUM_PARALLEL ile birlikte etkili */
  concurrency: number
  /** Eklenti kimliği → etkin mi (yeni bulunan eklentiler kapalı başlar) */
  plugins?: Record<string, boolean>
}

export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: '',
  numCtx: 8192,
  concurrency: 3
}

export interface ModelInfo {
  name: string
  /** Parametre sayısı, milyar (bilinmiyorsa null) */
  paramsB: number | null
}

// ---- Doğrulama ----

export interface ValidationIssue {
  rule: string
  message: string
  line?: number
}

// ---- Proje durumu ----

export type FileStatus = 'pending' | 'generating' | 'ok' | 'failed'

export interface ProjectState {
  step: 'intake' | 'analyzed' | 'approved' | 'generating' | 'done'
  files: Record<string, { status: FileStatus; attempts: number; errors?: string }>
  updatedAt: string
}

export interface ProjectMeta {
  id: string
  name: string
  mode: Mode
  step: ProjectState['step']
  updatedAt: string
}

// ---- Üretim olayları ve kalite listesi ----

export type GenEvent =
  | { type: 'file'; path: string; status: FileStatus; attempts: number; errors?: string }
  | { type: 'phase'; path: string; phase: 'generate' | 'repair'; attempt: number }
  | { type: 'token'; path: string; chunk: string }

export type CheckStatus = 'pass' | 'fail' | 'warn'

export interface QualityItem {
  id: string
  label: string
  status: CheckStatus
  details: string[]
}

// ---- Canlı WordPress testi (Playwright) ----

export type TestIssueKind = 'setup' | 'php' | 'http' | 'console' | 'asset' | 'render' | 'content' | 'overflow' | 'scenario' | 'editor' | 'visual'

export interface TestIssue {
  kind: TestIssueKind
  severity: 'error' | 'warning'
  message: string
  url?: string
  viewport?: string
  sectionId?: string
  /** Sorumlu tutulan çıktı dosyası (output/ altına göre); bilinmiyorsa yok */
  file?: string
  /** Onarım prompt'una giden ek bağlam (yığın izi, render edilmiş HTML parçası...) */
  detail?: string
}

export interface TestShot {
  name: string
  viewport: string
  /** projects/{id}/ altına göre */
  file: string
}

export interface TestRound {
  round: number
  issues: TestIssue[]
  /** LLM senaryolarından kaç kontrol çalıştı / atlandı (seçici DOM'da yok) */
  scenarios: { run: number; skipped: number }
  repaired: string[]
  /** Onarım sorunları artırdığı için geri alınan dosyalar */
  reverted: string[]
}

/** Görsel benzerlik puanı: 1500 üzerinden; 750 altı hata, 1050 altı uyarı (core/visual/score.ts) */
export interface VisualSectionScore {
  sectionId: string
  label: string
  viewport: string
  total: number
  pixel: number
  layout: number
  type: number
  color: number
  content: number
  /** Kod tarafından otomatik düzeltilen özellik sayısı */
  patched: number
  file?: string
}

export interface VisualReport {
  max: number
  threshold: number
  /** Bölümlerin kaynak yüksekliğine ve görünüm penceresine göre ağırlıklı ortalaması */
  score: number
  verdict: 'pass' | 'warn' | 'fail'
  sections: VisualSectionScore[]
  /** Referans ekran görüntüsüyle (site adresi / ekran görüntüsü girişi) tam sayfa karşılaştırma */
  pages: { viewport: string; score: number }[]
  /** Otomatik yazılan CSS düzeltmesi sayısı */
  patches: number
}

export interface TestReport {
  startedAt: string
  finishedAt: string
  status: 'pass' | 'warn' | 'fail' | 'error'
  wpVersion: string | null
  rounds: TestRound[]
  shots: TestShot[]
  visual?: VisualReport
  error?: string
}

export interface TestOptions {
  /** Otomatik onarım turu sayısı (0 = yalnızca test) */
  rounds: number
  /** Seçili LLM etkileşim senaryoları yazsın */
  aiScenarios: boolean
  /** Elementor editörünün açıldığını da test et */
  editor: boolean
  /** Test bitince siteyi açık tut (tarayıcıda incelemek için) */
  keepAlive: boolean
  /** Görsel benzerlik puanı (1500 üzerinden, 750 altı hata) ve otomatik CSS düzeltmesi; varsayılan açık */
  visual?: boolean
}

export const DEFAULT_TEST_OPTIONS: TestOptions = { rounds: 2, aiScenarios: true, editor: true, keepAlive: false, visual: true }

export interface RuntimeStatus {
  ok: boolean
  dir: string
  php: string | null
  httpd: string | null
  mysqld: string | null
  wordpress: string | null
  elementor: string | null
  problems: string[]
}

export type TestEvent =
  | { type: 'log'; message: string }
  | { type: 'phase'; phase: 'runtime' | 'install' | 'browser' | 'scenarios' | 'repair'; round: number; detail?: string }
  /** source: hangi ajanın çıktısı (senaryo bölümü ya da onarılan dosya) */
  | { type: 'token'; source: string; chunk: string }
  | { type: 'round'; round: TestRound }
  | { type: 'site'; url: string | null }

/** Ollama kurulum ekranının durumu (core/ollama/setup.ts) */
export interface OllamaStatus {
  platform: string
  installed: boolean
  exePath: string | null
  /** baseUrl'e bağlanılabiliyor mu */
  running: boolean
  models: string[]
  /** Kullanıcı ortamındaki OLLAMA_NUM_PARALLEL; ayarlı değilse null */
  numParallel: number | null
  /** Ayarlardaki paralel ajan sayısı */
  wantedParallel: number
  /** Kalıcı yazılamayan sistemler için elle çalıştırılacak komut */
  manualCommand: string
}

export type OllamaStep = 'install' | 'start' | 'pull' | 'parallel'

export type OllamaEvent =
  | { type: 'step'; step: OllamaStep; message: string }
  | { type: 'progress'; step: OllamaStep; percent: number; message: string }
  | { type: 'done'; step: OllamaStep }
  | { type: 'error'; step: OllamaStep; message: string }
