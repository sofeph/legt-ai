import { app } from 'electron'
import { dirname, join } from 'node:path'

/** Geliştirmede repo kökü, paketlenmişte resources/ */
export function promptsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'prompts') : join(app.getAppPath(), 'prompts')
}

/** Geliştirmede repo kökündeki projects/, paketlenmişte kullanıcı veri klasörü */
export function projectsDir(): string {
  return app.isPackaged ? join(app.getPath('userData'), 'projects') : join(app.getAppPath(), 'projects')
}

export function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** LLM'siz şablonlar (core/scaffold/{mode}/...) */
export function scaffoldDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'scaffold') : join(app.getAppPath(), 'core', 'scaffold')
}

/**
 * Portable test ortamı (XAMPP, WordPress, Elementor). Geliştirmede repo kökündeki runtime/,
 * paketlenmişte uygulamanın yanındaki runtime/ (taşınabilir kurulum); LEGT_RUNTIME_DIR ile değiştirilebilir.
 */
export function runtimeDir(): string {
  if (process.env.LEGT_RUNTIME_DIR) return process.env.LEGT_RUNTIME_DIR
  return app.isPackaged ? join(dirname(process.execPath), 'runtime') : join(app.getAppPath(), 'runtime')
}

/** setup.php vb. canlı test betikleri */
export function wptestPhpDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'wptest-php') : join(app.getAppPath(), 'core', 'wptest', 'php')
}

/** Test siteleri (binlerce dosya) senkron klasörlere (OneDrive) değil geçici klasöre kurulur */
export function wptestWorkRoot(): string {
  return join(app.getPath('temp'), 'legt-ai-wptest')
}
