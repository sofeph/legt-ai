// preload.ts'in window.legt'e açtığı API'nin tipi. Renderer yalnızca bunu görür.
import type { GenEvent, IntakeInput, IntakeSource, LLMSettings, ModelInfo, OllamaEvent, OllamaStatus, Plan, PreAnalysis, ProjectMeta, ProjectState, QualityItem, RuntimeStatus, TestEvent, TestOptions, TestReport, ValidationIssue } from '../core/types'

import type { PluginInfo, ProviderInfo } from '../core/plugins/types'
import type { UrlScan } from '../core/types'

export type { UrlScan }

export interface VisionStatus {
  ok: boolean
  provider: string
  /** Ekran görüntüsü için kullanılacak model (ok ise) */
  model: string
  /** Veri bilgisayardan çıkar (bulut sağlayıcı) */
  remote: boolean
  installedVision: string[]
  suggestions: { name: string; label: string; note: string }[]
  reason?: 'ollama-down' | 'no-vision-model' | 'provider-no-vision'
}

export type ScreenshotResult = { ok: true; scan: UrlScan } | { ok: false; reason: 'ollama-down' | 'no-vision-model' | 'provider-no-vision' | 'cancelled' | 'error'; message: string }
import type { FolderScan } from '../core/types'

export type { ProjectMeta, ProjectState }

export interface LoadedProject {
  id: string
  intake: IntakeInput
  pre: PreAnalysis
  plan: Plan | null
  state: ProjectState
}

export type LlmEvent =
  | { projectId: string; type: 'token'; chunk: string }
  | { projectId: string; type: 'attempt'; attempt: number; errors: string[] }
  | { projectId: string; type: 'gen'; event: GenEvent }
  | { projectId: string; type: 'test'; event: TestEvent }
  | { projectId: string; type: 'done' }
  | { projectId: string; type: 'error'; message: string }

export interface LegtApi {
  platform: string
  html: {
    preAnalyze(sources: IntakeSource[]): Promise<PreAnalysis>
    pickSources(): Promise<IntakeSource[]>
    /** Site klasörü seçtirir (public_html vb.), HTML/CSS/JS'i toplar; iptalde null */
    pickFolder(): Promise<FolderScan | null>
    /** Site adresini gerçek tarayıcıda açar: render edilmiş HTML + CSS + görseller + referans ekran görüntüleri */
    fromUrl(url: string): Promise<UrlScan>
    /** Ekran görüntüsü seçtirir, görsel destekli modelle HTML'e çevirir */
    fromScreenshot(): Promise<ScreenshotResult>
    visionStatus(): Promise<VisionStatus>
    cancel(): Promise<void>
    onEvent(cb: (e: { message: string }) => void): () => void
  }
  settings: {
    get(): Promise<LLMSettings>
    set(s: LLMSettings): Promise<void>
  }
  llm: {
    listModels(s: LLMSettings): Promise<ModelInfo[]>
    cancel(projectId: string): Promise<void>
    onEvent(cb: (e: LlmEvent) => void): () => void
  }
  ollama: {
    status(): Promise<OllamaStatus>
    /** Windows: resmi yükleyiciyi indirip sessiz kurar; diğer sistemlerde indirme sayfasını açar */
    install(): Promise<void>
    start(): Promise<void>
    pull(model: string): Promise<void>
    /** OLLAMA_NUM_PARALLEL = paralel ajan sayısı (Windows'ta kalıcı), Ollama yeniden başlar */
    applyParallel(): Promise<void>
    cancel(): Promise<void>
    onEvent(cb: (e: OllamaEvent) => void): () => void
  }
  projects: {
    list(): Promise<ProjectMeta[]>
    create(input: IntakeInput): Promise<string>
    load(id: string): Promise<LoadedProject>
    analyze(id: string): Promise<Plan>
    savePlan(id: string, plan: Plan, approve: boolean): Promise<void>
    openFolder(id: string): Promise<void>
    /** Dosya üretimi; `only` verilirse yalnızca o dosyalar yeniden üretilir */
    generate(id: string, only?: string[]): Promise<ProjectState>
    readOutput(id: string, path: string): Promise<string | null>
    /** Elle düzenlenen dosyayı kaydeder, yeniden doğrular, durumunu günceller */
    saveOutput(id: string, path: string, content: string): Promise<ValidationIssue[]>
    quality(id: string): Promise<QualityItem[]>
    /** Klasör seçtirir, zip'leri yazar; iptal edilirse null */
    export(id: string): Promise<{ zips: string[]; missing: string[] } | null>
  }
  validate: {
    file(path: string, content: string, projectId: string): Promise<ValidationIssue[]>
  }
  plugins: {
    list(): Promise<PluginInfo[]>
    reload(): Promise<PluginInfo[]>
    setEnabled(id: string, on: boolean): Promise<PluginInfo[]>
    openFolder(): Promise<void>
    /** Yerleşik + etkin eklentilerin LLM sağlayıcıları */
    providers(): Promise<ProviderInfo[]>
  }
  wptest: {
    /** Portable XAMPP / WordPress / Elementor hazır mı */
    status(projectId: string): Promise<RuntimeStatus>
    /** Portable XAMPP + WordPress + Elementor'u indirip kurar (yaklaşık 300-400 MB); ilerleme onSetupEvent'ten */
    setupRuntime(): Promise<void>
    cancelSetup(): Promise<void>
    onSetupEvent(cb: (e: { step: string; message: string; percent: number | null }) => void): () => void
    /** Canlı WordPress testi (+ seçili LLM ile senaryo ve onarım); olaylar llm.onEvent'ten 'test' tipinde gelir */
    run(projectId: string, options: TestOptions): Promise<TestReport>
    report(projectId: string): Promise<TestReport | null>
    /** test/shots/x.png → data: URL */
    shot(projectId: string, file: string): Promise<string | null>
    /** keepAlive ile açık kalan sitenin adresi */
    site(projectId: string): Promise<string | null>
    openSite(projectId: string): Promise<void>
    stopSite(projectId: string): Promise<void>
  }
}
