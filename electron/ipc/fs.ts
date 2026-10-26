import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import { extractTokens } from '../../core/html/extractTokens'
import { splitSections } from '../../core/html/splitSections'
import { normalizePlan } from '../../core/pipeline/layout'
import { ProjectStore } from '../../core/project/store'
import { clampConcurrency } from '../../core/pool'
import { DEFAULT_LLM_SETTINGS, PREFIX_RE, type IntakeInput, type IntakeSource, type LLMSettings, type Plan, type PreAnalysis, type ProjectState } from '../../core/types'
import type { LoadedProject } from '../api'
import { projectsDir, settingsFile } from '../paths'

export const store = (): ProjectStore => new ProjectStore(projectsDir())

export function preAnalyze(sources: IntakeSource[]): PreAnalysis {
  const html = sources.filter((s) => s.kind === 'html').map((s) => s.content).join('\n')
  const css = sources.filter((s) => s.kind === 'css').map((s) => s.content)
  const js = sources.filter((s) => s.kind === 'js').map((s) => s.content)
  return { sections: splitSections(html, js), tokens: extractTokens(html, css) }
}

export async function loadSettings(): Promise<LLMSettings> {
  try {
    const s: LLMSettings = { ...DEFAULT_LLM_SETTINGS, ...JSON.parse(await readFile(settingsFile(), 'utf8')) }
    return { ...s, concurrency: clampConcurrency(s.concurrency) }
  } catch {
    return { ...DEFAULT_LLM_SETTINGS }
  }
}

function assertIntake(input: IntakeInput): void {
  if (!PREFIX_RE.test(input.theme.prefix)) throw new Error(`Önek geçersiz: ${input.theme.prefix}`)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.theme.slug)) throw new Error(`Slug geçersiz: ${input.theme.slug}`)
  if (!input.sources.some((s) => s.kind === 'html' && s.content.trim())) throw new Error('En az bir HTML kaynağı gerekli')
}

export function registerFsIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('html:preAnalyze', (_e, sources: IntakeSource[]) => preAnalyze(sources))

  ipcMain.handle('html:pickSources', async (): Promise<IntakeSource[]> => {
    const win = getWindow()
    const opts = {
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [{ name: 'HTML / CSS / JS', extensions: ['html', 'htm', 'css', 'js'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled) return []
    return Promise.all(
      res.filePaths.map(async (p) => {
        const ext = extname(p).toLowerCase()
        const kind: IntakeSource['kind'] = ext === '.css' ? 'css' : ext === '.js' ? 'js' : 'html'
        return { name: basename(p), kind, content: await readFile(p, 'utf8') }
      })
    )
  })

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', async (_e, s: LLMSettings) => {
    await mkdir(dirname(settingsFile()), { recursive: true })
    await writeFile(settingsFile(), JSON.stringify({ ...s, concurrency: clampConcurrency(s.concurrency) }, null, 2))
  })

  ipcMain.handle('projects:list', () => store().list())

  ipcMain.handle('projects:create', async (_e, input: IntakeInput) => {
    assertIntake(input)
    const s = store()
    const pre = preAnalyze(input.sources)
    const id = await s.create(input, pre)
    for (const src of input.sources) await s.writeText(id, `sources/${basename(src.name)}`, src.content)
    return id
  })

  ipcMain.handle('projects:load', async (_e, id: string): Promise<LoadedProject> => {
    const s = store()
    const [intake, pre, plan, state] = await Promise.all([
      s.readJson<IntakeInput>(id, 'intake.json'),
      s.readJson<PreAnalysis>(id, 'preanalysis.json'),
      s.readJson<Plan>(id, 'plan.json'),
      s.readJson<ProjectState>(id, 'state.json')
    ])
    if (!intake || !pre || !state) throw new Error(`Proje bulunamadı veya eksik: ${id}`)
    return { id, intake, pre, plan, state }
  })

  ipcMain.handle('projects:savePlan', async (_e, id: string, plan: Plan, approve: boolean) => {
    // Elle düzenlenen widget/pattern adları da önek ve slug kurallarına uydurulur
    await store().savePlan(id, normalizePlan(plan), approve ? 'approved' : 'analyzed')
  })

  ipcMain.handle('projects:openFolder', async (_e, id: string) => {
    await shell.openPath(store().dir(id))
  })
}
