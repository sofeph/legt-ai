import { contextBridge, ipcRenderer } from 'electron'
import type { LegtApi, LlmEvent } from './api'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: LegtApi = {
  platform: process.platform,
  html: {
    preAnalyze: (sources) => invoke('html:preAnalyze', sources),
    pickSources: () => invoke('html:pickSources')
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (s) => invoke('settings:set', s)
  },
  llm: {
    listModels: (s) => invoke('llm:listModels', s),
    cancel: (id) => invoke('llm:cancel', id),
    onEvent: (cb) => {
      const listener = (_: unknown, e: LlmEvent): void => cb(e)
      ipcRenderer.on('llm:event', listener)
      return () => ipcRenderer.removeListener('llm:event', listener)
    }
  },
  projects: {
    list: () => invoke('projects:list'),
    create: (input) => invoke('projects:create', input),
    load: (id) => invoke('projects:load', id),
    analyze: (id) => invoke('projects:analyze', id),
    savePlan: (id, plan, approve) => invoke('projects:savePlan', id, plan, approve),
    openFolder: (id) => invoke('projects:openFolder', id),
    generate: (id, only) => invoke('projects:generate', id, only),
    readOutput: (id, path) => invoke('projects:readOutput', id, path),
    saveOutput: (id, path, content) => invoke('projects:saveOutput', id, path, content),
    quality: (id) => invoke('projects:quality', id),
    export: (id) => invoke('projects:export', id)
  },
  validate: {
    file: (path, content, projectId) => invoke('validate:file', path, content, projectId)
  },
  wptest: {
    status: (id) => invoke('wptest:status', id),
    run: (id, options) => invoke('projects:test', id, options),
    report: (id) => invoke('wptest:report', id),
    shot: (id, file) => invoke('wptest:shot', id, file),
    site: (id) => invoke('wptest:site', id),
    openSite: (id) => invoke('wptest:openSite', id),
    stopSite: (id) => invoke('wptest:stopSite', id)
  }
}

contextBridge.exposeInMainWorld('legt', api)
