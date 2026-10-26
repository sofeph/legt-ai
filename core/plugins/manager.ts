import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setPluginProviderFactory, type LLMProvider } from '../llm/provider'
import type { LLMSettings } from '../types'
import { PLUGIN_API_VERSION, type PluginInfo, type PluginManifest, type ProviderDefinition, type ProviderInfo } from './types'

export type { PluginInfo, ProviderDefinition, ProviderInfo } from './types'

export const BUILTIN_PROVIDERS: ProviderInfo[] = [
  { id: 'ollama', label: 'Ollama', defaultBaseUrl: 'http://localhost:11434', apiKey: 'none', remote: false },
  { id: 'openai-compat', label: 'OpenAI uyumlu (LM Studio, llama.cpp…)', defaultBaseUrl: 'http://localhost:1234/v1', apiKey: 'optional', remote: false }
]
const BUILTIN_IDS = new Set(BUILTIN_PROVIDERS.map((p) => p.id))
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/

/** Eklentilerin kaydettiği sağlayıcılar (createProvider buradan bakar) */
const providers = new Map<string, ProviderDefinition & { pluginId: string }>()

export function pluginProvider(id: string): (ProviderDefinition & { pluginId: string }) | undefined {
  return providers.get(id)
}

export function providerInfos(): ProviderInfo[] {
  return [
    ...BUILTIN_PROVIDERS,
    ...[...providers.values()].map((p) => ({
      id: p.id,
      label: p.label,
      defaultBaseUrl: p.defaultBaseUrl ?? '',
      apiKey: p.apiKey ?? 'none',
      ...(p.apiKeyHint ? { apiKeyHint: p.apiKeyHint } : {}),
      ...(p.modelHint ? { modelHint: p.modelHint } : {}),
      remote: !!p.remote,
      pluginId: p.pluginId
    }))
  ]
}

export async function createPluginProvider(settings: LLMSettings): Promise<LLMProvider> {
  const def = providers.get(settings.provider)
  if (!def) throw new Error(`"${settings.provider}" sağlayıcısı yok: eklentisi kurulu ve etkin mi? (Ayarlar > Eklentiler)`)
  return def.create(settings)
}

setPluginProviderFactory(createPluginProvider)

async function readManifest(dir: string): Promise<PluginManifest> {
  const m = JSON.parse(await readFile(join(dir, 'plugin.json'), 'utf8')) as Partial<PluginManifest>
  if (!m.id || !ID_RE.test(m.id)) throw new Error(`plugin.json: geçersiz "id" (${m.id ?? 'yok'})`)
  if (!m.main || typeof m.main !== 'string') throw new Error('plugin.json: "main" eksik')
  if (m.legtApi !== PLUGIN_API_VERSION) throw new Error(`plugin.json: legtApi ${m.legtApi ?? 'yok'} desteklenmiyor (beklenen ${PLUGIN_API_VERSION})`)
  return { id: m.id, name: m.name || m.id, version: m.version || '0.0.0', main: m.main, legtApi: m.legtApi, description: m.description ?? '' }
}

/**
 * Eklenti klasörlerini tarar; etkin olanları yükler. Eklentiler ana süreçte tam yetkiyle çalışır,
 * bu yüzden yeni bulunan eklenti kullanıcı açana kadar kapalıdır.
 */
export class PluginManager {
  private infos: PluginInfo[] = []
  private generation = 0

  constructor(
    private dirs: () => string[],
    private isEnabled: (id: string) => boolean,
    private logger: (line: string) => void = () => undefined
  ) {}

  list(): PluginInfo[] {
    return this.infos
  }

  async reload(): Promise<PluginInfo[]> {
    providers.clear()
    // Aynı dosya yeniden import edilince Node önbellekten döner; sorgu parametresi yeni sürümü yükler
    const gen = ++this.generation
    const infos: PluginInfo[] = []
    for (const root of this.dirs()) {
      if (!existsSync(root)) continue
      for (const e of await readdir(root, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const dir = join(root, e.name)
        if (!existsSync(join(dir, 'plugin.json'))) continue
        const info: PluginInfo = { id: e.name, name: e.name, version: '', description: '', dir, enabled: false, loaded: false, providers: [] }
        infos.push(info)
        try {
          const m = await readManifest(dir)
          Object.assign(info, { id: m.id, name: m.name, version: m.version, description: m.description ?? '' })
          if (infos.some((o) => o !== info && o.id === m.id)) throw new Error(`Aynı kimlikte başka eklenti var: ${m.id}`)
          info.enabled = this.isEnabled(m.id)
          if (!info.enabled) continue
          const main = resolve(dir, m.main)
          if (!main.startsWith(resolve(dir) + sep)) throw new Error('"main" eklenti klasörünün dışını gösteriyor')
          const mod = (await import(/* @vite-ignore */ `${pathToFileURL(main).href}?v=${gen}`)) as { activate?: (ctx: unknown) => unknown }
          if (typeof mod.activate !== 'function') throw new Error(`${m.main} "activate" fonksiyonu dışa aktarmıyor`)
          await mod.activate({
            apiVersion: PLUGIN_API_VERSION,
            dir,
            log: (msg: string) => this.logger(`[${m.id}] ${msg}`),
            registerProvider: (def: ProviderDefinition) => {
              if (!def?.id || !ID_RE.test(def.id) || BUILTIN_IDS.has(def.id)) throw new Error(`Geçersiz sağlayıcı kimliği: ${def?.id}`)
              if (providers.has(def.id)) throw new Error(`"${def.id}" sağlayıcısı başka bir eklentide de var`)
              if (typeof def.create !== 'function') throw new Error(`"${def.id}" sağlayıcısında create() yok`)
              providers.set(def.id, { ...def, pluginId: m.id })
              info.providers.push(def.id)
            }
          })
          info.loaded = true
        } catch (err) {
          info.error = (err as Error).message
          for (const p of info.providers) providers.delete(p)
          info.providers = []
          this.logger(`Eklenti yüklenemedi (${dir}): ${info.error}`)
        }
      }
    }
    this.infos = infos
    return infos
  }
}
