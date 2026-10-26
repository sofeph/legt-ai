import { ipcMain, type BrowserWindow } from 'electron'
import { createProvider } from '../../core/llm/provider'
import { clampConcurrency } from '../../core/pool'
import { analyze } from '../../core/pipeline/analyze'
import { CancelledError, generate } from '../../core/pipeline/generate'
import type { IntakeInput, LLMSettings, PreAnalysis } from '../../core/types'
import type { LlmEvent } from '../api'
import { promptsDir, scaffoldDir } from '../paths'
import { loadSettings, store } from './fs'

export const running = new Map<string, AbortController>()

/** Proje başına tek iş; iptal için AbortController tutulur */
export async function exclusive<T>(id: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (running.has(id)) throw new Error('Bu proje için zaten çalışan bir işlem var')
  const ctrl = new AbortController()
  running.set(id, ctrl)
  try {
    return await fn(ctrl.signal)
  } finally {
    running.delete(id)
  }
}

async function requireModel(): Promise<LLMSettings> {
  const settings = await loadSettings()
  if (!settings.model) throw new Error('Ayarlardan bir model seçin')
  return settings
}

export function registerLlmIpc(getWindow: () => BrowserWindow | null): void {
  const emit = (e: LlmEvent): void => getWindow()?.webContents.send('llm:event', e)

  ipcMain.handle('llm:listModels', async (_e, s: LLMSettings) => {
    const provider = await createProvider(s)
    return provider.listModels(AbortSignal.timeout(5000))
  })

  ipcMain.handle('llm:cancel', (_e, projectId: string) => {
    running.get(projectId)?.abort()
  })

  ipcMain.handle('projects:analyze', (_e, id: string) =>
    exclusive(id, async (signal) => {
      const s = store()
      const intake = await s.readJson<IntakeInput>(id, 'intake.json')
      const pre = await s.readJson<PreAnalysis>(id, 'preanalysis.json')
      if (!intake || !pre) throw new Error(`Proje bulunamadı: ${id}`)
      const settings = await requireModel()
      try {
        const plan = await analyze({
          provider: await createProvider(settings),
          promptsDir: promptsDir(),
          scaffoldDir: scaffoldDir(),
          input: intake,
          pre,
          signal,
          onToken: (chunk) => emit({ projectId: id, type: 'token', chunk }),
          onAttempt: (attempt, errors) => emit({ projectId: id, type: 'attempt', attempt, errors }),
          log: (label, entry) => s.log(id, label, entry)
        })
        await s.savePlan(id, plan, 'analyzed')
        emit({ projectId: id, type: 'done' })
        return plan
      } catch (e) {
        const message = signal.aborted ? 'İptal edildi' : (e as Error).message
        emit({ projectId: id, type: 'error', message })
        throw new Error(message)
      }
    })
  )

  ipcMain.handle('projects:generate', (_e, id: string, only?: string[]) =>
    exclusive(id, async (signal) => {
      const settings = await requireModel()
      try {
        const state = await generate({
          provider: await createProvider(settings),
          promptsDir: promptsDir(),
          scaffoldDir: scaffoldDir(),
          store: store(),
          projectId: id,
          numCtx: settings.numCtx,
          concurrency: clampConcurrency(settings.concurrency),
          signal,
          only,
          onEvent: (event) => emit({ projectId: id, type: 'gen', event })
        })
        emit({ projectId: id, type: 'done' })
        return state
      } catch (e) {
        const message = e instanceof CancelledError || signal.aborted ? 'İptal edildi' : (e as Error).message
        emit({ projectId: id, type: 'error', message })
        throw new Error(message)
      }
    })
  )
}
