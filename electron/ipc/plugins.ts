import { mkdir } from 'node:fs/promises'
import { ipcMain, shell } from 'electron'
import { PluginManager, providerInfos } from '../../core/plugins/manager'
import { pluginDirs } from '../paths'
import { loadSettings, saveSettings } from './fs'

let enabled: Record<string, boolean> = {}

export const plugins = new PluginManager(
  pluginDirs,
  (id) => enabled[id] === true,
  (line) => console.log(line)
)

/** Uygulama açılırken: etkin eklentileri yükler (pencereden önce, sağlayıcılar hazır olsun) */
export async function loadPlugins(): Promise<void> {
  enabled = (await loadSettings()).plugins ?? {}
  await plugins.reload()
}

export function registerPluginsIpc(): void {
  ipcMain.handle('plugins:list', () => plugins.list())
  ipcMain.handle('plugins:reload', async () => {
    enabled = (await loadSettings()).plugins ?? {}
    return plugins.reload()
  })
  ipcMain.handle('plugins:setEnabled', async (_e, id: string, on: boolean) => {
    const s = await loadSettings()
    enabled = { ...(s.plugins ?? {}), [id]: on }
    await saveSettings({ ...s, plugins: enabled })
    return plugins.reload()
  })
  ipcMain.handle('plugins:openFolder', async () => {
    const dir = pluginDirs()[0]
    await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })
  ipcMain.handle('llm:providers', () => providerInfos())
}
