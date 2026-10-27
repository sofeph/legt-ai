import { dialog, ipcMain, safeStorage, shell, type BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import { extractTokens } from '../../core/html/extractTokens'
import { extractDemoContent } from '../../core/html/demoContent'
import { safeSourceName, scanSiteFolder, type FolderScan } from '../../core/html/siteFolder'
import { splitSections } from '../../core/html/splitSections'
import { coerceControls, normalizePlan } from '../../core/pipeline/layout'
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
  return { sections: splitSections(html, js), tokens: extractTokens(html, css), demo: extractDemoContent(sources) }
}

type StoredSettings = LLMSettings & { apiKeyEnc?: string }

export async function loadSettings(): Promise<LLMSettings> {
  try {
    const { apiKeyEnc, ...s }: StoredSettings = { ...DEFAULT_LLM_SETTINGS, ...JSON.parse(await readFile(settingsFile(), 'utf8')) }
    if (apiKeyEnc && safeStorage.isEncryptionAvailable()) {
      try {
        s.apiKey = safeStorage.decryptString(Buffer.from(apiKeyEnc, 'base64'))
      } catch {
        // Başka kullanıcı/makinede şifrelenmiş anahtar çözülemez; kullanıcı yeniden girer
        s.apiKey = ''
      }
    }
    return { ...s, concurrency: clampConcurrency(s.concurrency) }
  } catch {
    return { ...DEFAULT_LLM_SETTINGS }
  }
}

/** API anahtarı düz metin yazılmaz: işletim sisteminin anahtar deposuyla (Windows DPAPI, macOS Keychain) şifrelenir */
export async function saveSettings(s: LLMSettings): Promise<void> {
  const { apiKey, ...rest } = { ...s, concurrency: clampConcurrency(s.concurrency) }
  const stored: StoredSettings = { ...rest }
  if (apiKey) {
    if (safeStorage.isEncryptionAvailable()) stored.apiKeyEnc = safeStorage.encryptString(apiKey).toString('base64')
    else stored.apiKey = apiKey
  }
  await mkdir(dirname(settingsFile()), { recursive: true })
  await writeFile(settingsFile(), JSON.stringify(stored, null, 2))
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

  // Site klasörü (public_html, dist, www...): içindeki HTML/CSS/JS dosyaları tek seferde
  ipcMain.handle('html:pickFolder', async (): Promise<FolderScan | null> => {
    const win = getWindow()
    const opts = { title: 'Site klasörünü seçin (ör. public_html)', properties: ['openDirectory'] as 'openDirectory'[] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    return scanSiteFolder(res.filePaths[0])
  })

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', async (_e, s: LLMSettings) => {
    // Eklenti açık/kapalı durumu Ayarlar > Eklentiler'den yönetilir; diyalogdaki eski kopya üzerine yazmasın
    const plugins = (await loadSettings()).plugins
    await saveSettings({ ...s, ...(plugins ? { plugins } : {}) })
  })

  ipcMain.handle('projects:list', () => store().list())

  ipcMain.handle('projects:create', async (_e, input: IntakeInput) => {
    assertIntake(input)
    const s = store()
    const pre = preAnalyze(input.sources)
    // Medya ikili dosya olarak sources/ altına yazılır; intake.json'a (her çağrıda okunan) base64 girmez
    const id = await s.create({ ...input, sources: input.sources.filter((src) => src.kind !== 'media') }, pre)
    // Göreli yol korunur: çok sayfalı sitede "index.html" ile "blog/index.html" çakışmaz
    for (const src of input.sources) {
      const rel = `sources/${safeSourceName(src.name)}`
      if (src.kind === 'media') await s.writeBinary(id, rel, Buffer.from(src.content, 'base64'))
      else await s.writeText(id, rel, src.content)
    }
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
    return { id, intake, pre, plan: coerceControls(plan), state }
  })

  ipcMain.handle('projects:savePlan', async (_e, id: string, plan: Plan, approve: boolean) => {
    // Elle düzenlenen widget/pattern adları da önek ve slug kurallarına uydurulur
    await store().savePlan(id, normalizePlan(plan), approve ? 'approved' : 'analyzed')
  })

  ipcMain.handle('projects:openFolder', async (_e, id: string) => {
    await shell.openPath(store().dir(id))
  })
}
