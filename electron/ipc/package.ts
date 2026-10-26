import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { packageProject, readOutputTree } from '../../core/pipeline/package'
import { qualityChecklist } from '../../core/pipeline/quality'
import type { Plan, PreAnalysis, ProjectState } from '../../core/types'
import { loadReport } from '../../core/wptest'
import { store } from './fs'

async function loadForPackage(id: string): Promise<{ plan: Plan; pre: PreAnalysis; state: ProjectState }> {
  const s = store()
  const [plan, pre, state] = await Promise.all([
    s.readJson<Plan>(id, 'plan.json'),
    s.readJson<PreAnalysis>(id, 'preanalysis.json'),
    s.readJson<ProjectState>(id, 'state.json')
  ])
  if (!plan || !pre || !state) throw new Error(`Proje eksik: ${id}`)
  return { plan, pre, state }
}

export function registerPackageIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('projects:quality', async (_e, id: string) => {
    const { plan, pre, state } = await loadForPackage(id)
    return qualityChecklist(
      plan,
      pre,
      state,
      await readOutputTree(store().safePath(id, 'output')),
      await loadReport(store(), id),
      await store().readJson<{ placeholders: string[] }>(id, 'assets.json')
    )
  })

  ipcMain.handle('projects:export', async (_e, id: string) => {
    const { plan } = await loadForPackage(id)
    const win = getWindow()
    const opts = {
      title: 'Zip dosyalarının kaydedileceği klasör',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    // Dosya yazma yalnızca kullanıcının seçtiği export klasörüne
    const result = await packageProject(store().safePath(id, 'output'), plan, res.filePaths[0])
    if (result.zips[0]) shell.showItemInFolder(result.zips[0])
    return result
  })
}
