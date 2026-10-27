import { useEffect, useRef, useState, type JSX } from 'react'
import {
  Button,
  Caption1,
  Card,
  CardHeader,
  Dropdown,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Subtitle2,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow
} from '@fluentui/react-components'
import { AddRegular, CheckmarkRegular, DeleteRegular, DismissRegular, FolderOpenRegular, PlayRegular, SaveRegular } from '@fluentui/react-icons'
import type { BlockSection, ElementorSection, Plan, PlanFile } from '../../core/types'
import { useProject } from '../store/project'

/** Eski planlarda kontroller nesne olabilir ({ id, ... }); ekranda ad olarak gösterilir */
const list = (v: unknown[] | undefined): string =>
  (v ?? []).map((c) => (typeof c === 'string' ? c : c && typeof c === 'object' ? String((c as Record<string, unknown>).id ?? (c as Record<string, unknown>).name ?? (c as Record<string, unknown>).key ?? '') : String(c ?? ''))).filter(Boolean).join(', ')
const unlist = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)

export default function PlanPage(): JSX.Element {
  const { current, setPlan, open, refreshProjects } = useProject()
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [notice, setNotice] = useState<{ kind: 'error' | 'warning' | 'success'; text: string } | null>(null)
  const [draft, setDraft] = useState<Plan | null>(current?.plan ?? null)
  const logRef = useRef<HTMLPreElement>(null)
  const id = current!.id

  useEffect(
    () =>
      window.legt.llm.onEvent((e) => {
        if (e.projectId !== id) return
        if (e.type === 'token') setLog((l) => l + e.chunk)
        if (e.type === 'attempt' && e.attempt > 0) {
          setLog('')
          setNotice({ kind: 'warning', text: `Plan şemaya uymadı, yeniden isteniyor (deneme ${e.attempt + 1}/3):\n${e.errors.join('\n')}` })
        }
      }),
    [id]
  )
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  const runAnalyze = async (): Promise<void> => {
    setRunning(true)
    setLog('')
    setNotice(null)
    try {
      const plan = await window.legt.projects.analyze(id)
      setDraft(plan)
      setPlan(plan)
      setNotice({ kind: 'success', text: 'Plan hazır. Gözden geçirip düzenleyin, ardından onaylayın.' })
      await refreshProjects()
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      setRunning(false)
    }
  }

  const save = async (approve: boolean): Promise<void> => {
    if (!draft) return
    await window.legt.projects.savePlan(id, draft, approve)
    await refreshProjects()
    if (approve) await open(id)
    else setNotice({ kind: 'success', text: 'Plan kaydedildi' })
  }

  const updateSection = (i: number, patch: Partial<ElementorSection & BlockSection>): void => {
    if (!draft) return
    const sections = draft.sections.map((s, j) => (j === i ? { ...s, ...patch } : s))
    setDraft({ ...draft, sections } as Plan)
  }
  const updateFile = (i: number, patch: Partial<PlanFile> | null): void => {
    if (!draft) return
    const files = patch === null ? draft.files.filter((_, j) => j !== i) : draft.files.map((f, j) => (j === i ? { ...f, ...patch } : f))
    setDraft({ ...draft, files })
  }

  const approved = current!.state.step !== 'intake' && current!.state.step !== 'analyzed'

  return (
    <div className="flex max-w-[1400px] flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button appearance={draft ? 'secondary' : 'primary'} icon={running ? <Spinner size="tiny" /> : <PlayRegular />} disabled={running || approved} onClick={() => void runAnalyze()}>
          {draft ? 'Yeniden analiz et' : 'Analizi başlat'}
        </Button>
        {running && (
          <Button icon={<DismissRegular />} onClick={() => void window.legt.llm.cancel(id)}>
            İptal
          </Button>
        )}
        <Button appearance="subtle" icon={<FolderOpenRegular />} className="!ml-auto" onClick={() => void window.legt.projects.openFolder(id)}>
          Proje klasörü
        </Button>
      </div>

      {notice && (
        <MessageBar intent={notice.kind}>
          <MessageBarBody style={{ whiteSpace: 'pre-wrap' }}>{notice.text}</MessageBarBody>
        </MessageBar>
      )}

      {(running || (!draft && log)) && (
        <Card>
          <CardHeader header={<Subtitle2>Model çıktısı (canlı)</Subtitle2>} />
          <pre ref={logRef} className="m-0 max-h-80 overflow-auto text-xs" style={{ fontFamily: 'Consolas, "Cascadia Code", monospace', whiteSpace: 'pre-wrap' }}>
            {log || 'Model yükleniyor…'}
          </pre>
        </Card>
      )}

      {draft && (
        <>
          <Card>
            <CardHeader
              header={<Subtitle2>Bölümler → {draft.mode === 'elementor-free' ? "widget'lar" : "pattern'ler"}</Subtitle2>}
              description={<Caption1>Kontrol listelerini virgülle ayırarak düzenleyin</Caption1>}
            />
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell style={{ width: 110 }}>HTML</TableHeaderCell>
                  <TableHeaderCell>{draft.mode === 'elementor-free' ? 'Widget' : 'Pattern slug'}</TableHeaderCell>
                  <TableHeaderCell>{draft.mode === 'elementor-free' ? 'İçerik kontrolleri' : 'Bloklar'}</TableHeaderCell>
                  {draft.mode === 'elementor-free' && <TableHeaderCell>Stil kontrolleri</TableHeaderCell>}
                  <TableHeaderCell style={{ width: 120 }}>JS</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.sections.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Caption1>{s.htmlRef}</Caption1>
                    </TableCell>
                    {draft.mode === 'elementor-free' ? (
                      <>
                        <TableCell>
                          <Input size="small" className="w-full" value={(s as ElementorSection).widget} onChange={(_, d) => updateSection(i, { widget: d.value })} />
                        </TableCell>
                        <TableCell>
                          <Input size="small" className="w-full" value={list((s as ElementorSection).contentControls)} onChange={(_, d) => updateSection(i, { contentControls: unlist(d.value) })} />
                        </TableCell>
                        <TableCell>
                          <Input size="small" className="w-full" value={list((s as ElementorSection).styleControls)} onChange={(_, d) => updateSection(i, { styleControls: unlist(d.value) })} />
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>
                          <Input size="small" className="w-full" value={(s as BlockSection).slug} onChange={(_, d) => updateSection(i, { slug: d.value })} />
                        </TableCell>
                        <TableCell>
                          <Input size="small" className="w-full" value={list((s as BlockSection).blocks)} onChange={(_, d) => updateSection(i, { blocks: unlist(d.value) })} />
                        </TableCell>
                      </>
                    )}
                    <TableCell>
                      <Input size="small" className="w-full" value={s.js} onChange={(_, d) => updateSection(i, { js: d.value })} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card>
            <CardHeader
              header={<Subtitle2>Dosyalar ({draft.files.length})</Subtitle2>}
              action={
                <Button size="small" icon={<AddRegular />} onClick={() => setDraft({ ...draft, files: [...draft.files, { path: '', source: 'llm', dependsOn: [] }] })}>
                  Dosya ekle
                </Button>
              }
            />
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Yol</TableHeaderCell>
                  <TableHeaderCell style={{ width: 140 }}>Kaynak</TableHeaderCell>
                  <TableHeaderCell style={{ width: 140 }}>Bölüm</TableHeaderCell>
                  <TableHeaderCell style={{ width: 48 }} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.files.map((f, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Input size="small" className="w-full" value={f.path} onChange={(_, d) => updateFile(i, { path: d.value })} />
                    </TableCell>
                    <TableCell>
                      <Dropdown size="small" className="!min-w-0" value={f.source} selectedOptions={[f.source]} onOptionSelect={(_, d) => updateFile(i, { source: d.optionValue as PlanFile['source'] })}>
                        <Option value="llm">llm</Option>
                        <Option value="scaffold">scaffold</Option>
                      </Dropdown>
                    </TableCell>
                    <TableCell>
                      <Caption1>{f.sectionId ?? '—'}</Caption1>
                    </TableCell>
                    <TableCell>
                      <Button size="small" appearance="subtle" icon={<DeleteRegular />} aria-label="Sil" onClick={() => updateFile(i, null)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card>
            <CardHeader header={<Subtitle2>Tasarım token'ları</Subtitle2>} />
            <pre className="m-0 max-h-64 overflow-auto text-xs" style={{ fontFamily: 'Consolas, "Cascadia Code", monospace' }}>
              {JSON.stringify(draft.tokens, null, 2)}
            </pre>
          </Card>

          <div className="flex justify-end gap-2">
            <Button icon={<SaveRegular />} disabled={approved} onClick={() => void save(false)}>
              Kaydet
            </Button>
            <Button appearance="primary" icon={<CheckmarkRegular />} disabled={approved || draft.files.some((f) => !f.path.trim())} onClick={() => void save(true)}>
              {approved ? 'Onaylandı' : 'Onayla ve üretime geç'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
