import { useEffect, useState, type JSX } from 'react'
import { Badge, Button, Caption1, FluentProvider, Subtitle2, Tab, TabList, Text, Title3, Tooltip } from '@fluentui/react-components'
import { AddRegular, ArrowExportRegular, BugRegular, CodeRegular, DocumentTextRegular, ServerRegular, SettingsRegular, TableRegular } from '@fluentui/react-icons'
import { acrylic, appBackground, useSystemTheme } from './theme'
import { useProject, type Page } from './store/project'
import { SettingsDialog } from './components/SettingsDialog'
import { OllamaSetup } from './components/OllamaSetup'
import Intake from './pages/Intake'
import PlanPage from './pages/Plan'
import Generate from './pages/Generate'
import Export from './pages/Export'
import Test from './pages/Test'

const STEPS: { page: Page; label: string; icon: JSX.Element }[] = [
  { page: 'intake', label: '1. Kaynak', icon: <DocumentTextRegular /> },
  { page: 'plan', label: '2. Plan', icon: <TableRegular /> },
  { page: 'generate', label: '3. Üretim', icon: <CodeRegular /> },
  { page: 'test', label: '4. Test', icon: <BugRegular /> },
  { page: 'export', label: '5. Dışa aktar', icon: <ArrowExportRegular /> }
]

export default function App(): JSX.Element {
  const { theme, dark } = useSystemTheme()
  const { page, setPage, current, projects, refreshProjects, open, newProject } = useProject()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  // Alt bileşenlerden (ör. Intake > görsel model yardımı) ayarları / Ollama kurulumunu aç
  useEffect(() => {
    const settings = (): void => setSettingsOpen(true)
    const ollama = (): void => setSetupOpen(true)
    window.addEventListener('legt:open-settings', settings)
    window.addEventListener('legt:open-ollama', ollama)
    return () => {
      window.removeEventListener('legt:open-settings', settings)
      window.removeEventListener('legt:open-ollama', ollama)
    }
  }, [])

  // Yerel Ollama kurulu değilse, çalışmıyorsa ya da modeli yoksa kurulum ekranı kendiliğinden açılır
  useEffect(() => {
    void (async () => {
      const cfg = await window.legt.settings.get()
      if (cfg.provider !== 'ollama' || !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(cfg.baseUrl)) return
      const st = await window.legt.ollama.status()
      if (!st.installed || !st.running || !st.models.length) setSetupOpen(true)
    })()
  }, [])

  const step = current?.state.step
  const enabled = (p: Page): boolean =>
    p === 'intake' ? !current : p === 'plan' ? !!current : p === 'generate' ? step === 'approved' || step === 'generating' || step === 'done' : step === 'done'

  return (
    <FluentProvider theme={theme} style={{ height: '100%', background: appBackground(window.legt.platform, dark) }}>
      <div className="flex h-full">
        <aside className="flex w-64 shrink-0 flex-col gap-3 p-3" style={{ ...acrylic(dark), borderWidth: '0 1px 0 0' }}>
          <div className="px-2 pt-2">
            <Title3>LEGT AI</Title3>
            <Caption1 block>Libre Extra Gratis Theme AI</Caption1>
          </div>
          <Button appearance="primary" icon={<AddRegular />} onClick={newProject}>
            Yeni proje
          </Button>
          <Subtitle2 className="px-2 pt-2">Projeler</Subtitle2>
          <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {projects.length === 0 && <Caption1 className="px-2">Henüz proje yok</Caption1>}
            {projects.map((p) => (
              <Button
                key={p.id}
                appearance={current?.id === p.id ? 'secondary' : 'subtle'}
                className="!justify-start"
                onClick={() => void open(p.id)}
              >
                <div className="flex w-full flex-col items-start text-left">
                  <Text weight="semibold" truncate wrap={false}>
                    {p.name}
                  </Text>
                  <Caption1>
                    {p.mode === 'block-theme' ? 'Block Theme' : 'Elementor Free'} · {p.step}
                  </Caption1>
                </div>
              </Button>
            ))}
          </div>
          <Tooltip content="Ollama'yı kur, başlat, model indir, paralel ayarla" relationship="description">
            <Button appearance="subtle" icon={<ServerRegular />} onClick={() => setSetupOpen(true)}>
              Ollama kurulumu
            </Button>
          </Tooltip>
          <Tooltip content="LLM bağlantısı ve model" relationship="description">
            <Button appearance="subtle" icon={<SettingsRegular />} onClick={() => setSettingsOpen(true)}>
              Ayarlar
            </Button>
          </Tooltip>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-4 px-6 pt-4">
            <TabList selectedValue={page} onTabSelect={(_, d) => setPage(d.value as Page)}>
              {STEPS.map((s) => (
                <Tab key={s.page} value={s.page} icon={s.icon} disabled={!enabled(s.page)}>
                  {s.label}
                </Tab>
              ))}
            </TabList>
            {current && (
              <Badge appearance="tint" className="ml-auto">
                {current.intake.theme.name} · {current.intake.theme.prefix}
              </Badge>
            )}
          </header>
          <section className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {page === 'intake' && <Intake />}
            {page === 'plan' && current && <PlanPage key={current.id} />}
            {page === 'generate' && current?.plan && <Generate key={current.id} />}
            {page === 'test' && current?.plan && <Test key={current.id} />}
            {page === 'export' && current?.plan && <Export key={current.id} />}
          </section>
        </main>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <OllamaSetup open={setupOpen} onClose={() => setSetupOpen(false)} />
    </FluentProvider>
  )
}
