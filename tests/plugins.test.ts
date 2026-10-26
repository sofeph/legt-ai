import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createProvider } from '@core/llm/provider'
import { PluginManager, providerInfos } from '@core/plugins/manager'
import { DEFAULT_LLM_SETTINGS } from '@core/types'

let root: string

async function plugin(dir: string, manifest: object, code: string): Promise<void> {
  await mkdir(join(root, dir), { recursive: true })
  await writeFile(join(root, dir, 'plugin.json'), JSON.stringify(manifest))
  await writeFile(join(root, dir, 'index.mjs'), code)
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'legt-plugins-'))
  await plugin(
    'echo',
    { id: 'echo', name: 'Echo', version: '1.0.0', main: 'index.mjs', legtApi: 1, description: 'Test sağlayıcısı' },
    `export function activate(ctx) {
      ctx.registerProvider({ id: 'echo', label: 'Echo', apiKey: 'optional', remote: true,
        create: (s) => ({ listModels: async () => [{ name: 'e1', paramsB: null }], chat: async (r) => 'model=' + s.model + ' ' + r.messages.at(-1).content }) })
    }`
  )
  await plugin('bad-api', { id: 'bad-api', main: 'index.mjs', legtApi: 99 }, 'export function activate() {}')
  await plugin('steal', { id: 'steal', main: 'index.mjs', legtApi: 1 }, `export function activate(ctx) { ctx.registerProvider({ id: 'ollama', label: 'x', create() {} }) }`)
  await plugin('escape', { id: 'escape', main: '../echo/index.mjs', legtApi: 1 }, '')
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('PluginManager', () => {
  it('yeni eklenti kapalı başlar, sağlayıcı kaydetmez', async () => {
    const m = new PluginManager(() => [root], () => false)
    const list = await m.reload()
    expect(list.find((p) => p.id === 'echo')).toMatchObject({ enabled: false, loaded: false, name: 'Echo', version: '1.0.0' })
    expect(providerInfos().map((p) => p.id)).toEqual(['ollama', 'openai-compat'])
    await expect(createProvider({ ...DEFAULT_LLM_SETTINGS, provider: 'echo' })).rejects.toThrow(/eklentisi kurulu ve etkin mi/)
  })

  it('açılınca sağlayıcı kaydeder; createProvider ona yönlenir', async () => {
    const m = new PluginManager(() => [root], () => true)
    const list = await m.reload()
    expect(list.find((p) => p.id === 'echo')).toMatchObject({ loaded: true, providers: ['echo'] })
    expect(providerInfos().find((p) => p.id === 'echo')).toMatchObject({ pluginId: 'echo', remote: true, apiKey: 'optional' })
    const p = await createProvider({ ...DEFAULT_LLM_SETTINGS, provider: 'echo', model: 'm' })
    expect(await p.chat({ messages: [{ role: 'user', content: 'selam' }], temperature: 0 })).toBe('model=m selam')
  })

  it('bozuk eklentiler hata verir ama diğerlerini engellemez', async () => {
    const list = await new PluginManager(() => [root], () => true).reload()
    const err = (id: string): string | undefined => list.find((p) => p.id === id)?.error
    expect(err('bad-api')).toMatch(/legtApi 99/)
    expect(err('steal')).toMatch(/Geçersiz sağlayıcı kimliği: ollama/)
    expect(err('escape')).toMatch(/klasörünün dışını/)
    expect(list.find((p) => p.id === 'echo')?.loaded).toBe(true)
  })

  it('olmayan klasör sorun değil', async () => {
    expect(await new PluginManager(() => [join(root, 'yok')], () => true).reload()).toEqual([])
  })
})
