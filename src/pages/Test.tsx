import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  Badge,
  Button,
  Caption1,
  Card,
  CardHeader,
  Dialog,
  DialogBody,
  DialogSurface,
  DialogTitle,
  Field,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  SpinButton,
  Spinner,
  Subtitle2,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Tooltip
} from '@fluentui/react-components'
import {
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  ArrowExportRegular,
  ArrowUndoRegular,
  CheckmarkCircleFilled,
  DismissCircleFilled,
  DismissRegular,
  GlobeRegular,
  InfoRegular,
  PlayRegular,
  StopRegular,
  WarningFilled,
  WrenchRegular
} from '@fluentui/react-icons'
import { DEFAULT_TEST_OPTIONS, type RuntimeStatus, type TestEvent, type TestIssue, type TestOptions, type TestReport, type TestShot } from '../../core/types'
import { useProject } from '../store/project'

const MONO = { fontFamily: 'Consolas, "Cascadia Code", monospace' }
const OPTIONS_KEY = 'legt.testOptions'

const PHASE: Record<Extract<TestEvent, { type: 'phase' }>['phase'], string> = {
  runtime: 'XAMPP başlatılıyor (rastgele portlar)',
  install: 'WordPress kuruluyor, tema ve eklentiler etkinleştiriliyor',
  browser: 'Playwright ile sayfalar geziliyor',
  scenarios: 'LLM etkileşim senaryoları',
  repair: 'LLM onarımı'
}

const STATUS: Record<TestReport['status'], { color: 'success' | 'warning' | 'danger'; label: string }> = {
  pass: { color: 'success', label: 'geçti' },
  warn: { color: 'warning', label: 'uyarılarla geçti' },
  fail: { color: 'danger', label: 'hatalı' },
  error: { color: 'danger', label: 'tamamlanamadı' }
}

const KIND: Record<TestIssue['kind'], string> = {
  setup: 'kurulum',
  php: 'PHP',
  http: 'HTTP',
  console: 'JS',
  asset: 'dosya',
  render: 'render',
  content: 'içerik',
  overflow: 'taşma',
  scenario: 'senaryo',
  editor: 'editör',
  visual: 'görsel'
}

const clean = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function loadOptions(): TestOptions {
  try {
    return { ...DEFAULT_TEST_OPTIONS, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') }
  } catch {
    return { ...DEFAULT_TEST_OPTIONS }
  }
}

function IssueRow({ issue }: { issue: TestIssue }): JSX.Element {
  const [open, setOpen] = useState(false)
  const icon =
    issue.severity === 'error' ? (
      <DismissCircleFilled style={{ color: 'var(--colorPaletteRedForeground1)' }} />
    ) : (
      <WarningFilled style={{ color: 'var(--colorPaletteYellowForeground1)' }} />
    )
  const where = [issue.url, issue.viewport].filter(Boolean).join(' · ')
  const body = (
    <div className="flex min-w-0 flex-1 flex-col items-start text-left">
      <Text size={200}>
        <Badge appearance="outline" size="small" className="mr-2">
          {KIND[issue.kind]}
        </Badge>
        {issue.message}
      </Text>
      <Caption1>
        {issue.file ? <span style={MONO}>{issue.file}</span> : 'dosyaya bağlanamadı'}
        {where && ` · ${where}`}
      </Caption1>
    </div>
  )
  return (
    <div className="flex flex-col">
      {issue.detail ? (
        <Button appearance="subtle" className="!w-full !justify-start" icon={icon} onClick={() => setOpen(!open)}>
          {body}
        </Button>
      ) : (
        // Ayrıntısı olmayan satır açılmaz; devre dışı düğme gibi soluk görünmesin
        <div className="flex items-start gap-2 px-3 py-1.5">
          <span className="mt-0.5 flex text-xl">{icon}</span>
          {body}
        </div>
      )}
      {open && issue.detail && (
        <pre className="m-0 mb-2 ml-9 max-h-64 overflow-auto text-xs" style={{ ...MONO, whiteSpace: 'pre-wrap' }}>
          {issue.detail}
        </pre>
      )}
    </div>
  )
}

function AgentOutput({ source, text }: { source: string; text: string }): JSX.Element {
  const ref = useRef<HTMLPreElement>(null)
  // Gövde süslü parantezli: yeni Chromium'da scrollTo() Promise döndürür, React onu temizleme fonksiyonu sanar
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [text])
  return (
    <div className="flex min-w-0 flex-col">
      <Caption1 truncate wrap={false} style={MONO}>
        {source}
      </Caption1>
      <pre ref={ref} className="m-0 max-h-32 overflow-auto text-xs" style={{ ...MONO, whiteSpace: 'pre-wrap', opacity: 0.85 }}>
        {text}
      </pre>
    </div>
  )
}

function Shot({ id, shot, onOpen }: { id: string; shot: TestShot; onOpen: (src: string, name: string) => void }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    void window.legt.wptest.shot(id, shot.file).then(setSrc)
  }, [id, shot.file])
  return (
    <button
      type="button"
      className="flex flex-col gap-1 overflow-hidden rounded border-0 bg-transparent p-0 text-left"
      style={{ cursor: src ? 'zoom-in' : 'default' }}
      onClick={() => src && onOpen(src, shot.name)}
    >
      <div className="h-36 w-full overflow-hidden rounded" style={{ background: 'var(--colorNeutralBackground3)' }}>
        {src ? <img src={src} alt={shot.name} className="w-full object-cover object-top" /> : <Spinner size="tiny" className="mt-14" />}
      </div>
      <Caption1>{shot.name}</Caption1>
    </button>
  )
}

export default function Test(): JSX.Element {
  const { current, setPage, reload } = useProject()
  const id = current!.id
  const elementor = current!.intake.mode === 'elementor-free'
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null)
  const [hasModel, setHasModel] = useState(true)
  const [options, setOptions] = useState<TestOptions>(loadOptions)
  const [report, setReport] = useState<TestReport | null>(null)
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<string>('')
  const [lines, setLines] = useState<string[]>([])
  // Paralel ajanlar: kaynak (bölüm / dosya) → canlı model çıktısı
  const [llm, setLlm] = useState<Record<string, string>>({})
  const [site, setSite] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  const checkRuntime = useCallback(async () => {
    setRuntime(null)
    setRuntime(await window.legt.wptest.status(id))
  }, [id])

  const [setup, setSetup] = useState<{ message: string; percent: number | null } | null>(null)
  const installRuntime = async (): Promise<void> => {
    setError(null)
    setSetup({ message: 'Başlıyor…', percent: null })
    const off = window.legt.wptest.onSetupEvent((e) => setSetup({ message: e.message, percent: e.percent }))
    try {
      await window.legt.wptest.setupRuntime()
    } catch (e) {
      setError(clean(e))
    } finally {
      off()
      setSetup(null)
      await checkRuntime()
    }
  }

  useEffect(() => {
    void checkRuntime()
    void window.legt.wptest.report(id).then(setReport)
    void window.legt.wptest.site(id).then(setSite)
    void window.legt.settings.get().then((s) => setHasModel(!!s.model))
  }, [id, checkRuntime])

  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options))
    } catch {
      // tarayıcı depolaması kapalıysa seçenekler bu oturumla sınırlı kalır
    }
  }, [options])

  useEffect(
    () =>
      window.legt.llm.onEvent((e) => {
        if (e.projectId !== id || e.type !== 'test') return
        const ev = e.event
        if (ev.type === 'log') setLines((l) => [...l.slice(-400), ev.message])
        else if (ev.type === 'token')
          setLlm((m) => {
            const t = m[ev.source] ?? ''
            return { ...m, [ev.source]: (t.length > 20000 ? t.slice(-15000) : t) + ev.chunk }
          })
        else if (ev.type === 'phase') {
          setPhase(`Tur ${ev.round} · ${PHASE[ev.phase]}${ev.detail ? ` · ${ev.detail}` : ''}`)
          if ((ev.phase === 'scenarios' || ev.phase === 'repair') && !ev.detail) setLlm({})
        } else if (ev.type === 'site') setSite(ev.url)
        else if (ev.type === 'round')
          setReport((r) => {
            // Test sürerken rapor null'dan başlar ve turlar geldikçe dolar
            const base: TestReport = r ?? { startedAt: '', finishedAt: '', status: 'fail', wpVersion: null, rounds: [], shots: [] }
            return { ...base, rounds: [...base.rounds.filter((x) => x.round !== ev.round.round), ev.round] }
          })
      }),
    [id]
  )
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [lines])

  const start = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    setLines([])
    setLlm({})
    setPhase('Hazırlanıyor…')
    setReport(null)
    try {
      const r = await window.legt.wptest.run(id, options)
      setReport(r)
      if (r.error) setError(r.error)
      await reload() // onarılan dosyaların durumu
    } catch (e) {
      setError(clean(e))
      setReport(await window.legt.wptest.report(id))
    } finally {
      setRunning(false)
      setPhase('')
      setSite(await window.legt.wptest.site(id))
    }
  }

  const last = report?.rounds.at(-1)
  const errors = last?.issues.filter((i) => i.severity === 'error') ?? []
  const warnings = last?.issues.filter((i) => i.severity === 'warning') ?? []
  const set = <K extends keyof TestOptions>(k: K, v: TestOptions[K]): void => setOptions((o) => ({ ...o, [k]: v }))

  return (
    <div className="flex max-w-[1400px] flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            header={<Subtitle2>Canlı WordPress testi</Subtitle2>}
            description={
              <Caption1>
                Tema{elementor ? ' ve eklenti' : ''} portable XAMPP üzerinde gerçek bir WordPress'e kurulur, Playwright ile masaüstü / tablet / mobilde gezilir
                {hasModel ? '; seçili model etkileşim senaryoları yazar ve bulunan sorunları onarır.' : '.'}
              </Caption1>
            }
          />
          {!hasModel && (
            <MessageBar intent="info">
              <MessageBarBody>Ayarlarda model seçili değil: yalnızca test yapılır, LLM senaryosu ve onarım atlanır.</MessageBarBody>
            </MessageBar>
          )}
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <Field label="Onarım turu" hint="0 = yalnızca test">
              <SpinButton min={0} max={5} value={options.rounds} disabled={running} onChange={(_, d) => set('rounds', Math.max(0, Math.min(5, Number(d.value ?? d.displayValue) || 0)))} />
            </Field>
            <div className="flex flex-col">
              <Switch label="LLM etkileşim senaryoları" checked={options.aiScenarios} disabled={running || !hasModel} onChange={(_, d) => set('aiScenarios', d.checked)} />
              {elementor && <Switch label="Elementor editörünü de test et" checked={options.editor} disabled={running} onChange={(_, d) => set('editor', d.checked)} />}
              <Switch label="Görsel benzerlik puanı (1500 üzerinden, 750 altı hata)" checked={options.visual !== false} disabled={running} onChange={(_, d) => set('visual', d.checked)} />
              <Switch label="Test bitince siteyi açık tut" checked={options.keepAlive} disabled={running} onChange={(_, d) => set('keepAlive', d.checked)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button appearance="primary" icon={running ? <Spinner size="tiny" /> : <PlayRegular />} disabled={running || !runtime?.ok} onClick={() => void start()}>
              {report ? 'Testi yeniden çalıştır' : 'Testi başlat'}
            </Button>
            {running && (
              <Button icon={<DismissRegular />} onClick={() => void window.legt.llm.cancel(id)}>
                İptal
              </Button>
            )}
            {site && !running && (
              <>
                <Button icon={<GlobeRegular />} onClick={() => void window.legt.wptest.openSite(id)}>
                  Siteyi aç
                </Button>
                <Tooltip content="Apache ve MariaDB'yi kapatır" relationship="description">
                  <Button icon={<StopRegular />} onClick={() => void window.legt.wptest.stopSite(id).then(() => setSite(null))}>
                    Siteyi kapat
                  </Button>
                </Tooltip>
              </>
            )}
            {report && !running && report.status !== 'error' && (
              <Button icon={<ArrowExportRegular />} className="!ml-auto" onClick={() => setPage('export')}>
                Dışa aktar
              </Button>
            )}
          </div>
          {site && (
            <Caption1>
              Site açık: <span style={MONO}>{site}</span> · kullanıcı <span style={MONO}>admin</span> (parola her testte rastgele)
            </Caption1>
          )}
        </Card>

        <Card>
          <CardHeader
            header={<Subtitle2>Test ortamı</Subtitle2>}
            description={<Caption1 style={MONO}>{runtime?.dir ?? '…'}</Caption1>}
            action={<Button size="small" appearance="subtle" icon={<ArrowClockwiseRegular />} onClick={() => void checkRuntime()} aria-label="Yenile" disabled={running} />}
          />
          {!runtime ? (
            <Spinner size="small" />
          ) : (
            <div className="flex flex-col gap-1">
              {(
                [
                  ['PHP', runtime.php],
                  ['Apache', runtime.httpd],
                  ['MariaDB', runtime.mysqld],
                  ['WordPress', runtime.wordpress],
                  ...(elementor ? [['Elementor', runtime.elementor]] : [])
                ] as [string, string | null][]
              ).map(([label, value]) => (
                <div key={label} className="flex items-center gap-2">
                  {value ? <CheckmarkCircleFilled style={{ color: 'var(--colorPaletteGreenForeground1)' }} /> : <DismissCircleFilled style={{ color: 'var(--colorPaletteRedForeground1)' }} />}
                  <Text size={200} className="w-24">
                    {label}
                  </Text>
                  <Caption1 truncate wrap={false} style={MONO}>
                    {value ? (/^\d/.test(value) ? value : 'hazır') : 'eksik'}
                  </Caption1>
                </div>
              ))}
              {!runtime.ok && (
                <MessageBar intent="warning" className="mt-2">
                  <MessageBarBody style={{ whiteSpace: 'pre-wrap' }}>
                    {runtime.problems.join('\n')}
                  </MessageBarBody>
                </MessageBar>
              )}
              {!runtime.ok && (
                <div className="mt-2 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button appearance="primary" icon={setup ? <Spinner size="tiny" /> : <ArrowDownloadRegular />} disabled={!!setup || running} onClick={() => void installRuntime()}>
                      Test ortamını kur
                    </Button>
                    {setup && (
                      <Button icon={<DismissRegular />} onClick={() => void window.legt.wptest.cancelSetup()}>
                        İptal
                      </Button>
                    )}
                    <Caption1>Portable XAMPP + WordPress + Elementor indirilir (yaklaşık 300-400 MB, bir kez).</Caption1>
                  </div>
                  {setup && (
                    <div className="flex flex-col gap-1">
                      <Caption1>{setup.message}</Caption1>
                      <ProgressBar value={setup.percent === null ? undefined : setup.percent / 100} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody style={{ whiteSpace: 'pre-wrap' }}>{error}</MessageBarBody>
        </MessageBar>
      )}

      {(running || lines.length > 0) && (
        <Card>
          <CardHeader header={<Subtitle2>{running ? phase : 'Son test günlüğü'}</Subtitle2>} />
          {running && <ProgressBar thickness="large" />}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <pre ref={logRef} className="m-0 max-h-72 overflow-auto text-xs" style={{ ...MONO, whiteSpace: 'pre-wrap' }}>
              {lines.join('\n') || '…'}
            </pre>
            <div className="flex min-w-0 flex-col gap-2">
              <Caption1>Model çıktısı (canlı{Object.keys(llm).length > 1 ? `, ${Object.keys(llm).length} ajan` : ''})</Caption1>
              {Object.keys(llm).length === 0 && <Caption1>—</Caption1>}
              {Object.entries(llm)
                .slice(-6)
                .map(([source, text]) => (
                  <AgentOutput key={source} source={source} text={text} />
                ))}
            </div>
          </div>
        </Card>
      )}

      {report?.visual && !running && (
        <Card>
          <CardHeader
            header={
              <div className="flex items-center gap-2">
                <Subtitle2>Görsel benzerlik</Subtitle2>
                <Badge color={report.visual.verdict === 'fail' ? 'danger' : report.visual.verdict === 'warn' ? 'warning' : 'success'}>
                  {report.visual.score} / {report.visual.max}
                </Badge>
              </div>
            }
            description={
              <Caption1>
                {report.visual.verdict === 'fail' ? `${report.visual.threshold} eşiğinin altında: hata` : report.visual.verdict === 'warn' ? 'Eşik geçildi, hedef 1050+' : 'Kaynağa çok yakın'}
                {report.visual.patches > 0 && ` · ${report.visual.patches} CSS kuralı otomatik yazıldı`}
              </Caption1>
            }
          />
          <Table size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Bölüm</TableHeaderCell>
                <TableHeaderCell>Pencere</TableHeaderCell>
                <TableHeaderCell>Toplam</TableHeaderCell>
                <TableHeaderCell>Piksel /500</TableHeaderCell>
                <TableHeaderCell>Yerleşim /400</TableHeaderCell>
                <TableHeaderCell>Tipografi /250</TableHeaderCell>
                <TableHeaderCell>Renk /200</TableHeaderCell>
                <TableHeaderCell>İçerik /150</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.visual.sections.map((s) => (
                <TableRow key={`${s.sectionId}-${s.viewport}`}>
                  <TableCell>{s.label}</TableCell>
                  <TableCell>{s.viewport}</TableCell>
                  <TableCell>
                    <Badge appearance="tint" color={s.total < report.visual!.threshold ? 'danger' : s.total < 1050 ? 'warning' : 'success'}>
                      {s.total}
                    </Badge>
                  </TableCell>
                  <TableCell>{s.pixel}</TableCell>
                  <TableCell>{s.layout}</TableCell>
                  <TableCell>{s.type}</TableCell>
                  <TableCell>{s.color}</TableCell>
                  <TableCell>{s.content}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {report.visual.pages.length > 0 && (
            <Caption1>Tam sayfa (referans ekran görüntüsü): {report.visual.pages.map((p) => `${p.viewport} ${p.score}`).join(' · ')}</Caption1>
          )}
        </Card>
      )}

      {report && report.rounds.length > 0 && (
        <Card>
          <CardHeader
            header={
              <div className="flex items-center gap-2">
                <Subtitle2>Sonuç</Subtitle2>
                {!running && <Badge color={STATUS[report.status].color}>{STATUS[report.status].label}</Badge>}
              </div>
            }
            description={
              <Caption1>
                {errors.length} hata · {warnings.length} uyarı
                {report.wpVersion && ` · WordPress ${report.wpVersion}`}
                {report.finishedAt && ` · ${new Date(report.finishedAt).toLocaleString()}`}
              </Caption1>
            }
          />
          {report.rounds.map((r) => (
            <div key={r.round} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Text weight="semibold">Tur {r.round}</Text>
                <Caption1>
                  {r.issues.filter((i) => i.severity === 'error').length} hata · {r.issues.filter((i) => i.severity === 'warning').length} uyarı · senaryo {r.scenarios.run} çalıştı
                  {r.scenarios.skipped > 0 && `, ${r.scenarios.skipped} atlandı (seçici DOM'da yok)`}
                </Caption1>
              </div>
              {r.reverted.length > 0 && (
                <Caption1>
                  <ArrowUndoRegular /> Önceki onarım sorunları artırdı, geri alındı: <span style={MONO}>{r.reverted.join(', ')}</span>
                </Caption1>
              )}
              {(r === last || r.issues.length <= 6) && r.issues.map((i, n) => <IssueRow key={n} issue={i} />)}
              {r !== last && r.issues.length > 6 && <Caption1 className="pl-2">{r.issues.length} sorun (ayrıntılar son turda)</Caption1>}
              {r.repaired.length > 0 && (
                <Caption1>
                  <WrenchRegular /> LLM onardı: <span style={MONO}>{r.repaired.join(', ')}</span>
                </Caption1>
              )}
            </div>
          ))}
          {last && last.issues.length === 0 && (
            <MessageBar intent="success">
              <MessageBarBody>Tüm canlı kontroller geçti.</MessageBarBody>
            </MessageBar>
          )}
          {errors.some((i) => !i.file) && (
            <Caption1>
              <InfoRegular /> Dosyaya bağlanamayan hatalar otomatik onarılmaz; ayrıntılara bakıp Üretim ekranından ilgili dosyayı düzenleyin.
            </Caption1>
          )}
        </Card>
      )}

      {report && report.shots.length > 0 && !running && (
        <Card>
          <CardHeader header={<Subtitle2>Ekran görüntüleri</Subtitle2>} description={<Caption1>Son turdan; büyütmek için tıklayın</Caption1>} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {report.shots.map((s) => (
              <Shot key={s.file} id={id} shot={s} onOpen={(src, name) => setZoom({ src, name })} />
            ))}
          </div>
        </Card>
      )}

      <Dialog open={!!zoom} onOpenChange={(_, d) => !d.open && setZoom(null)}>
        <DialogSurface style={{ maxWidth: '92vw', width: 'fit-content' }}>
          <DialogBody>
            <DialogTitle action={<Button appearance="subtle" icon={<DismissRegular />} onClick={() => setZoom(null)} aria-label="Kapat" />}>{zoom?.name}</DialogTitle>
            <div className="max-h-[80vh] overflow-auto">{zoom && <img src={zoom.src} alt={zoom.name} style={{ maxWidth: '88vw' }} />}</div>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  )
}
