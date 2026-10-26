// Canlı WordPress testi: portable XAMPP + WordPress + Elementor + Playwright.
// Yavaş ve runtime/ gerektirir; yalnızca açıkça istenince çalışır:
//   npm run setup:runtime
//   LEGT_LIVE=1 npx vitest run tests/wptest.live.test.ts
// LEGT_LIVE_MODEL=qwen2.5-coder:7b ile senaryo ve onarım çağrıları gerçek Ollama modeline gider
// (dosya üretimi yine sahte; yalnızca canlı test prompt'ları denenir).
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OllamaProvider } from '@core/llm/ollama'
import type { LLMProvider } from '@core/llm/provider'
import { generate } from '@core/pipeline/generate'
import { ProjectStore } from '@core/project/store'
import type { Plan, TestEvent } from '@core/types'
import { detectRuntime, runLiveTest } from '@core/wptest'
import { blockPlan, elementorPlan, fakeProvider, intake, pre, promptsDir, root, scaffoldDir } from './helpers'

const runtimeDir = join(root, 'runtime')
const enabled = process.env.LEGT_LIVE === '1'
const realModel = process.env.LEGT_LIVE_MODEL

/**
 * Sahte LLM: dosya üretimi helpers'taki gibi; test senaryosu olarak kökün görünürlüğünü ister,
 * test onarımında görünmeyen ilk başlığı widget'ın varsayılan başlığı yapar.
 */
function liveProvider(): LLMProvider & { prompts: string[] } {
  const base = fakeProvider()
  const prompts: string[] = []
  return {
    prompts,
    listModels: async () => [],
    chat: async (req) => {
      const user = req.messages[1].content
      prompts.push(user.split('\n')[0])
      if (realModel && user.startsWith('# TEST')) return new OllamaProvider({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: realModel, numCtx: 16384, concurrency: 3 }).chat(req)
      if (user.startsWith('# TEST PLAN')) return JSON.stringify({ scenarios: [{ name: 'kök görünür', steps: [{ do: 'wait', ms: 100 }, { expect: 'visible', selector: '&' }] }] })
      if (user.startsWith('# TEST REPAIR')) {
        const path = /Dosya: `([^`]+)`/.exec(user)![1]
        const content = /## Mevcut içerik\n([\s\S]*?)\n+## Kurallar/.exec(user)![1]
        const heading = /görünmüyor \(varsayılan içerik\): "([^"]+)"/.exec(user)?.[1]
        const fixed = heading ? content.replace("esc_html__( 'Başlık', 'turkuaz' )", `esc_html__( '${heading.replace(/'/g, "\\'")}', 'turkuaz' )`) : content
        return `<<<FILE ${path}>>>\n${fixed}\n<<<END>>>`
      }
      return base.chat(req)
    }
  }
}

describe.skipIf(!enabled)('canlı WordPress testi', () => {
  let dir: string
  let store: ProjectStore
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'legt-live-'))
    store = new ProjectStore(dir)
  })
  afterAll(async () => {
    // LEGT_KEEP=1: rapor, ekran görüntüleri ve LLM logları incelenmek üzere saklanır
    if (process.env.LEGT_KEEP === '1') console.log(`Proje klasörü: ${dir}`)
    else await rm(dir, { recursive: true, force: true })
  })

  async function project(plan: Plan): Promise<string> {
    const id = await store.create(intake(plan.mode), pre)
    await store.savePlan(id, plan, 'approved')
    const state = await generate({ provider: fakeProvider(), promptsDir, scaffoldDir, store, projectId: id, numCtx: 8192, usePhpLint: false })
    expect(state.step).toBe('done')
    return id
  }

  for (const mode of ['elementor-free', 'block-theme'] as const) {
    it(`${mode}: kurar, gezer, senaryo çalıştırır, onarır`, async () => {
      const status = await detectRuntime(runtimeDir, mode === 'elementor-free')
      expect(status.problems).toEqual([])
      const plan = mode === 'elementor-free' ? await elementorPlan() : await blockPlan()
      const id = await project(plan)
      const provider = liveProvider()
      const events: TestEvent[] = []
      const { report } = await runLiveTest({
        provider,
        promptsDir,
        store,
        projectId: id,
        numCtx: 8192,
        concurrency: 3,
        runtimeDir,
        phpScriptsDir: join(root, 'core', 'wptest', 'php'),
        workRoot: join(tmpdir(), 'legt-live-sites'),
        options: { rounds: 1, aiScenarios: true, editor: mode === 'elementor-free', keepAlive: false },
        usePhpLint: false,
        onEvent: (e) => {
          events.push(e)
          if (e.type === 'log') console.log(`[${mode}] ${e.message}`)
        }
      })
      for (const r of report.rounds) {
        console.log(`[${mode}] tur ${r.round}: senaryo ${r.scenarios.run}/${r.scenarios.skipped} atlanan, onarılan: ${r.repaired.join(', ') || '-'}, geri alınan: ${r.reverted.join(', ') || '-'}`)
        for (const i of r.issues) console.log(`   ${i.severity} [${i.kind}] ${i.file ?? '-'} :: ${i.message}`)
      }
      expect(report.error).toBeUndefined()
      expect(report.status).not.toBe('error')
      expect(report.wpVersion).toMatch(/^\d/)
      expect(report.shots.length).toBeGreaterThan(0)
      // İlk tur: sahte widget'lar örnek başlıkları basmaz → içerik sorunu bulunmalı
      const first = report.rounds[0].issues
      expect(first.some((i) => i.kind === 'content')).toBe(true)
      // Widget'lar render edilir; sahte header.php/footer.php layout'u basmadığı için o sorun temaya bağlanmalı
      const render = first.filter((i) => i.kind === 'render')
      expect(render.map((i) => i.file).filter((f) => !/\/(header|footer)\.(php|html)$/.test(f ?? '')), JSON.stringify(render, null, 2)).toEqual([])
      expect(first.filter((i) => i.kind === 'php' && i.severity === 'error')).toEqual([])
      expect(provider.prompts.some((p) => p.startsWith('# TEST PLAN'))).toBe(true)
      if (!realModel) expect(report.rounds[0].scenarios.run).toBeGreaterThan(0)
      if (mode === 'elementor-free') {
        // Eklentinin demo içe aktarıcısı çalıştı, ana sayfa render edildi ve widget içeriyor
        expect(first.filter((i) => i.message.startsWith('Demo içe aktarma') || i.file?.includes('/demo/')), JSON.stringify(first, null, 2)).toEqual([])
        expect(report.shots.some((s) => s.file.endsWith('demo-desktop.png'))).toBe(true)
        expect(events.some((e) => e.type === 'log' && /Demo içe aktarıldı: .*home.json/.test(e.message))).toBe(true)
      }
      if (mode === 'elementor-free' && !realModel) {
        // Onarım: içerik sorunu olan widget'lar düzeltildi ve ikinci turda o sorunlar kayboldu
        expect(report.rounds[0].repaired.length).toBeGreaterThan(0)
        const fixed = report.rounds[0].repaired[0]
        expect(await readFile(join(dir, id, 'output', fixed), 'utf8')).not.toContain("esc_html__( 'Başlık', 'turkuaz' )")
        const second = report.rounds[1].issues
        expect(second.filter((i) => i.kind === 'content' && i.file === fixed && i.severity === 'error')).toEqual([])
      }
      expect(events.some((e) => e.type === 'site' && e.url?.startsWith('http://127.0.0.1:'))).toBe(true)
    }, 600000)
  }
})
