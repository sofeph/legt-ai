import { contextBridge, ipcRenderer } from 'electron'
import type { OllamaEvent } from '../core/types'
import type { LegtApi, LlmEvent } from './api'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: LegtApi = {
  platform: process.platform,
  html: {
    preAnalyze: (sources) => invoke('html:preAnalyze', sources),
    pickSources: () => invoke('html:pickSources'),
    pickFolder: () => invoke('html:pickFolder'),
    fromUrl: (url) => invoke('html:fromUrl', url),
    fromScreenshot: () => invoke('html:fromScreenshot'),
    visionStatus: () => invoke('vision:status'),
    cancel: () => invoke('intake:cancel'),
    onEvent: (cb) => {
      const listener = (_: unknown, e: { message: string }): void => cb(e)
      ipcRenderer.on('intake:event', listener)
      return () => ipcRenderer.removeListener('intake:event', listener)
    }
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
  ollama: {
    status: () => invoke('ollama:status'),
    install: () => invoke('ollama:install'),
    start: () => invoke('ollama:start'),
    pull: (model) => invoke('ollama:pull', model),
    applyParallel: () => invoke('ollama:applyParallel'),
    cancel: () => invoke('ollama:cancel'),
    onEvent: (cb) => {
      const listener = (_: unknown, e: OllamaEvent): void => cb(e)
      ipcRenderer.on('ollama:event', listener)
      return () => ipcRenderer.removeListener('ollama:event', listener)
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
  plugins: {
    list: () => invoke('plugins:list'),
    reload: () => invoke('plugins:reload'),
    setEnabled: (id, on) => invoke('plugins:setEnabled', id, on),
    openFolder: () => invoke('plugins:openFolder'),
    providers: () => invoke('llm:providers')
  },
  wptest: {
    status: (id) => invoke('wptest:status', id),
    setupRuntime: () => invoke('wptest:setupRuntime'),
    cancelSetup: () => invoke('wptest:cancelSetup'),
    onSetupEvent: (cb) => {
      const listener = (_: unknown, e: { step: string; message: string; percent: number | null }): void => cb(e)
      ipcRenderer.on('runtime:event', listener)
      return () => ipcRenderer.removeListener('runtime:event', listener)
    },
    run: (id, options) => invoke('projects:test', id, options),
    report: (id) => invoke('wptest:report', id),
    shot: (id, file) => invoke('wptest:shot', id, file),
    site: (id) => invoke('wptest:site', id),
    openSite: (id) => invoke('wptest:openSite', id),
    stopSite: (id) => invoke('wptest:stopSite', id)
  }
}

contextBridge.exposeInMainWorld('legt', api)
