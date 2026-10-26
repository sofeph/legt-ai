import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { IntakeInput, Plan, PreAnalysis, ProjectMeta, ProjectState } from '../types'

export type { FileStatus, ProjectMeta, ProjectState } from '../types'

/**
 * Proje klasörü düzeni:
 *   projects/{id}/intake.json   preanalysis.json   plan.json   state.json
 *   projects/{id}/output/...    üretilen tema ve eklenti dosyaları
 *   projects/{id}/log/...       her LLM çağrısının prompt + yanıtı
 */
export class ProjectStore {
  constructor(public readonly root: string) {}

  /** Paralel ajanlar aynı dosyaya (state.json) ya da log klasörüne aynı anda yazmasın: yol başına sıra */
  private queues = new Map<string, Promise<unknown>>()

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(fn)
    this.queues.set(key, next)
    void next.finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key)
    }).catch(() => undefined)
    return next
  }

  dir(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`Geçersiz proje id: ${id}`)
    return join(this.root, id)
  }

  /** Proje içi yol; dışarı kaçmayı (../) engeller */
  safePath(id: string, rel: string): string {
    const base = this.dir(id)
    const full = resolve(base, rel)
    if (full !== base && !full.startsWith(base + sep)) throw new Error(`Proje dışına yazma engellendi: ${rel}`)
    return full
  }

  async readJson<T>(id: string, name: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.safePath(id, name), 'utf8')) as T
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  async writeJson(id: string, name: string, data: unknown): Promise<void> {
    await this.writeText(id, name, JSON.stringify(data, null, 2) + '\n')
  }

  async writeBinary(id: string, rel: string, content: Buffer): Promise<void> {
    const full = this.safePath(id, rel)
    await this.serial(full, async () => {
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content)
    })
  }

  async writeText(id: string, rel: string, content: string): Promise<void> {
    const full = this.safePath(id, rel)
    await this.serial(full, async () => {
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content)
    })
  }

  async create(input: IntakeInput, pre: PreAnalysis): Promise<string> {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const id = `${input.theme.slug}-${stamp}`
    await this.writeJson(id, 'intake.json', input)
    await this.writeJson(id, 'preanalysis.json', pre)
    await this.saveState(id, { step: 'intake', files: {}, updatedAt: '' })
    return id
  }

  async saveState(id: string, state: ProjectState): Promise<void> {
    await this.writeJson(id, 'state.json', { ...state, updatedAt: new Date().toISOString() })
  }

  async savePlan(id: string, plan: Plan, step: ProjectState['step']): Promise<void> {
    await this.writeJson(id, 'plan.json', plan)
    const state = (await this.readJson<ProjectState>(id, 'state.json')) ?? { step, files: {}, updatedAt: '' }
    for (const f of plan.files) state.files[f.path] ??= { status: 'pending', attempts: 0 }
    for (const p of Object.keys(state.files)) if (!plan.files.some((f) => f.path === p)) delete state.files[p]
    await this.saveState(id, { ...state, step })
  }

  async list(): Promise<ProjectMeta[]> {
    let ids: string[]
    try {
      ids = await readdir(this.root)
    } catch {
      return []
    }
    const metas: ProjectMeta[] = []
    for (const id of ids) {
      if (!/^[\w-]+$/.test(id)) continue
      const intake = await this.readJson<IntakeInput>(id, 'intake.json').catch(() => null)
      const state = await this.readJson<ProjectState>(id, 'state.json').catch(() => null)
      if (intake && state) metas.push({ id, name: intake.theme.name, mode: intake.mode, step: state.step, updatedAt: state.updatedAt })
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** log/{sıra}-{etiket}.md olarak prompt + yanıt */
  async log(id: string, label: string, entry: { system: string; user: string; response: string; error?: string }): Promise<void> {
    const logDir = this.safePath(id, 'log')
    // Sıra numarası okunup dosya yazılana kadar başka log araya girmesin
    await this.serial(logDir, () => this.writeLog(logDir, label, entry))
  }

  private async writeLog(logDir: string, label: string, entry: { system: string; user: string; response: string; error?: string }): Promise<void> {
    await mkdir(logDir, { recursive: true })
    const n = (await readdir(logDir)).length + 1
    const safe = label.replace(/[^\w.-]+/g, '_').slice(0, 80)
    const body = [
      `# ${label}`,
      `_${new Date().toISOString()}_`,
      '## system',
      entry.system,
      '## user',
      entry.user,
      '## response',
      entry.response,
      ...(entry.error ? ['## error', entry.error] : [])
    ].join('\n\n')
    await writeFile(join(logDir, `${String(n).padStart(4, '0')}-${safe}.md`), body)
  }

  relative(id: string, full: string): string {
    return relative(this.dir(id), full)
  }
}
