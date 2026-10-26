import { existsSync } from 'node:fs'
import { ipcMain, shell, type BrowserWindow } from 'electron'
import { createProvider } from '../../core/llm/provider'
import { clampConcurrency } from '../../core/pool'
import type { Plan, TestOptions } from '../../core/types'
import { setPhpBinary } from '../../core/validate/php'
import { detectRuntime, loadReport, readShot, runLiveTest, stopAllServers, type WpServer } from '../../core/wptest'
import { binaries, runtimePaths } from '../../core/wptest/runtime'
import type { LlmEvent } from '../api'
import { promptsDir, runtimeDir, wptestPhpDir, wptestWorkRoot } from '../paths'
import { loadSettings, store } from './fs'
import { exclusive, running } from './llm'

/** keepAlive ile açık bırakılan siteler (proje başına bir tane) */
const sites = new Map<string, WpServer>()

async function stopSite(id: string): Promise<void> {
  await sites.get(id)?.stop()
  sites.delete(id)
}

export function registerWptestIpc(getWindow: () => BrowserWindow | null): void {
  const emit = (e: LlmEvent): void => getWindow()?.webContents.send('llm:event', e)

  // PATH'te php yoksa doğrulama da portable XAMPP'ın php'siyle php -l yapsın
  const php = binaries(runtimePaths(runtimeDir())).php
  if (existsSync(php)) setPhpBinary(php)

  ipcMain.handle('wptest:status', async (_e, id: string) => {
    const plan = await store().readJson<Plan>(id, 'plan.json')
    return detectRuntime(runtimeDir(), plan?.mode !== 'block-theme')
  })

  ipcMain.handle('wptest:report', (_e, id: string) => loadReport(store(), id))
  ipcMain.handle('wptest:shot', (_e, id: string, rel: string) => readShot(store(), id, rel))
  ipcMain.handle('wptest:site', (_e, id: string) => (sites.get(id)?.running ? sites.get(id)!.url : null))
  ipcMain.handle('wptest:openSite', async (_e, id: string) => {
    const url = sites.get(id)?.running ? sites.get(id)!.url : null
    if (url) await shell.openExternal(url)
  })
  ipcMain.handle('wptest:stopSite', (_e, id: string) => stopSite(id))

  ipcMain.handle('projects:test', (_e, id: string, options: TestOptions) =>
    exclusive(id, async (signal) => {
      await stopSite(id)
      const settings = await loadSettings()
      // Model seçili değilse yalnızca test: senaryo ve onarım yapılmaz
      const provider = settings.model ? await createProvider(settings) : null
      const { report, server } = await runLiveTest({
        provider,
        promptsDir: promptsDir(),
        store: store(),
        projectId: id,
        numCtx: settings.numCtx,
        concurrency: clampConcurrency(settings.concurrency),
        runtimeDir: runtimeDir(),
        phpScriptsDir: wptestPhpDir(),
        workRoot: wptestWorkRoot(),
        options,
        signal,
        onEvent: (event) => emit({ projectId: id, type: 'test', event })
      })
      if (server) sites.set(id, server)
      emit(report.status === 'error' ? { projectId: id, type: 'error', message: report.error ?? 'Test tamamlanamadı' } : { projectId: id, type: 'done' })
      return report
    })
  )
}

/** Uygulama kapanırken: açık siteler ve yarıda kalan testlerin süreçleri */
export function shutdownWptest(): void {
  for (const ctrl of running.values()) ctrl.abort()
  stopAllServers()
}
