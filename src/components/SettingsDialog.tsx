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
  SpinButton
} from '@fluentui/react-components'
import { ArrowSyncRegular } from '@fluentui/react-icons'
import { CONCURRENCY, clampConcurrency } from '../../core/pool'
import { DEFAULT_LLM_SETTINGS, type LLMSettings, type ModelInfo } from '../../core/types'

const DEFAULT_URLS: Record<LLMSettings['provider'], string> = {
  ollama: 'http://localhost:11434',
  'openai-compat': 'http://localhost:1234/v1'
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const [s, setS] = useState<LLMSettings>(DEFAULT_LLM_SETTINGS)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) void window.legt.settings.get().then(setS)
  }, [open])

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
                value={s.provider === 'ollama' ? 'Ollama' : 'OpenAI uyumlu (LM Studio, llama.cpp…)'}
                selectedOptions={[s.provider]}
                onOptionSelect={(_, d) => {
                  const provider = d.optionValue as LLMSettings['provider']
                  setS({ ...s, provider, baseUrl: DEFAULT_URLS[provider] })
                  setModels([])
                }}
              >
                <Option value="ollama">Ollama</Option>
                <Option value="openai-compat">OpenAI uyumlu (LM Studio, llama.cpp…)</Option>
              </Dropdown>
            </Field>
            <Field label="Adres">
              <Input value={s.baseUrl} onChange={(_, d) => setS({ ...s, baseUrl: d.value })} />
            </Field>
            {s.provider === 'openai-compat' && (
              <Field label="API anahtarı (gerekirse)">
                <Input type="password" value={s.apiKey ?? ''} onChange={(_, d) => setS({ ...s, apiKey: d.value })} />
              </Field>
            )}
            <div className="flex items-end gap-2">
              <Field label="Model" className="flex-1" hint="Kod odaklı, 7B ve üzeri bir model önerilir (ör. Qwen Coder ailesi)">
                {models.length ? (
                  <Dropdown value={s.model} selectedOptions={[s.model]} onOptionSelect={(_, d) => setS({ ...s, model: d.optionValue ?? '' })}>
                    {models.map((m) => (
                      <Option key={m.name} value={m.name}>
                        {m.paramsB ? `${m.name} (${m.paramsB}B)` : m.name}
                      </Option>
                    ))}
                  </Dropdown>
                ) : (
                  <Input value={s.model} placeholder="ör. qwen2.5-coder:14b" onChange={(_, d) => setS({ ...s, model: d.value })} />
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
