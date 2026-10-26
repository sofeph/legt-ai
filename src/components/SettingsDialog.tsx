import { useEffect, useState, type JSX } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  SpinButton,
  Subtitle2,
  Switch,
  Caption1,
  Text
} from '@fluentui/react-components'
import { ArrowSyncRegular, FolderOpenRegular, PlugConnectedRegular } from '@fluentui/react-icons'
import type { PluginInfo, ProviderInfo } from '../../core/plugins/types'
import { CONCURRENCY, clampConcurrency } from '../../core/pool'
import { DEFAULT_LLM_SETTINGS, type LLMSettings, type ModelInfo } from '../../core/types'


export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const [s, setS] = useState<LLMSettings>(DEFAULT_LLM_SETTINGS)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [plugins, setPlugins] = useState<PluginInfo[]>([])

  useEffect(() => {
    if (!open) return
    void window.legt.settings.get().then(setS)
    void window.legt.plugins.providers().then(setProviders)
    void window.legt.plugins.list().then(setPlugins)
  }, [open])

  const togglePlugin = async (id: string, on: boolean): Promise<void> => {
    setPlugins(await window.legt.plugins.setEnabled(id, on))
    setProviders(await window.legt.plugins.providers())
  }
  const reloadPlugins = async (): Promise<void> => {
    setPlugins(await window.legt.plugins.reload())
    setProviders(await window.legt.plugins.providers())
  }
  const current = providers.find((p) => p.id === s.provider)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setStatus(null)
    try {
      const list = await window.legt.llm.listModels(s)
      setModels(list)
      setStatus({ kind: 'success', text: `Bağlantı başarılı, ${list.length} model bulundu` })
    } catch (e) {
      setModels([])
      setStatus({ kind: 'error', text: `Bağlanılamadı: ${(e as Error).message}` })
    } finally {
      setLoading(false)
    }
  }

  const selected = models.find((m) => m.name === s.model)
  const small = selected?.paramsB != null && selected.paramsB < 3

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>LLM ayarları</DialogTitle>
          <DialogContent className="flex flex-col gap-3">
            <Field label="Sağlayıcı">
              <Dropdown
                value={current?.label ?? `${s.provider} (eklentisi yüklü değil)`}
                selectedOptions={[s.provider]}
                onOptionSelect={(_, d) => {
                  const next = providers.find((p) => p.id === d.optionValue)
                  if (!next) return
                  setS({ ...s, provider: next.id, baseUrl: next.defaultBaseUrl, model: '' })
                  setModels([])
                }}
              >
                {providers.map((p) => (
                  <Option key={p.id} value={p.id} text={p.label}>
                    {p.pluginId ? `${p.label} · eklenti` : p.label}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            {current?.remote && (
              <MessageBar intent="warning">
                <MessageBarBody>Bu sağlayıcı bilgisayarınızın dışında çalışır: kaynak HTML ve üretilen kod sağlayıcının sunucusuna gönderilir.</MessageBarBody>
              </MessageBar>
            )}
            <Field label="Adres">
              <Input value={s.baseUrl} onChange={(_, d) => setS({ ...s, baseUrl: d.value })} />
            </Field>
            {current && current.apiKey !== 'none' && (
              <Field label={current.apiKey === 'required' ? 'API anahtarı' : 'API anahtarı (gerekirse)'} hint={current.apiKeyHint ?? 'Diskte işletim sisteminin anahtar deposuyla şifrelenerek saklanır'}>
                <Input type="password" value={s.apiKey ?? ''} onChange={(_, d) => setS({ ...s, apiKey: d.value })} />
              </Field>
            )}
            <div className="flex items-end gap-2">
              <Field label="Model" className="flex-1" hint={current?.modelHint ?? 'Kod odaklı, 7B ve üzeri bir model önerilir (ör. Qwen Coder ailesi)'}>
                {models.length ? (
                  <Dropdown value={s.model} selectedOptions={[s.model]} onOptionSelect={(_, d) => setS({ ...s, model: d.optionValue ?? '' })}>
                    {models.map((m) => (
                      <Option key={m.name} value={m.name}>
                        {m.paramsB ? `${m.name} (${m.paramsB}B)` : m.name}
                      </Option>
                    ))}
                  </Dropdown>
                ) : (
                  <Input value={s.model} placeholder={current?.pluginId ? 'Modelleri getir ile listeleyin' : 'ör. qwen2.5-coder:14b'} onChange={(_, d) => setS({ ...s, model: d.value })} />
                )}
              </Field>
              <Button icon={<ArrowSyncRegular />} disabled={loading} onClick={() => void refresh()}>
                Modelleri getir
              </Button>
            </div>
            {small && (
              <MessageBar intent="warning">
                <MessageBarBody>Bu model 3B'den küçük; üretilen kodun kalitesi düşük olabilir.</MessageBarBody>
              </MessageBar>
            )}
            {s.provider === 'ollama' && (
              <Field label="Bağlam boyutu (num_ctx)" hint="En az 8192 önerilir; model izin verdiği kadar yükseltin">
                <SpinButton value={s.numCtx} min={2048} max={262144} step={2048} onChange={(_, d) => setS({ ...s, numCtx: d.value ?? s.numCtx })} />
              </Field>
            )}
            <Field
              label={`Paralel ajan (${CONCURRENCY.min}-${CONCURRENCY.max})`}
              hint={
                s.provider === 'ollama'
                  ? 'Bağımsız dosyalar, test senaryoları ve onarımlar aynı anda üretilir. Ollama istekleri gerçekten paralel işlesin diye OLLAMA_NUM_PARALLEL en az bu değer olmalı; her ajan ek VRAM ister.'
                  : 'Bağımsız dosyalar, test senaryoları ve onarımlar aynı anda üretilir. Sunucunun eşzamanlı istek sınırını aşmayın.'
              }
            >
              <SpinButton
                value={s.concurrency}
                min={CONCURRENCY.min}
                max={CONCURRENCY.max}
                onChange={(_, d) => setS({ ...s, concurrency: clampConcurrency(d.value ?? d.displayValue) })}
              />
            </Field>
            {status && (
              <MessageBar intent={status.kind}>
                <MessageBarBody>{status.text}</MessageBarBody>
              </MessageBar>
            )}
            <div className="mt-2 flex items-center gap-2">
              <PlugConnectedRegular />
              <Subtitle2>Eklentiler</Subtitle2>
              <Button size="small" appearance="subtle" icon={<ArrowSyncRegular />} className="!ml-auto" onClick={() => void reloadPlugins()}>
                Yeniden yükle
              </Button>
              <Button size="small" appearance="subtle" icon={<FolderOpenRegular />} onClick={() => void window.legt.plugins.openFolder()}>
                Klasör
              </Button>
            </div>
            <Caption1>
              Eklenti klasörüne kopyalanan eklentiler burada listelenir ve siz açana kadar kapalı kalır. Eklentiler uygulamanın içinde tam yetkiyle çalışır; yalnızca güvendiğiniz eklentileri açın.
            </Caption1>
            {plugins.length === 0 && <Caption1>Kurulu eklenti yok.</Caption1>}
            {plugins.map((pl) => (
              <div key={pl.dir} className="flex items-start gap-2">
                <Switch checked={pl.enabled} onChange={(_, d) => void togglePlugin(pl.id, d.checked)} disabled={!!pl.error && !pl.enabled} />
                <div className="flex min-w-0 flex-col">
                  <Text weight="semibold">
                    {pl.name} <Caption1>{pl.version}</Caption1>
                  </Text>
                  {pl.description && <Caption1>{pl.description}</Caption1>}
                  {pl.loaded && pl.providers.length > 0 && <Caption1>Sağlayıcı: {pl.providers.join(', ')}</Caption1>}
                  {pl.error && <Caption1 style={{ color: 'var(--colorPaletteRedForeground1)' }}>{pl.error}</Caption1>}
                </div>
              </div>
            ))}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              Vazgeç
            </Button>
            <Button
              appearance="primary"
              onClick={() => {
                void window.legt.settings.set(s).then(onClose)
              }}
            >
              Kaydet
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
