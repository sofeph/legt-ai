import { readFile } from 'node:fs/promises'
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { captureUrl, type UrlScan } from '../../core/html/siteUrl'
import { createProvider } from '../../core/llm/provider'
import { isVisionName, ollamaModelHasVision, VISION_MODELS } from '../../core/llm/vision'
import { screenshotToSources } from '../../core/pipeline/fromScreenshot'
import { providerInfos } from '../../core/plugins/manager'
import type { LLMSettings } from '../../core/types'
import { openBrowser } from '../../core/wptest/browser'
import { runtimePaths } from '../../core/wptest/runtime'
import type { ScreenshotResult, VisionStatus } from '../api'
import { promptsDir, runtimeDir } from '../paths'
import { loadSettings } from './fs'
import { listInstalledModels } from '../../core/ollama/setup'

let current: AbortController | null = null

/** Ekran görüntüsü için hangi model kullanılacak: Ollama/OpenAI uyumlu'da visionModel, eklentilerde kendi modeli */
export async function visionStatus(s: LLMSettings): Promise<VisionStatus> {
  const info = providerInfos().find((p) => p.id === s.provider)
  const base: Pick<VisionStatus, 'provider' | 'remote' | 'suggestions'> = { provider: s.provider, remote: !!info?.remote, suggestions: VISION_MODELS }
  if (s.provider === 'ollama') {
    const installed = (await listInstalledModels(s.baseUrl)) ?? []
    const candidates = [s.visionModel, s.model, ...installed].filter((m): m is string => !!m)
    for (const m of candidates) {
      if (installed.includes(m) && (await ollamaModelHasVision(s.baseUrl, m))) return { ...base, ok: true, model: m, installedVision: installed.filter((x) => isVisionName(x)) }
    }
    return { ...base, ok: false, model: '', installedVision: [], reason: installed.length || (await listInstalledModels(s.baseUrl)) !== null ? 'no-vision-model' : 'ollama-down' }
  }
  if (s.provider === 'openai-compat') {
    const m = [s.visionModel, s.model].find((x) => x && isVisionName(x))
    return m ? { ...base, ok: true, model: m, installedVision: [] } : { ...base, ok: false, model: '', installedVision: [], reason: 'no-vision-model' }
  }
  // Eklenti sağlayıcıları (bulut eklentileri): sağlayıcı görsel destekliyorsa seçili model kullanılır
  return info?.vision ? { ...base, ok: true, model: s.model, installedVision: [] } : { ...base, ok: false, model: '', installedVision: [], reason: 'provider-no-vision' }
}

export function registerCaptureIpc(getWindow: () => BrowserWindow | null): void {
  const emit = (message: string): void => getWindow()?.webContents.send('intake:event', { message })

  ipcMain.handle('intake:cancel', () => current?.abort())

  ipcMain.handle('vision:status', async () => visionStatus(await loadSettings()))

  ipcMain.handle('html:fromUrl', async (_e, url: string): Promise<UrlScan> => {
    if (current) throw new Error('Başka bir işlem sürüyor')
    const ctrl = new AbortController()
    current = ctrl
    try {
      emit('Tarayıcı açılıyor…')
      const browser = await openBrowser(runtimePaths(runtimeDir()).browsers, emit)
      try {
        return await captureUrl(browser, url, emit, ctrl.signal)
      } finally {
        await browser.close()
      }
    } finally {
      current = null
    }
  })

  ipcMain.handle('html:fromScreenshot', async (): Promise<ScreenshotResult> => {
    if (current) throw new Error('Başka bir işlem sürüyor')
    const settings = await loadSettings()
    const status = await visionStatus(settings)
    if (!status.ok) return { ok: false, reason: status.reason ?? 'no-vision-model', message: 'Görsel destekli bir model gerekli' }
    const win = getWindow()
    const opts = { title: 'Site ekran görüntüsünü seçin', properties: ['openFile'] as 'openFile'[], filters: [{ name: 'Görüntü', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return { ok: false, reason: 'cancelled', message: '' }
    const ctrl = new AbortController()
    current = ctrl
    try {
      emit(`${status.model} ekran görüntüsünü okuyor (bu birkaç dakika sürebilir)…`)
      let chars = 0
      const provider = await createProvider({ ...settings, model: status.model })
      const sources = await screenshotToSources({
        provider,
        promptsDir: promptsDir(),
        image: await readFile(res.filePaths[0]),
        signal: ctrl.signal,
        onToken: (c) => {
          chars += c.length
          if (chars % 400 < c.length) emit(`HTML yazılıyor… ${chars} karakter`)
        }
      })
      return {
        ok: true,
        scan: {
          url: res.filePaths[0],
          title: '',
          sources,
          warnings: [
            `HTML, ${status.model} modeliyle ekran görüntüsünden üretildi; metinlerin ve renklerin doğruluğunu önizlemeden kontrol edin.`,
            ...(status.remote ? ['Ekran görüntüsü bulut sağlayıcıya gönderildi.'] : [])
          ]
        }
      }
    } catch (e) {
      return { ok: false, reason: 'error', message: ctrl.signal.aborted ? 'İptal edildi' : (e as Error).message }
    } finally {
      current = null
    }
  })
}
