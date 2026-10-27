import { useEffect, useState, type JSX } from 'react'
import {
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
  Subtitle2,
  Text
} from '@fluentui/react-components'
import { ArrowDownloadRegular, CloudRegular, ServerRegular } from '@fluentui/react-icons'
import type { VisionStatus } from '../../electron/api'

const TEXT: Record<NonNullable<VisionStatus['reason']>, string> = {
  'ollama-down': 'Ollama çalışmıyor ya da kurulu değil. Ekran görüntüsünü okumak için görsel destekli bir model gerekir.',
  'no-vision-model': 'Kurulu modellerin hiçbiri görsel (ekran görüntüsü) girdisini desteklemiyor.',
  'provider-no-vision': 'Seçili sağlayıcı görsel girdiyi desteklemiyor.'
}

/** Görsel model yoksa: yerel model indirme ya da bulut sağlayıcı seçme yönlendirmesi */
export function VisionHelp({ open, status, onClose, onReady }: { open: boolean; status: VisionStatus | null; onClose: () => void; onReady: () => void }): JSX.Element {
  const [busy, setBusy] = useState<{ model: string; percent: number | null; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    return window.legt.ollama.onEvent((e) => {
      if (e.type === 'progress' && e.step === 'pull') setBusy((b) => (b ? { ...b, percent: e.percent, message: e.message } : b))
    })
  }, [open])

  const pull = async (model: string): Promise<void> => {
    setError(null)
    setBusy({ model, percent: null, message: 'Başlıyor…' })
    try {
      await window.legt.ollama.pull(model)
      // Ana kod modeli değişmez; yalnızca ekran görüntüsü adımı bu modeli kullanır
      const cfg = await window.legt.settings.get()
      await window.legt.settings.set({ ...cfg, visionModel: model })
      setBusy(null)
      onReady()
    } catch (e) {
      setBusy(null)
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const local = status?.provider === 'ollama'
  const goto = (event: string): void => {
    onClose()
    window.dispatchEvent(new CustomEvent(event))
  }

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface style={{ maxWidth: 620 }}>
        <DialogBody>
          <DialogTitle>Görsel destekli model gerekli</DialogTitle>
          <DialogContent>
            <div className="flex flex-col gap-3">
              <Body1>{status?.reason ? TEXT[status.reason] : 'Ekran görüntüsünden tema için görsel destekli bir model gerekir.'}</Body1>

              {local && (
                <div className="flex flex-col gap-2">
                  <Subtitle2>
                    <ServerRegular /> Yerel model indir (ücretsiz, veri bilgisayardan çıkmaz)
                  </Subtitle2>
                  {status.reason === 'ollama-down' ? (
                    <Button onClick={() => goto('legt:open-ollama')}>Ollama kurulumunu aç</Button>
                  ) : (
                    status.suggestions.map((m) => (
                      <div key={m.name} className="flex items-center gap-3">
                        <Button icon={<ArrowDownloadRegular />} disabled={!!busy} onClick={() => void pull(m.name)}>
                          {m.label}
                        </Button>
                        <Caption1>{m.note}</Caption1>
                      </div>
                    ))
                  )}
                  {busy && (
                    <div className="flex flex-col gap-1">
                      <Text>
                        {busy.model} indiriliyor… {busy.percent !== null ? `%${busy.percent}` : ''}
                      </Text>
                      <ProgressBar value={busy.percent === null ? undefined : busy.percent / 100} />
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Subtitle2>
                  <CloudRegular /> Ya da bulut sağlayıcı kullan
                </Subtitle2>
                <Caption1>
                  Görsel girdiyi destekleyen bir bulut sağlayıcı eklentisi varsa Ayarlar &gt; Eklentiler'den açıp sağlayıcı olarak seçin; ekran görüntüsü o sağlayıcıya gönderilir (veri bilgisayardan çıkar).
                </Caption1>
                <div>
                  <Button onClick={() => goto('legt:open-settings')}>Ayarları aç</Button>
                </div>
              </div>

              {error && (
                <MessageBar intent="error">
                  <MessageBarBody style={{ whiteSpace: 'pre-wrap' }}>{error}</MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button disabled={!!busy} onClick={onClose}>
              Kapat
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
