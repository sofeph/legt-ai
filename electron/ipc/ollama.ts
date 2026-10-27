import { ipcMain, shell, type BrowserWindow } from 'electron'
import {
  DOWNLOAD_PAGE,
  ensureParallel,
  findOllama,
  installOllama,
  listInstalledModels,
  manualParallelCommand,
  pullModel,
  readParallel,
  startOllama
} from '../../core/ollama/setup'
import { clampConcurrency } from '../../core/pool'
import type { LLMSettings, OllamaEvent, OllamaStatus, OllamaStep } from '../../core/types'
import { loadSettings } from './fs'

const isLocal = (url: string): boolean => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(url)

/**
 * Üretim / canlı test başlarken: yerel Ollama için OLLAMA_NUM_PARALLEL paralel ajan sayısına getirilir
 * (gerekirse kalıcı yazılıp Ollama yeniden başlatılır). Hata işi durdurmaz; yalnızca paralellik kaybolur.
 */
export async function autoParallel(settings: LLMSettings, log?: (message: string) => void): Promise<void> {
  if (settings.provider !== 'ollama' || !isLocal(settings.baseUrl)) return
  const wanted = clampConcurrency(settings.concurrency)
  try {
    const before = await readParallel()
    const ok = await ensureParallel(settings.baseUrl, wanted)
    if (!ok) log?.(`OLLAMA_NUM_PARALLEL=${wanted} elle ayarlanmalı:\n${manualParallelCommand(wanted)}`)
    else if (wanted > 1 && (before ?? 0) < wanted) log?.(`OLLAMA_NUM_PARALLEL=${wanted} yazıldı ve Ollama yeniden başlatıldı`)
  } catch (e) {
    log?.(`Paralel ayar uygulanamadı: ${(e as Error).message}`)
  }
}

export function registerOllamaIpc(getWindow: () => BrowserWindow | null): void {
  const emit = (e: OllamaEvent): void => getWindow()?.webContents.send('ollama:event', e)
  let current: AbortController | null = null

  const status = async (): Promise<OllamaStatus> => {
    const s = await loadSettings()
    const wanted = clampConcurrency(s.concurrency)
    const [exePath, models, numParallel] = await Promise.all([findOllama(), listInstalledModels(s.baseUrl), readParallel()])
    return {
      platform: process.platform,
      installed: exePath !== null,
      exePath,
      running: models !== null,
      models: models ?? [],
      numParallel,
      wantedParallel: wanted,
      manualCommand: manualParallelCommand(wanted)
    }
  }

  /** Tek seferde tek kurulum işlemi; hata UI'a olay olarak da iletilir */
  const task = async (step: OllamaStep, fn: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    if (current) throw new Error('Başka bir kurulum işlemi sürüyor')
    const ctrl = new AbortController()
    current = ctrl
    try {
      await fn(ctrl.signal)
      emit({ type: 'done', step })
    } catch (e) {
      const message = ctrl.signal.aborted ? 'İptal edildi' : (e as Error).message
      emit({ type: 'error', step, message })
      throw new Error(message)
    } finally {
      current = null
    }
  }

  ipcMain.handle('ollama:status', status)
  ipcMain.handle('ollama:cancel', () => current?.abort())

  ipcMain.handle('ollama:install', () =>
    task('install', async (signal) => {
      emit({ type: 'step', step: 'install', message: 'Ollama indiriliyor…' })
      const ok = await installOllama((percent) => emit({ type: 'progress', step: 'install', percent, message: `İndiriliyor %${percent}` }), signal)
      if (!ok) {
        // Windows dışında (ya da kurulum doğrulanamadıysa) resmi sayfa açılır
        await shell.openExternal(DOWNLOAD_PAGE)
        throw new Error('Ollama bu sistemde otomatik kurulamıyor; açılan sayfadan kurup "Yenile"ye basın')
      }
    })
  )

  ipcMain.handle('ollama:start', () =>
    task('start', async (signal) => {
      const s = await loadSettings()
      emit({ type: 'step', step: 'start', message: 'Ollama başlatılıyor…' })
      await startOllama(s.baseUrl, s.concurrency, signal)
    })
  )

  ipcMain.handle('ollama:pull', (_e, model: string) =>
    task('pull', async (signal) => {
      if (!/^[\w.\-/:]+$/.test(model)) throw new Error('Geçersiz model adı')
      const s = await loadSettings()
      emit({ type: 'step', step: 'pull', message: `${model} indiriliyor…` })
      await pullModel(s.baseUrl, model, (percent, message) => emit({ type: 'progress', step: 'pull', percent, message }), signal)
    })
  )

  ipcMain.handle('ollama:applyParallel', () =>
    task('parallel', async (signal) => {
      const s = await loadSettings()
      emit({ type: 'step', step: 'parallel', message: `OLLAMA_NUM_PARALLEL=${clampConcurrency(s.concurrency)} uygulanıyor…` })
      const ok = await ensureParallel(s.baseUrl, s.concurrency, signal)
      if (!ok) throw new Error(`Ollama dışarıdan yönetiliyor; şu komutu elle çalıştırın:\n${manualParallelCommand(s.concurrency)}`)
    })
  )
}
