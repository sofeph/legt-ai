import { useCallback, useEffect, useState, type JSX } from 'react'
import {
  Button,
  Caption1,
  Card,
  CardHeader,
  MessageBar,
  MessageBarBody,
  Spinner,
  Subtitle2,
  Text
} from '@fluentui/react-components'
import {
  ArrowClockwiseRegular,
  CheckmarkCircleFilled,
  DismissCircleFilled,
  FolderOpenRegular,
  FolderZipRegular,
  WarningFilled
} from '@fluentui/react-icons'
import type { QualityItem } from '../../core/types'
import { useProject } from '../store/project'

const ICON = {
  pass: <CheckmarkCircleFilled style={{ color: 'var(--colorPaletteGreenForeground1)' }} />,
  warn: <WarningFilled style={{ color: 'var(--colorPaletteYellowForeground1)' }} />,
  fail: <DismissCircleFilled style={{ color: 'var(--colorPaletteRedForeground1)' }} />
}

export default function Export(): JSX.Element {
  const { current } = useProject()
  const id = current!.id
  const { slug, name } = current!.intake.theme
  const elementor = current!.intake.mode === 'elementor-free'
  const [quality, setQuality] = useState<QualityItem[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'success' | 'error' | 'warning'; text: string } | null>(null)

  const refresh = useCallback(async () => {
    setQuality(null)
    setQuality(await window.legt.projects.quality(id))
  }, [id])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const doExport = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const r = await window.legt.projects.export(id)
      if (!r) return
      const lines = r.zips.map((z) => `✓ ${z}`)
      if (r.missing.length) lines.push(`Eksik klasör: ${r.missing.join(', ')}`)
      setResult({ kind: r.missing.length ? 'warning' : 'success', text: lines.join('\n') })
    } catch (e) {
      setResult({ kind: 'error', text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      setBusy(false)
    }
  }

  const failed = quality?.filter((q) => q.status === 'fail').length ?? 0
  const steps = elementor
    ? [
        `Görünüm > Temalar > Tema yükle: ${slug}-theme.zip`,
        'Eklentiler > Yeni ekle: Elementor (ücretsiz)',
        `Eklentiler > Eklenti yükle: ${slug}-elementor-widgets.zip`,
        `Görünüm > ${name} Demo > Demo içeriğini içe aktar (ana sayfa, header/footer, menü, global renkler tek tıkla)`,
        "Sayfaları Elementor ile düzenle; widget'lar Global renk ve fontlara bağlı"
      ]
    : [
        `Görünüm > Temalar > Tema yükle: ${slug}-theme.zip`,
        'Görünüm > Düzenleyici: ana sayfayı kontrol et',
        'Düzenleyici > Stiller: renk ve fontları ayarla',
        `Pattern'ler > ${name}: bölümleri yeni sayfalarda kullan`
      ]

  return (
    <div className="grid max-w-[1400px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader
          header={<Subtitle2>Kalite kontrol listesi</Subtitle2>}
          description={<Caption1>Üretilen dosyalar üzerinde otomatik kontroller</Caption1>}
          action={<Button size="small" appearance="subtle" icon={<ArrowClockwiseRegular />} onClick={() => void refresh()} aria-label="Yenile" />}
        />
        {!quality ? (
          <Spinner size="small" label="Kontrol ediliyor…" />
        ) : (
          <div className="flex flex-col gap-1">
            {quality.map((q) => (
              <div key={q.id}>
                <Button appearance="subtle" className="!w-full !justify-start" icon={ICON[q.status]} onClick={() => setOpen(open === q.id ? null : q.id)} disabled={!q.details.length}>
                  <span className="flex-1 text-left">{q.label}</span>
                  {q.details.length > 0 && <Caption1>{q.details.length}</Caption1>}
                </Button>
                {open === q.id && (
                  <pre className="m-0 mb-2 ml-9 text-xs" style={{ fontFamily: 'Consolas, "Cascadia Code", monospace', whiteSpace: 'pre-wrap' }}>
                    {q.details.join('\n')}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader header={<Subtitle2>Paketle</Subtitle2>} description={<Caption1>{elementor ? 'Tema ve eklenti ayrı zip olarak' : 'Tema zip olarak'}</Caption1>} />
          {failed > 0 && (
            <MessageBar intent="warning">
              <MessageBarBody>{failed} kontrol başarısız. Yine de paketleyebilirsiniz; hatalı dosyaları Üretim ekranından düzeltmeniz önerilir.</MessageBarBody>
            </MessageBar>
          )}
          <div className="flex gap-2">
            <Button appearance="primary" icon={busy ? <Spinner size="tiny" /> : <FolderZipRegular />} disabled={busy} onClick={() => void doExport()}>
              Zip oluştur…
            </Button>
            <Button icon={<FolderOpenRegular />} onClick={() => void window.legt.projects.openFolder(id)}>
              Proje klasörü
            </Button>
          </div>
          {result && (
            <MessageBar intent={result.kind}>
              <MessageBarBody style={{ whiteSpace: 'pre-wrap' }}>{result.text}</MessageBarBody>
            </MessageBar>
          )}
        </Card>

        <Card>
          <CardHeader header={<Subtitle2>Kurulum</Subtitle2>} description={<Caption1>Ayrıntılar zip içindeki README.md'de</Caption1>} />
          <ol className="m-0 flex flex-col gap-1 pl-5">
            {steps.map((s) => (
              <li key={s}>
                <Text size={200}>{s}</Text>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  )
}
