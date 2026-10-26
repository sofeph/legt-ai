import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { registerFsIpc } from './ipc/fs'
import { registerLlmIpc } from './ipc/llm'
import { registerPackageIpc } from './ipc/package'
import { registerValidateIpc } from './ipc/validate'
import { registerWptestIpc, shutdownWptest } from './ipc/wptest'
import { loadPlugins, registerPluginsIpc } from './ipc/plugins'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const isWin = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'LEGT AI',
    // Windows 11: Mica, macOS: vibrancy; diğerlerinde düz arka plan (renderer degrade çizer)
    ...(isWin ? { backgroundMaterial: 'mica' as const, backgroundColor: '#00000000' } : {}),
    ...(isMac ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const, titleBarStyle: 'hiddenInset' as const } : {}),
    ...(!isWin && !isMac ? { backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3' } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Dış bağlantılar tarayıcıda açılır; uygulama içinde başka sayfaya gidilmez
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow?.webContents.getURL()) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))

  mainWindow.on('closed', () => (mainWindow = null))
}

const getWindow = (): BrowserWindow | null => mainWindow

app.whenReady().then(async () => {
  // Etkin eklentiler pencereden önce yüklenir; biri bozuksa uygulama yine açılır
  await loadPlugins().catch((e) => console.error('Eklentiler yüklenemedi:', e))
  registerPluginsIpc()
  registerFsIpc(getWindow)
  registerLlmIpc(getWindow)
  registerValidateIpc()
  registerPackageIpc(getWindow)
  registerWptestIpc(getWindow)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Test sırasında açılan Apache / MariaDB süreçleri uygulamayla birlikte kapanır
app.on('before-quit', shutdownWptest)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
