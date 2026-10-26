// LEGT AI eklenti API'si (legtApi: 1). Eklenti klasörü:
//   plugin.json   { "id", "name", "version", "main", "legtApi": 1, "description"? }
//   main dosyası  ESM; `export function activate(ctx: PluginContext)` (async olabilir)
import type { LLMProvider } from '../llm/provider'
import type { LLMSettings } from '../types'

export const PLUGIN_API_VERSION = 1

export interface ProviderDefinition {
  /** LLMSettings.provider değeri; yerleşik "ollama" / "openai-compat" ile çakışamaz */
  id: string
  label: string
  defaultBaseUrl?: string
  /** Ayarlar'da API anahtarı alanı */
  apiKey?: 'required' | 'optional' | 'none'
  apiKeyHint?: string
  /** Veri bilgisayardan çıkıyorsa true: Ayarlar'da gizlilik uyarısı gösterilir */
  remote?: boolean
  /** Model alanının yanında gösterilen öneri */
  modelHint?: string
  create(settings: LLMSettings): LLMProvider | Promise<LLMProvider>
}

export interface PluginContext {
  apiVersion: typeof PLUGIN_API_VERSION
  /** Eklentinin klasörü (yapılandırma dosyası vb. için) */
  dir: string
  registerProvider(def: ProviderDefinition): void
  log(message: string): void
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  main: string
  legtApi: number
  description?: string
}

/** Renderer'a giden özet */
export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  dir: string
  enabled: boolean
  loaded: boolean
  error?: string
  providers: string[]
}

/** Ayarlar'daki sağlayıcı listesi (yerleşik + eklentiler) */
export interface ProviderInfo {
  id: string
  label: string
  defaultBaseUrl: string
  apiKey: 'required' | 'optional' | 'none'
  apiKeyHint?: string
  modelHint?: string
  remote: boolean
  /** Yerleşik değilse sağlayan eklenti */
  pluginId?: string
}
