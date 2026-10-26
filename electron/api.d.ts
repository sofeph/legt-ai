// preload.ts'in window.legt'e açtığı API'nin tipi. Renderer yalnızca bunu görür.
import type { GenEvent, IntakeInput, IntakeSource, LLMSettings, ModelInfo, Plan, PreAnalysis, ProjectMeta, ProjectState, QualityItem, RuntimeStatus, TestEvent, TestOptions, TestReport, ValidationIssue } from '../core/types'

import type { PluginInfo, ProviderInfo } from '../core/plugins/types'
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
