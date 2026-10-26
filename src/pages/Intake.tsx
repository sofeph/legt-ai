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
import { DismissRegular, FolderOpenRegular, SparkleRegular } from '@fluentui/react-icons'
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
    const t = setTimeout(() => void window.legt.html.preAnalyze(sources).then(setPre).catch(() => setPre(null)), 400)
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
              <Button icon={<FolderOpenRegular />} onClick={() => void window.legt.html.pickSources().then((f) => setFiles((old) => [...old, ...f]))}>
                Dosya seç
              </Button>
            }
          />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <Badge key={i} appearance="outline" icon={<DismissRegular onClick={() => setFiles(files.filter((_, j) => j !== i))} />} iconPosition="after">
                  {f.kind.toUpperCase()} · {f.name}
                </Badge>
              ))}
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
