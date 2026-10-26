import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generate } from '@core/pipeline/generate'
import { clampConcurrency, CONCURRENCY, runPool } from '@core/pool'
import { ProjectStore } from '@core/project/store'
import { elementorPlan, fakeProvider, intake, pre, promptsDir, scaffoldDir } from './helpers'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('clampConcurrency', () => {
  it('1-10 arası, geçersizde varsayılan 3', () => {
    expect([0, -2, 1, 3, 10, 11, 4.6, NaN, undefined, '7'].map(clampConcurrency)).toEqual([3, 3, 1, 3, 10, 10, 5, 3, 3, 7])
    expect(CONCURRENCY).toEqual({ min: 1, max: 10, default: 3 })
  })
})

describe('runPool', () => {
  it('aynı anda en fazla N iş', async () => {
    let live = 0
    let peak = 0
    await runPool([...Array(10).keys()], 3, async () => {
      peak = Math.max(peak, ++live)
      await sleep(10)
      live--
    })
    expect(peak).toBe(3)
  })

  it('bağımlılık bitmeden iş başlamaz', async () => {
    const order: string[] = []
    const deps: Record<string, string[]> = { a: [], b: ['a'], c: ['a'], d: ['b', 'c'] }
    await runPool(
      ['d', 'c', 'b', 'a'],
      4,
      async (x) => {
        order.push(`+${x}`)
        await sleep(5)
        order.push(`-${x}`)
      },
      (x, done) => deps[x].every((d) => done.has(d))
    )
    expect(order.indexOf('+b')).toBeGreaterThan(order.indexOf('-a'))
    expect(order.indexOf('+d')).toBeGreaterThan(Math.max(order.indexOf('-b'), order.indexOf('-c')))
  })

  it('hata sonrası yeni iş başlatmaz, çalışanları bekler, ilk hatayı fırlatır', async () => {
    const started: number[] = []
    await expect(
      runPool([1, 2, 3, 4, 5], 2, async (x) => {
        started.push(x)
        await sleep(x === 1 ? 1 : 20)
        if (x === 1) throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(started).toEqual([1, 2])
  })

  it('döngüsel bağımlılıkta takılmaz', async () => {
    const seen: string[] = []
    await runPool(['x', 'y'], 2, async (v) => void seen.push(v), (v, done) => done.has(v === 'x' ? 'y' : 'x'))
    expect(seen.sort()).toEqual(['x', 'y'])
  })
})

describe('paralel üretim', () => {
  it('3 ajan: aynı anda en fazla 3 çağrı, CSS kendi widget PHP\'sinden sonra', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'legt-par-'))
    try {
      const store = new ProjectStore(dir)
      const plan = await elementorPlan()
      const id = await store.create(intake(plan.mode), pre)
      await store.savePlan(id, plan, 'approved')
      const base = fakeProvider()
      let live = 0
      let peak = 0
      const finished: string[] = []
      const provider = {
        listModels: base.listModels,
        chat: async (req: Parameters<typeof base.chat>[0]) => {
          peak = Math.max(peak, ++live)
          await sleep(5)
          const out = await base.chat(req)
          live--
          finished.push(/<<<FILE ([^>]+)>>>/.exec(out)![1])
          return out
        }
      }
      const state = await generate({ provider, promptsDir, scaffoldDir, store, projectId: id, numCtx: 8192, usePhpLint: false, concurrency: 3 })
      expect(state.step).toBe('done')
      expect(Object.values(state.files).every((f) => f.status === 'ok')).toBe(true)
      expect(peak).toBe(3)
      for (const f of plan.files.filter((f) => f.source === 'llm')) {
        for (const d of f.dependsOn ?? []) if (finished.includes(d)) expect(finished.indexOf(d), `${d} → ${f.path}`).toBeLessThan(finished.indexOf(f.path))
      }
      // Paralel log yazımı numara çakıştırmaz
      const { readdir } = await import('node:fs/promises')
      const logs = await readdir(join(dir, id, 'log'))
      expect(new Set(logs.map((l) => l.slice(0, 4))).size).toBe(logs.length)
      expect(logs).toHaveLength(finished.length)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
