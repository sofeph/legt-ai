import { useCallback, useEffect, useState, type JSX } from 'react'
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Radio,
  RadioGroup,
  Spinner,
  SpinButton,
  Subtitle2,
  Text
} from '@fluentui/react-components'
import { ArrowDownloadRegular, CheckmarkCircleFilled, CircleRegular, PlayRegular, SparkleRegular } from '@fluentui/react-icons'
import { CONCURRENCY, clampConcurrency } from '../../core/pool'
import { DEFAULT_LLM_SETTINGS, type LLMSettings, type OllamaEvent, type OllamaStatus, type OllamaStep } from '../../core/types'

const MODELS = [
  { name: 'qwen2.5-coder:7b', label: 'Qwen2.5 Coder 7B', note: '~4,7 GB · önerilen (6-8 GB ekran kartı ya da 16 GB RAM)' },
  { name: 'qwen2.5-coder:14b', label: 'Qwen2.5 Coder 14B', note: '~9 GB · daha kaliteli (12 GB+ ekran kartı)' },
  { name: 'qwen2.5-coder:3b', label: 'Qwen2.5 Coder 3B', note: '~1,9 GB · zayıf bilgisayarlar için, kalite düşük olabilir' }
]

interface Busy {
  step: OllamaStep
  message: string
  percent: number | null
}

function Row({ done, title, hint, children }: { done: boolean; title: string; hint?: string; children?: JSX.Element | null }): JSX.Element {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="pt-1">{done ? <CheckmarkCircleFilled primaryFill="#107c10" fontSize={20} /> : <CircleRegular fontSize={20} />}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Subtitle2>{title}</Subtitle2>
        {hint && <Caption1>{hint}</Caption1>}
        {children}
      </div>
    </div>
  )
}

/** Ollama kurulu olmayan / çalışmayan / modeli olmayan kullanıcılar için adım adım kurulum */
export function OllamaSetup({ open, onClose, onReady }: { open: boolean; onClose: () => void; onReady?: () => void }): JSX.Element {
  const [st, setSt] = useState<OllamaStatus | null>(null)
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_LLM_SETTINGS)
  const [model, setModel] = useState(MODELS[0].name)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<OllamaStatus> => {
    const [s, cfg] = await Promise.all([window.legt.ollama.status(), window.legt.settings.get()])
    setSt(s)
    setSettings(cfg)
    return s
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
    return window.legt.ollama.onEvent((e: OllamaEvent) => {
      if (e.type === 'step') setBusy({ step: e.step, message: e.message, percent: null })
      else if (e.type === 'progress') setBusy({ step: e.step, message: e.message, percent: e.percent })
      else if (e.type === 'done') setBusy(null)
      else if (e.type === 'error') {
        setBusy(null)
        setError(e.message)
      }
    })
  }, [open, refresh])

  /** Bir adımı çalıştırır; hata olay olarak da gelir, burada yalnızca akışı keser */
  const step = async (fn: () => Promise<void>): Promise<boolean> => {
    setError(null)
    try {
      await fn()
      await refresh()
      return true
    } catch (e) {
      setError((e as Error).message)
      await refresh()
      return false
    }
  }

  const selectModel = async (name: string): Promise<void> => {
    const cfg = await window.legt.settings.get()
    if (!cfg.model || !st?.models.includes(cfg.model)) await window.legt.settings.set({ ...cfg, model: name })
  }

  const setParallel = async (n: number): Promise<void> => {
    const cfg = { ...settings, concurrency: clampConcurrency(n) }
    setSettings(cfg)
    await window.legt.settings.set(cfg)
  }

  const runAll = async (): Promise<void> => {
    let s = st ?? (await refresh())
    if (!s.installed && !(await step(() => window.legt.ollama.install()))) return
    s = await refresh()
    if (!s.running && !(await step(() => window.legt.ollama.start()))) return
    s = await refresh()
    if (!s.models.length && !(await step(() => window.legt.ollama.pull(model)))) return
    await selectModel(s.models[0] ?? model)
    if (!(await step(() => window.legt.ollama.applyParallel()))) return
    const fin = await refresh()
    if (fin.installed && fin.running && fin.models.length) onReady?.()
  }

  const parallelOk = !!st && (st.wantedParallel <= 1 || (st.numParallel ?? 0) >= st.wantedParallel)
  const ready = !!st && st.installed && st.running && st.models.length > 0
  const working = busy !== null

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && !working && onClose()}>
      <DialogSurface style={{ maxWidth: 620 }}>
        <DialogBody>
          <DialogTitle>Ollama kurulumu</DialogTitle>
          <DialogContent>
            <div className="flex flex-col gap-1">
              <Body1>LEGT AI yerel bir model ile çalışır. Aşağıdaki adımlar eksikleri tamamlar; hiçbir proje verisi dışarı gönderilmez (yalnızca Ollama ve model indirilir).</Body1>
              {!st && <Spinner size="small" label="Denetleniyor…" />}
              {st && (
                <>
                  <Row done={st.installed} title="1. Ollama" hint={st.installed ? st.exePath ?? 'Kurulu' : st.platform === 'win32' ? 'Resmi yükleyici indirilip sessizce kurulur (ollama.com).' : 'Bu sistemde resmi indirme sayfası açılır; kurduktan sonra Yenile.'}>
                    {!st.installed ? (
                      <div>
                        <Button icon={<ArrowDownloadRegular />} disabled={working} onClick={() => void step(() => window.legt.ollama.install())}>
                          Ollama'yı kur
                        </Button>
                      </div>
                    ) : null}
                  </Row>
                  <Row done={st.running} title="2. Servis" hint={st.running ? 'Ollama çalışıyor' : 'Ollama kurulu ama çalışmıyor.'}>
                    {st.installed && !st.running ? (
                      <div>
                        <Button icon={<PlayRegular />} disabled={working} onClick={() => void step(() => window.legt.ollama.start())}>
                          Başlat
                        </Button>
                      </div>
                    ) : null}
                  </Row>
                  <Row done={st.models.length > 0} title="3. Model" hint={st.models.length ? `Kurulu: ${st.models.slice(0, 4).join(', ')}${st.models.length > 4 ? '…' : ''}` : 'Kod üretimi için bir model indirin.'}>
                    {st.running ? (
                      <div className="flex flex-col gap-2">
                        <RadioGroup value={model} onChange={(_, d) => setModel(d.value)} disabled={working}>
                          {MODELS.map((m) => (
                            <Radio key={m.name} value={m.name} label={{ children: <Text>{m.label} <Caption1>— {m.note}</Caption1></Text> }} />
                          ))}
                        </RadioGroup>
                        <div>
                          <Button
                            icon={<ArrowDownloadRegular />}
                            disabled={working}
                            onClick={() =>
                              void step(async () => {
                                await window.legt.ollama.pull(model)
                                await selectModel(model)
                              })
                            }
                          >
                            {st.models.includes(model) ? 'Yeniden indir / güncelle' : 'İndir'}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </Row>
                  <Row
                    done={parallelOk}
                    title="4. Paralel ajan"
                    hint={`Ollama aynı anda ${st.numParallel ?? 1} istek işliyor. Paralel ajan sayısı kadar olması için OLLAMA_NUM_PARALLEL otomatik yazılır (üretim ve test başlarken de kontrol edilir).`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <SpinButton
                        value={settings.concurrency}
                        min={CONCURRENCY.min}
                        max={CONCURRENCY.max}
                        disabled={working}
                        onChange={(_, d) => void setParallel(d.value ?? Number(d.displayValue) ?? CONCURRENCY.default)}
                      />
                      <Button disabled={working || !st.installed} onClick={() => void step(() => window.legt.ollama.applyParallel())}>
                        Uygula
                      </Button>
                      {st.platform !== 'win32' && !parallelOk && <Caption1>Windows dışında elle: <code>{st.manualCommand.split('\n')[0]}</code></Caption1>}
                    </div>
                  </Row>
                </>
              )}
              {busy && (
                <div className="flex flex-col gap-1 pt-2">
                  <Text>{busy.message}</Text>
                  <ProgressBar value={busy.percent === null ? undefined : busy.percent / 100} />
                </div>
              )}
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody style={{ whiteSpace: 'pre-wrap' }}>{error}</MessageBarBody>
                </MessageBar>
              )}
              {ready && !busy && (
                <MessageBar intent="success">
                  <MessageBarBody>
                    Hazır <Badge appearance="tint" color="success">Ollama</Badge> — modeli Ayarlar'dan değiştirebilirsiniz.
                  </MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" icon={<SparkleRegular />} disabled={working || ready && parallelOk} onClick={() => void runAll()}>
              Hepsini otomatik yap
            </Button>
            {working ? (
              <Button onClick={() => void window.legt.ollama.cancel()}>İptal</Button>
            ) : (
              <>
                <Button onClick={() => void refresh()}>Yenile</Button>
                <Button appearance={ready ? 'primary' : 'secondary'} onClick={onClose}>
                  {ready ? 'Kapat' : 'Atla (başka sunucu kullanacağım)'}
                </Button>
              </>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
