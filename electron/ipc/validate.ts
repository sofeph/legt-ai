import { ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { saveManualEdit } from '../../core/pipeline/generate'
import { validateFile } from '../../core/validate'
import type { IntakeInput } from '../../core/types'
import { store } from './fs'

export function registerValidateIpc(): void {
  ipcMain.handle('validate:file', async (_e, path: string, content: string, projectId: string) => {
    const intake = await store().readJson<IntakeInput>(projectId, 'intake.json')
    if (!intake) throw new Error(`Proje bulunamadı: ${projectId}`)
    return validateFile(path, content, { mode: intake.mode, slug: intake.theme.slug, prefix: intake.theme.prefix })
  })

  ipcMain.handle('projects:readOutput', async (_e, id: string, path: string) => {
    try {
      return await readFile(store().safePath(id, `output/${path}`), 'utf8')
    } catch {
      return null
    }
  })

  ipcMain.handle('projects:saveOutput', (_e, id: string, path: string, content: string) => saveManualEdit(store(), id, path, content))
}
