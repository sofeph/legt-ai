import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractTokens } from '@core/html/extractTokens'
import { splitSections } from '@core/html/splitSections'
import type { ChatRequest, LLMProvider } from '@core/llm/provider'
import { analyze, PlanValidationError } from '@core/pipeline/analyze'
import type { IntakeInput } from '@core/types'

const html = readFileSync(join(__dirname, 'fixtures/landing.html'), 'utf8')
const pre = { sections: splitSections(html), tokens: extractTokens(html) }
const input: IntakeInput = {
  mode: 'elementor-free',
  theme: { name: 'Türkuaz', slug: 'turkuaz', prefix: 'trk', textdomain: 'turkuaz', language: 'tr' },
  sources: [{ name: 'landing.html', kind: 'html', content: html }],
  requests: { blog: false, woocommerce: false, multiPage: false, notes: '' }
}
const goodPlan = {
  mode: 'elementor-free',
  theme: input.theme,
  tokens: { colors: { primary: '#0e7c86' } },
  sections: pre.sections.map((s, i) => ({ id: `s${i}`, htmlRef: s.id, widget: `trk-w${i}`, contentControls: ['title'], styleControls: [], repeater: null, js: 'none', proReplacement: null })),
  layout: { header: 'widget', footer: 'widget' },
  files: [{ path: 'trk-elementor-widgets/widgets/class-w0.php', source: 'llm', dependsOn: [], sectionId: 's0' }]
}

function fake(responses: string[]): LLMProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = []
  return {
    calls,
    listModels: async () => [],
    chat: async (req) => {
      calls.push(req)
      return responses.shift() ?? ''
    }
  }
}

const promptsDir = join(__dirname, '..', 'prompts')
const scaffoldDir = join(__dirname, '..', 'core', 'scaffold')

describe('analyze', () => {
  it('ilk geçerli yanıtı plan olarak döndürür', async () => {
    const p = fake([JSON.stringify(goodPlan)])
    const plan = await analyze({ provider: p, promptsDir, scaffoldDir, input, pre })
    expect(plan.sections).toHaveLength(6)
    expect(p.calls[0]).toMatchObject({ json: true, temperature: 0.1 })
    const user = p.calls[0].messages[1].content
    expect(user).toContain('section-3')
    expect(user).not.toContain('<section') // tam HTML gitmez
    expect(user).not.toMatch(/\{\{\w+\}\}/)
  })

  it('şemaya uymazsa hatalarla bağımsız çağrı olarak tekrar ister', async () => {
    const bad = { ...goodPlan, sections: goodPlan.sections.slice(1).map((s) => ({ ...s, widget: 'hero' })) }
    const p = fake(['bu json değil', JSON.stringify(bad), JSON.stringify(goodPlan)])
    await analyze({ provider: p, promptsDir, scaffoldDir, input, pre })
    expect(p.calls).toHaveLength(3)
    for (const c of p.calls) expect(c.messages.map((m) => m.role)).toEqual(['system', 'user'])
    const third = p.calls[2].messages[1].content
    expect(third).toContain('"trk-" ile başlamalı')
    expect(third).toContain('eşlenmedi: section-1')
  })

  it('3 denemede de geçersizse hata verir', async () => {
    const p = fake(['{}', '{}', '{}'])
    await expect(analyze({ provider: p, promptsDir, scaffoldDir, input, pre })).rejects.toBeInstanceOf(PlanValidationError)
  })
})
