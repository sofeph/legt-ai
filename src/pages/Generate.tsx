import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  Badge,
  Button,
  Caption1,
  Card,
  CardHeader,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Spinner,
  Subtitle2,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  Tooltip
} from '@fluentui/react-components'
import {
  ArrowClockwiseRegular,
  ArrowExportRegular,
  BugRegular,
  CheckmarkCircleFilled,
  DismissCircleFilled,
  DismissRegular,
  EditRegular,
  FolderOpenRegular,
  PlayRegular
} from '@fluentui/react-icons'
import type { FileStatus, PlanFile, ValidationIssue } from '../../core/types'
import { useProject } from '../store/project'

const MONO = { fontFamily: 'Consolas, "Cascadia Code", monospace' }

function StatusBadge({ status, attempts }: { status: FileStatus | undefined; attempts: number }): JSX.Element {
  switch (status) {
    case 'ok':
      return (
        <Badge appearance="tint" color="success" icon={<CheckmarkCircleFilled />}>
          {attempts ? `tamam (${attempts} onarım)` : 'tamam'}
        </Badge>
      )
    case 'failed':
      return (
        <Badge appearance="tint" color="danger" icon={<DismissCircleFilled />}>
          hatalı
        </Badge>
      )
    case 'generating':
      return (
        <Badge appearance="tint" color="brand" icon={<Spinner size="extra-tiny" />}>
          üretiliyor
        </Badge>
      )
    default:
      return (
        <Badge appearance="outline" color="informative">
          bekliyor
        </Badge>
      )
  }
}

/** Bir ajanın canlı çıktısı; kendi kaydırmasını yönetir */
function AgentLog({ path, phase, log }: { path: string; phase: string; log: string }): JSX.Element {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [log])
  return (
    <Card size="small">
      <CardHeader header={<Text font="monospace" size={200} truncate wrap={false}>{path}</Text>} description={<Caption1>{phase} · model çıktısı (canlı)</Caption1>} />
      <pre ref={ref} className="m-0 max-h-56 overflow-auto text-xs" style={{ ...MONO, whiteSpace: 'pre-wrap' }}>
        {log || '…'}
      </pre>
    </Card>
  )
}

/** 95000 ms → "1 dk 35 sn"; saat varsa "1 sa 05 dk" */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h} sa ${String(m).padStart(2, '0')} dk`
  if (m) return `${m} dk ${String(s % 60).padStart(2, '0')} sn`
  return `${s} sn`
}

export default function Generate(): JSX.Element {
  const { current, setState, reload, refreshProjects, setPage } = useProject()
  const id = current!.id
  const files = useMemo(() => current?.plan?.files ?? [], [current?.plan])
  const state = current!.state
  const [running, setRunning] = useState(false)
  // Paralel ajanlar: üretilmekte olan her dosya için faz ve canlı çıktı
  const [agents, setAgents] = useState<Record<string, { phase: string; log: string }>>({})
  const [notice, setNotice] = useState<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ path: string; content: string; issues: ValidationIssue[] | null } | null>(null)

  // Canlı olaylar: dosya durumu, faz, token
  useEffect(
    () =>
      window.legt.llm.onEvent((e) => {
        if (e.projectId !== id || e.type !== 'gen') return
        const ev = e.event
        if (ev.type === 'token')
          setAgents((a) => {
            const cur = a[ev.path] ?? { phase: 'üretim', log: '' }
            return { ...a, [ev.path]: { ...cur, log: (cur.log.length > 30000 ? cur.log.slice(-20000) : cur.log) + ev.chunk } }
          })
        else if (ev.type === 'phase') {
          setAgents((a) => ({ ...a, [ev.path]: { phase: ev.phase === 'repair' ? `onarım ${ev.attempt}/2` : 'üretim', log: '' } }))
        } else {
          if (ev.status !== 'generating')
            setAgents((a) => {
              const { [ev.path]: _done, ...rest } = a
              return rest
            })
          const cur = useProject.getState().current
          if (!cur) return
          setState({ ...cur.state, files: { ...cur.state.files, [ev.path]: { status: ev.status, attempts: ev.attempts, ...(ev.errors ? { errors: ev.errors } : {}) } } })
        }
      }),
    [id, setState]
  )
  const counts = useMemo(() => {
    const c = { ok: 0, failed: 0, pending: 0 }
    for (const f of files) {
      const s = state.files[f.path]?.status
      if (s === 'ok') c.ok++
      else if (s === 'failed') c.failed++
      else c.pending++
    }
    return c
  }, [files, state])

  // Tahmini bitiş süresi: bu çalıştırmada biten LLM dosyalarının hızından
  const llmPaths = useMemo(() => new Set(files.filter((f) => f.source === 'llm').map((f) => f.path)), [files])
  const runInfo = useRef<{ start: number; done: number[] }>({ start: 0, done: [] })
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  useEffect(
    () =>
      window.legt.llm.onEvent((e) => {
        if (e.projectId !== id || e.type !== 'gen' || e.event.type !== 'file') return
        if ((e.event.status === 'ok' || e.event.status === 'failed') && llmPaths.has(e.event.path)) runInfo.current.done.push(Date.now())
      }),
    [id, llmPaths]
  )
  const llmLeft = files.filter((f) => f.source === 'llm' && !['ok', 'failed'].includes(state.files[f.path]?.status ?? 'pending')).length
  const eta = useMemo(() => {
    const { start, done } = runInfo.current
    if (!running || !start || done.length < 2) return null
    // Genel hız ile son 6 dosyanın hızının ortalaması: dalga biçimli bağımlılıklara uyum sağlar
    const overall = done.length / Math.max(1, now - start)
    const recent = done.slice(-6)
    const recentRate = (recent.length - 1) / Math.max(1, recent[recent.length - 1] - recent[0])
    const rate = recentRate > 0 ? (overall + recentRate) / 2 : overall
    return llmLeft > 0 ? Math.round(llmLeft / rate) : 0
  }, [running, now, llmLeft])

  const run = async (only?: string[]): Promise<void> => {
    runInfo.current = { start: Date.now(), done: [] }
    setNow(Date.now())
    setRunning(true)
    setNotice(null)
    setAgents({})
    try {
      const s = await window.legt.projects.generate(id, only)
      setState(s)
      const failed = Object.values(s.files).filter((f) => f.status === 'failed').length
      setNotice(
        failed
          ? { kind: 'warning', text: `${failed} dosya doğrulamadan geçemedi. Hatayı görmek için satıra tıklayın; elle düzeltebilir veya yeniden üretebilirsiniz.` }
          : { kind: 'success', text: 'Tüm dosyalar üretildi ve doğrulandı.' }
      )
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      await reload()
    } finally {
      setRunning(false)
      setAgents({})
      await refreshProjects()
    }
  }

  const openEditor = async (f: PlanFile): Promise<void> => {
    const content = await window.legt.projects.readOutput(id, f.path)
    setEditing({ path: f.path, content: content ?? '', issues: null })
  }
  const saveEditor = async (): Promise<void> => {
    if (!editing) return
    const issues = await window.legt.projects.saveOutput(id, editing.path, editing.content)
    setEditing({ ...editing, issues })
    await reload()
  }

  const failedPaths = files.filter((f) => state.files[f.path]?.status === 'failed').map((f) => f.path)
  const total = files.length || 1

  return (
    <div className="flex max-w-[1400px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button appearance="primary" icon={running ? <Spinner size="tiny" /> : <PlayRegular />} disabled={running || counts.pending === 0} onClick={() => void run()}>
          {counts.ok + counts.failed > 0 ? 'Kalan dosyalarla devam et' : 'Üretimi başlat'}
        </Button>
        {failedPaths.length > 0 && (
          <Button icon={<ArrowClockwiseRegular />} disabled={running} onClick={() => void run(failedPaths)}>
            Hatalıları yeniden üret ({failedPaths.length})
          </Button>
        )}
        {running && (
          <Button icon={<DismissRegular />} onClick={() => void window.legt.llm.cancel(id)}>
            İptal
          </Button>
        )}
        {state.step === 'done' && !running && (
          <>
            <Button icon={<BugRegular />} onClick={() => setPage('test')}>
              Canlı test
            </Button>
            <Button icon={<ArrowExportRegular />} onClick={() => setPage('export')}>
              Dışa aktar
            </Button>
          </>
        )}
        <Button appearance="subtle" icon={<FolderOpenRegular />} className="!ml-auto" onClick={() => void window.legt.projects.openFolder(id)}>
          Proje klasörü
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <ProgressBar className="flex-1" value={(counts.ok + counts.failed) / total} color={counts.failed ? 'warning' : 'brand'} thickness="large" />
        <Caption1>
          {counts.ok} tamam · {counts.failed} hatalı · {counts.pending} bekliyor
          {running && ` · geçen ${formatDuration(now - runInfo.current.start)}`}
          {running && (eta === null ? ' · tahmini bitiş hesaplanıyor…' : eta === 0 ? ' · bitmek üzere' : ` · tahmini bitiş ~${formatDuration(eta)} (${new Date(now + eta).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })})`)}
        </Caption1>
      </div>

      {notice && (
        <MessageBar intent={notice.kind}>
          <MessageBarBody>{notice.text}</MessageBarBody>
        </MessageBar>
      )}

      {running && (
        <Card>
          <CardHeader
            header={<Subtitle2>{Object.keys(agents).length ? `${Object.keys(agents).length} ajan çalışıyor` : 'Hazırlanıyor…'}</Subtitle2>}
            description={<Caption1>{Object.keys(agents).length ? 'Bağımlılığı tamamlanan dosyalar paralel üretilir (Ayarlar > Paralel ajan)' : 'Scaffold dosyaları yazılıyor'}</Caption1>}
          />
          {Object.keys(agents).length > 0 && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {Object.entries(agents).map(([path, a]) => (
                <AgentLog key={path} path={path} phase={a.phase} log={a.log} />
              ))}
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader header={<Subtitle2>Dosyalar</Subtitle2>} description={<Caption1>Scaffold dosyaları LLM'e gönderilmez, şablondan üretilir</Caption1>} />
        <Table size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Yol</TableHeaderCell>
              <TableHeaderCell style={{ width: 130 }}>Tür</TableHeaderCell>
              <TableHeaderCell style={{ width: 170 }}>Durum</TableHeaderCell>
              <TableHeaderCell style={{ width: 96 }} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((f) => {
              const st = state.files[f.path]
              const open = expanded === f.path && st?.errors
              return (
                <TableRow key={f.path} onClick={() => setExpanded(expanded === f.path ? null : f.path)} style={{ cursor: st?.errors ? 'pointer' : undefined }}>
                  <TableCell>
                    <div className="flex flex-col py-1">
                      <Text font="monospace" size={200}>
                        {f.path}
                      </Text>
                      {open && (
                        <pre className="m-0 mt-1 text-xs" style={{ ...MONO, whiteSpace: 'pre-wrap', color: 'var(--colorPaletteRedForeground1)' }}>
                          {st.errors}
                        </pre>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Caption1>{f.source === 'scaffold' ? 'scaffold' : (f.kind ?? 'llm')}</Caption1>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={st?.status} attempts={st?.attempts ?? 0} />
                  </TableCell>
                  <TableCell>
                    <div className="flex" onClick={(e) => e.stopPropagation()}>
                      <Tooltip content="Görüntüle / düzenle" relationship="label">
                        <Button size="small" appearance="subtle" icon={<EditRegular />} disabled={running || !st || st.status === 'pending'} onClick={() => void openEditor(f)} />
                      </Tooltip>
                      {f.source === 'llm' && (
                        <Tooltip content="Yeniden üret" relationship="label">
                          <Button size="small" appearance="subtle" icon={<ArrowClockwiseRegular />} disabled={running} onClick={() => void run([f.path])} />
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(_, d) => !d.open && setEditing(null)}>
        <DialogSurface style={{ maxWidth: 1100, width: '90vw' }}>
          <DialogBody>
            <DialogTitle>
              <Text font="monospace">{editing?.path}</Text>
            </DialogTitle>
            <DialogContent className="flex flex-col gap-2">
              <Textarea
                value={editing?.content ?? ''}
                onChange={(_, d) => editing && setEditing({ ...editing, content: d.value, issues: null })}
                textarea={{ style: { ...MONO, fontSize: 12, minHeight: '55vh' }, spellCheck: false }}
                resize="vertical"
              />
              {editing?.issues && (
                <MessageBar intent={editing.issues.length ? 'error' : 'success'}>
                  <MessageBarBody style={{ whiteSpace: 'pre-wrap' }}>
                    {editing.issues.length ? editing.issues.map((i) => `${i.line ? `satır ${i.line}: ` : ''}${i.message}`).join('\n') : 'Kaydedildi, doğrulamadan geçti.'}
                  </MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditing(null)}>Kapat</Button>
              <Button appearance="primary" onClick={() => void saveEditor()}>
                Kaydet ve doğrula
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  )
}
