import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  Badge,
  Button,
  Caption1,
  Card,
  CardHeader,
  Checkbox,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Spinner,
  Subtitle2,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea
} from '@fluentui/react-components'
import { DismissRegular, DocumentRegular, FolderOpenRegular, GlobeRegular, ImageRegular, SparkleRegular } from '@fluentui/react-icons'
import type { VisionStatus } from '../../electron/api'
import { VisionHelp } from '../components/VisionHelp'
import { PREFIX_RE, type IntakeInput, type IntakeSource, type Mode, type PreAnalysis } from '../../core/types'
import { useProject } from '../store/project'

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' }

export function slugify(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (c) => TR_MAP[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function suggestPrefix(slug: string): string {
  const parts = slug.split('-').filter(Boolean)
  const p = parts.length > 1 ? parts.map((w) => w[0]).join('') : (parts[0] ?? '').replace(/[^a-z0-9]/g, '').slice(0, 3)
  const cleaned = p.replace(/^[0-9]+/, '').slice(0, 10)
  return cleaned.length >= 2 ? cleaned : 'lgt'
}

export default function Intake(): JSX.Element {
  const { open, refreshProjects } = useProject()
  const [mode, setMode] = useState<Mode>('elementor-free')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [prefix, setPrefix] = useState('')
  const [touched, setTouched] = useState({ slug: false, prefix: false })
  const [language, setLanguage] = useState('tr')
  const [pasted, setPasted] = useState('')
  const [files, setFiles] = useState<IntakeSource[]>([])
  const [requests, setRequests] = useState({ blog: false, woocommerce: false, multiPage: false, notes: '' })
  const [pre, setPre] = useState<PreAnalysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [folder, setFolder] = useState<{ root: string; warnings: string[]; skipped: string[] } | null>(null)

  const [siteUrl, setSiteUrl] = useState('')
  const [capture, setCapture] = useState<string | null>(null)
  const [vision, setVision] = useState<VisionStatus | null>(null)
  const [visionOpen, setVisionOpen] = useState(false)

  useEffect(() => window.legt.html.onEvent((e) => setCapture((c) => (c === null ? c : e.message))), [])

  /** Site adresi ya da ekran görüntüsünden gelen kaynaklar önceki kaynakların yerini alır */
  const applyScan = (scan: { url: string; title: string; sources: IntakeSource[]; warnings: string[] }): void => {
    setFiles(scan.sources)
    setPasted('')
    setFolder({ root: scan.url, warnings: scan.warnings, skipped: [] })
    if (!name.trim() && scan.title) setName(scan.title.slice(0, 60))
  }

  const fetchUrl = async (): Promise<void> => {
    setError(null)
    setCapture('Başlıyor…')
    try {
      applyScan(await window.legt.html.fromUrl(siteUrl))
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setCapture(null)
    }
  }

  const fromScreenshot = async (): Promise<void> => {
    setError(null)
    const status = await window.legt.html.visionStatus()
    if (!status.ok) {
      setVision(status)
      setVisionOpen(true)
      return
    }
    setCapture(`${status.model} hazırlanıyor…`)
    try {
      const res = await window.legt.html.fromScreenshot()
      if (res.ok) applyScan(res.scan)
      else if (res.reason !== 'cancelled') {
        if (res.reason === 'error') setError(res.message)
        else {
          setVision({ ...status, ok: false, reason: res.reason })
          setVisionOpen(true)
        }
      }
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setCapture(null)
    }
  }

  const pickFolder = async (): Promise<void> => {
    const scan = await window.legt.html.pickFolder()
    if (!scan) return
    // Klasör seçimi önceki klasörün dosyalarının yerini alır; tek tek seçilen dosyalar korunur
    setFiles((old) => [...old.filter((f) => !f.name.includes('/') && !scan.sources.some((s) => s.name === f.name)), ...scan.sources])
    setFolder({ root: scan.root, warnings: scan.warnings, skipped: scan.skipped })
  }

  // Ad değişince slug/önek öner (kullanıcı elle değiştirmediyse)
  useEffect(() => {
    const s = slugify(name)
    if (!touched.slug) setSlug(s)
    if (!touched.prefix) setPrefix(suggestPrefix(s))
  }, [name, touched])

  const sources = useMemo<IntakeSource[]>(
    () => [...(pasted.trim() ? [{ name: 'pasted.html', kind: 'html' as const, content: pasted }] : []), ...files],
    [pasted, files]
  )

  // Ön analiz (LLM'siz) — yazarken canlı
  useEffect(() => {
    if (!sources.some((s) => s.kind === 'html')) return setPre(null)
    // Medya ön analize girmez (yalnızca HTML/CSS/JS); base64 içerik her tuşta IPC'den gitmesin
    const text = sources.filter((s) => s.kind !== 'media')
    const t = setTimeout(() => void window.legt.html.preAnalyze(text).then(setPre).catch(() => setPre(null)), 400)
    return () => clearTimeout(t)
  }, [sources])

  const prefixOk = PREFIX_RE.test(prefix)
  const slugOk = /^[a-z0-9][a-z0-9-]*$/.test(slug)
  const canSubmit = name.trim() && slugOk && prefixOk && pre && pre.sections.length > 0 && !busy

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const input: IntakeInput = {
      mode,
      theme: { name: name.trim(), slug, prefix, textdomain: slug, language },
      sources,
      requests
    }
    try {
      const id = await window.legt.projects.create(input)
      await refreshProjects()
      await open(id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid max-w-[1400px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader header={<Subtitle2>Üretim modu</Subtitle2>} />
          <RadioGroup value={mode} onChange={(_, d) => setMode(d.value as Mode)} layout="horizontal">
            <Radio value="elementor-free" label="Elementor Free (klasik tema + widget eklentisi)" />
            <Radio value="block-theme" label="Block Theme (FSE)" />
          </RadioGroup>
        </Card>

        <Card>
          <CardHeader header={<Subtitle2>Tema bilgileri</Subtitle2>} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tema adı" required className="col-span-2">
              <Input value={name} onChange={(_, d) => setName(d.value)} placeholder="ör. Türkuaz Ajans" />
            </Field>
            <Field label="Slug" validationState={slug && !slugOk ? 'error' : 'none'} validationMessage={slug && !slugOk ? 'Küçük harf, rakam ve tire' : undefined}>
              <Input
                value={slug}
                onChange={(_, d) => {
                  setTouched((t) => ({ ...t, slug: true }))
                  setSlug(d.value)
                }}
              />
            </Field>
            <Field
              label="Önek"
              hint="Fonksiyon, class, handle ve CSS sınıflarında kullanılır"
              validationState={prefix && !prefixOk ? 'error' : 'none'}
              validationMessage={prefix && !prefixOk ? 'Küçük harfle başlamalı, 2-10 karakter: a-z 0-9 _' : undefined}
            >
              <Input
                value={prefix}
                onChange={(_, d) => {
                  setTouched((t) => ({ ...t, prefix: true }))
                  setPrefix(d.value)
                }}
              />
            </Field>
            <Field label="Dil">
              <Input value={language} onChange={(_, d) => setLanguage(d.value)} />
            </Field>
            <Field label="Text domain">
              <Input value={slug} disabled />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader header={<Subtitle2>Ek istekler</Subtitle2>} />
          <div className="flex flex-wrap gap-2">
            <Checkbox label="Blog" checked={requests.blog} onChange={(_, d) => setRequests({ ...requests, blog: !!d.checked })} />
            <Checkbox label="WooCommerce" checked={requests.woocommerce} onChange={(_, d) => setRequests({ ...requests, woocommerce: !!d.checked })} />
            <Checkbox label="Çok sayfa" checked={requests.multiPage} onChange={(_, d) => setRequests({ ...requests, multiPage: !!d.checked })} />
          </div>
          <Field label="Notlar">
            <Textarea value={requests.notes} onChange={(_, d) => setRequests({ ...requests, notes: d.value })} resize="vertical" />
          </Field>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            header={<Subtitle2>Örnek HTML</Subtitle2>}
            action={
              <div className="flex gap-2">
                <Button icon={<DocumentRegular />} onClick={() => void window.legt.html.pickSources().then((f) => setFiles((old) => [...old, ...f]))}>
                  Dosya seç
                </Button>
                <Button icon={<FolderOpenRegular />} onClick={() => void pickFolder()}>
                  public_html klasörü seç
                </Button>
              </div>
            }
          />
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Site adresi" className="min-w-[260px] flex-1" hint="Yalnızca hakkınız olan siteler. Sayfa tarayıcıda açılıp render edilmiş hâliyle alınır; ekran görüntüleri görsel benzerlik puanında referans olur.">
              <Input value={siteUrl} placeholder="https://ornek.com" disabled={capture !== null} onChange={(_, d) => setSiteUrl(d.value)} onKeyDown={(e) => e.key === 'Enter' && siteUrl.trim() && void fetchUrl()} />
            </Field>
            <Button icon={<GlobeRegular />} disabled={!siteUrl.trim() || capture !== null} onClick={() => void fetchUrl()}>
              Siteyi getir
            </Button>
            <Button icon={<ImageRegular />} disabled={capture !== null} onClick={() => void fromScreenshot()}>
              Ekran görüntüsünden
            </Button>
            {capture !== null && (
              <div className="flex items-center gap-2">
                <Spinner size="tiny" />
                <Caption1>{capture}</Caption1>
                <Button size="small" onClick={() => void window.legt.html.cancel()}>
                  İptal
                </Button>
              </div>
            )}
          </div>
          <VisionHelp open={visionOpen} status={vision} onClose={() => setVisionOpen(false)} onReady={() => { setVisionOpen(false); void fromScreenshot() }} />
          {folder && (
            <MessageBar intent={folder.warnings.length ? 'warning' : 'info'}>
              <MessageBarBody>
                <div className="flex items-center gap-1">
                  <GlobeRegular /> <span style={{ fontFamily: 'Consolas, "Cascadia Code", monospace' }}>{folder.root}</span>
                </div>
                {files.filter((f) => f.kind === 'html').length} sayfa, {files.filter((f) => f.kind === 'css').length} CSS, {files.filter((f) => f.kind === 'js').length} JS, {files.filter((f) => f.kind === 'media' && !f.name.startsWith('_ref/')).length} medya alındı
                {folder.skipped.length > 0 && ` · ${folder.skipped.length} dosya atlandı`}
                {folder.warnings.map((w) => (
                  <div key={w}>{w}</div>
                ))}
                {folder.skipped.length > 0 && <div title={folder.skipped.join('\n')}>Atlananlar: {folder.skipped.slice(0, 4).join(', ')}{folder.skipped.length > 4 ? ' …' : ''}</div>}
              </MessageBarBody>
            </MessageBar>
          )}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) =>
                f.kind === 'media' ? null : (
                  <Badge key={i} appearance="outline" icon={<DismissRegular onClick={() => setFiles(files.filter((_, j) => j !== i))} />} iconPosition="after">
                    {f.kind.toUpperCase()} · {f.name}
                  </Badge>
                )
              )}
              {files.some((f) => f.kind === 'media' && !f.name.startsWith('_ref/')) && (
                <Badge appearance="tint" icon={<DismissRegular onClick={() => setFiles(files.filter((f) => f.kind !== 'media'))} />} iconPosition="after">
                  {files.filter((f) => f.kind === 'media' && !f.name.startsWith('_ref/')).length} medya dosyası (temaya ve Medya Kütüphanesi'ne)
                </Badge>
              )}
            </div>
          )}
          <Textarea
            value={pasted}
            onChange={(_, d) => setPasted(d.value)}
            placeholder="HTML'i buraya yapıştırın veya dosya seçin (CSS/JS ayrıysa birlikte seçin)"
            textarea={{ style: { fontFamily: 'Consolas, "Cascadia Code", monospace', fontSize: 12, minHeight: 220 } }}
            resize="vertical"
          />
        </Card>

        <PreAnalysisCard pre={pre} />

        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <div className="flex justify-end">
          <Button appearance="primary" size="large" icon={busy ? <Spinner size="tiny" /> : <SparkleRegular />} disabled={!canSubmit} onClick={() => void submit()}>
            Projeyi oluştur ve planla
          </Button>
        </div>
      </div>
    </div>
  )
}

function PreAnalysisCard({ pre }: { pre: PreAnalysis | null }): JSX.Element {
  if (!pre) {
    return (
      <Card>
        <CardHeader header={<Subtitle2>Ön analiz</Subtitle2>} description={<Caption1>HTML eklendiğinde bölümler ve token'lar burada görünür</Caption1>} />
      </Card>
    )
  }
  const t = pre.tokens
  return (
    <Card>
      <CardHeader header={<Subtitle2>Ön analiz</Subtitle2>} description={<Caption1>{pre.sections.length} bölüm bulundu (LLM kullanılmadı)</Caption1>} />
      <Table size="small">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Bölüm</TableHeaderCell>
            <TableHeaderCell>Rol</TableHeaderCell>
            <TableHeaderCell>Başlık</TableHeaderCell>
            <TableHeaderCell>İçerik</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pre.sections.map((s) => (
            <TableRow key={s.id}>
              <TableCell>
                <Text font="monospace">{s.id}</Text> <Caption1>&lt;{s.tag}{s.classes[0] ? `.${s.classes[0]}` : ''}&gt;</Caption1>
              </TableCell>
              <TableCell>{s.role}</TableCell>
              <TableCell>
                <Text truncate wrap={false}>
                  {s.headings[0] ?? '—'}
                </Text>
              </TableCell>
              <TableCell>
                <Caption1>
                  {s.images} görsel · {s.links} link
                  {s.repeated ? ` · ${s.repeated.count}× ${s.repeated.selector}` : ''}
                  {s.jsHints.length ? ` · JS: ${s.jsHints.filter((h) => !h.startsWith('script-ref')).join(', ') || 'var'}` : ''}
                </Caption1>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center gap-2">
        {t.colors.slice(0, 12).map((c) => (
          <span key={c.value} title={`${c.value} (${c.count}×)`} className="inline-block h-6 w-6 rounded" style={{ background: c.value, border: '1px solid rgba(127,127,127,.35)' }} />
        ))}
      </div>
      <Caption1>
        Fontlar: {[...new Set([...t.googleFonts, ...t.fonts.map((f) => f.family)])].slice(0, 5).join(', ') || '—'} · Breakpoint: {t.breakpoints.join(', ') || '—'}
      </Caption1>
    </Card>
  )
}
