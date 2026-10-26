import { create } from 'zustand'
import type { LoadedProject, ProjectMeta } from '../../electron/api'
import type { Plan } from '../../core/types'

export type Page = 'intake' | 'plan' | 'generate' | 'test' | 'export'

interface ProjectStore {
  page: Page
  projects: ProjectMeta[]
  current: LoadedProject | null
  setPage(p: Page): void
  refreshProjects(): Promise<void>
  open(id: string): Promise<void>
  /** Sayfayı değiştirmeden mevcut projeyi diskten yeniden yükler */
  reload(): Promise<void>
  setState(state: LoadedProject['state']): void
  newProject(): void
  setPlan(plan: Plan): void
}

export const useProject = create<ProjectStore>((set, get) => ({
  page: 'intake',
  projects: [],
  current: null,
  setPage: (page) => set({ page }),
  refreshProjects: async () => set({ projects: await window.legt.projects.list() }),
  open: async (id) => {
    const current = await window.legt.projects.load(id)
    const page: Page = current.state.step === 'intake' || current.state.step === 'analyzed' ? 'plan' : current.state.step === 'done' ? 'export' : 'generate'
    set({ current, page })
  },
  reload: async () => {
    const c = get().current
    if (c) set({ current: await window.legt.projects.load(c.id) })
  },
  setState: (state) => {
    const c = get().current
    if (c) set({ current: { ...c, state } })
  },
  newProject: () => set({ current: null, page: 'intake' }),
  setPlan: (plan) => {
    const c = get().current
    if (c) set({ current: { ...c, plan } })
  }
}))
