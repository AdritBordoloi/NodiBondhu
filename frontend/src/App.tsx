import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { BrandMark } from './components/Brand'
import {
  IconBroadcast,
  IconDatabase,
  IconExpand,
  IconReport,
  IconScope,
  IconSliders,
} from './components/Icons'
import { Panel } from './components/ui'
import {
  EAST,
  KINDS,
  KIND_INFO,
  NORTH,
  SOUTH,
  WEST,
  loadDataset,
  placesFrom,
  scenariosFrom,
  type Alert,
  type Dataset,
  type Place,
} from './lib/domain'
import Situation from './views/Situation'
import ScenarioLab from './views/ScenarioLab'
import AlertCentre from './views/AlertCentre'
import Evidence from './views/Evidence'
import Report, { type ReportInfo } from './views/Report'
import Launch from './views/Launch'

type View = 'launch' | 'situation' | 'scenario' | 'alerts' | 'evidence' | 'report'
type Visible = Record<'observed' | 'forecast' | 'simulated' | 'places' | 'boundary', boolean>

const NAV: { id: View; label: string; icon: (props: { size?: number }) => React.ReactNode }[] = [
  { id: 'situation', label: 'Situation', icon: IconScope },
  { id: 'scenario', label: 'Scenario', icon: IconSliders },
  { id: 'alerts', label: 'Alerts', icon: IconBroadcast },
  { id: 'evidence', label: 'Evidence', icon: IconDatabase },
  { id: 'report', label: 'Report', icon: IconReport },
]

export default function App() {
  const [view, setView] = useState<View>('launch')
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [rise, setRise] = useState(2)
  const [visible, setVisible] = useState<Visible>({
    observed: true,
    forecast: true,
    simulated: true,
    places: true,
    boundary: true,
  })
  const [expanded, setExpanded] = useState(false)
  const [present, setPresent] = useState(false)
  const [focus, setFocus] = useState<Place | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [report, setReport] = useState<ReportInfo | null>(null)
  const [lastImage, setLastImage] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const applyDataset = useCallback((data: Dataset) => {
    const levels = scenariosFrom(data.layers.simulated)
    setDataset(data)
    setAlerts(data.alerts)
    setStatus('ready')
    setRise((current) =>
      levels.length && !levels.some((item) => item.rise === current)
        ? (levels[1]?.rise ?? levels[0].rise)
        : current,
    )
  }, [])

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      applyDataset(await loadDataset())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setStatus('error')
    }
  }, [applyDataset])

  useEffect(() => {
    let cancelled = false
    loadDataset()
      .then((data) => {
        if (!cancelled) applyDataset(data)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [applyDataset])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPresent(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const scenarios = useMemo(() => scenariosFrom(dataset?.layers.simulated ?? null), [dataset])
  const places = useMemo(() => placesFrom(dataset?.settlements ?? null), [dataset])

  const scenario = scenarios.find((item) => item.rise === rise)

  const captureMap = useCallback(async (): Promise<string | null> => {
    if (!map) return null
    const snapshot = () =>
      new Promise<string | null>((resolve) => {
        const read = () => {
          try {
            resolve(map.getCanvas().toDataURL('image/png'))
          } catch {
            resolve(null)
          }
        }
        // Wait for tiles before painting, otherwise the snapshot has no basemap
        const paint = () => {
          map.once('render', read)
          map.triggerRepaint()
        }
        if (map.loaded() && map.areTilesLoaded()) paint()
        else map.once('idle', paint)
      })
    return Promise.race([
      snapshot(),
      new Promise<string | null>((resolve) => window.setTimeout(() => resolve(null), 7000)),
    ])
  }, [map])

  // Keep a fresh map snapshot so the report can be generated from any view
  useEffect(() => {
    if (view !== 'situation' || !map) return
    const timer = window.setTimeout(() => {
      void captureMap().then((image) => {
        if (image) setLastImage(image)
      })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [view, map, rise, visible, captureMap])

  const openReport = useCallback(async () => {
    // The brief should always show the whole pilot window, not wherever the operator last zoomed
    if (map) {
      map.fitBounds(
        [
          [WEST, SOUTH],
          [EAST, NORTH],
        ],
        { padding: 40, duration: 0 },
      )
      await Promise.race([
        new Promise<void>((resolve) => map.once('idle', () => resolve())),
        new Promise<void>((resolve) => window.setTimeout(resolve, 6000)),
      ])
    }
    const image = (await captureMap()) ?? lastImage ?? report?.mapImage ?? null
    setReport({
      generatedAt: new Date().toISOString(),
      mapImage: image,
      layersShown: KINDS.filter((kind) => visible[kind]).map((kind) => KIND_INFO[kind].label),
    })
    setPresent(false)
    setView('report')
  }, [captureMap, lastImage, map, report, visible])

  const enterPresent = () => {
    setPresent(true)
    setExpanded(true)
    if (view !== 'situation') setView('situation')
  }

  if (view === 'launch' && status !== 'error') {
    return (
      <Launch
        onEnter={() => setView('situation')}
        onScenario={() => setView('scenario')}
        placeCount={places.length}
        levels={scenarios.length}
      />
    )
  }

  const clockText = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })

  return (
    <div className={`app ${present ? 'is-present' : ''} ${view === 'situation' ? 'is-map' : ''}`}>
      {!present && (
        <header className="topbar">
          <button type="button" className="topbar-brand" onClick={() => setView('launch')}>
            <BrandMark size={24} />
            <span className="topbar-brandtext">
              <strong>NodiBondhu</strong>
              <em>flood twin</em>
            </span>
          </button>

          <span className="topbar-region">
            Simaluguri · Dikhow
            <span className="topbar-region-sub">Sivasagar, Assam</span>
          </span>

          <nav className="topnav" aria-label="Modules">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`nav-item ${view === id ? 'is-active' : ''}`}
                aria-current={view === id ? 'page' : undefined}
                onClick={() => {
                  setPresent(false)
                  if (id === 'report') void openReport()
                  else setView(id)
                }}
              >
                <Icon size={16} />
                {label}
                {id === 'alerts' && alerts.length > 0 && <span className="nav-badge">{alerts.length}</span>}
              </button>
            ))}
          </nav>

          <div className="topbar-right">
            <span className="live-pill">
              <span className="live-dot" />
              Prototype
            </span>
            <span className="topbar-clock">
              <span className="topbar-clock-label">IST</span>
              {clockText}
            </span>
            <button type="button" className="ghost-button is-compact" onClick={enterPresent}>
              <IconExpand size={14} />
              Present
            </button>
          </div>
        </header>
      )}

      {present && (
        <button type="button" className="present-exit" onClick={() => setPresent(false)}>
          Exit present · Esc
        </button>
      )}

      <main className="app-main">
        {status === 'loading' && (
          <div className="state-screen">
            <span className="state-mark">
              <BrandMark size={34} />
            </span>
            <p>Connecting to the flood twin…</p>
            <span className="state-sub">Loading observed, forecast and simulated layers</span>
          </div>
        )}

        {status === 'error' && (
          <div className="state-screen">
            <Panel title="The API is not answering" subtitle={error ?? undefined}>
              <p className="state-text">
                Start the backend on port 8000 and retry. The interface reads every layer from
                <code> /api/layers/…</code>.
              </p>
              <pre className="state-code">backend\.venv\Scripts\python -m uvicorn main:app --app-dir backend --port 8000</pre>
              <button type="button" className="primary-button" onClick={() => void load()}>
                Retry connection
              </button>
            </Panel>
          </div>
        )}

        {status === 'ready' && view === 'situation' && (
          <Situation
            dataset={dataset}
            scenarios={scenarios}
            places={places}
            rise={rise}
            setRise={setRise}
            visible={visible}
            setVisible={setVisible}
            expanded={expanded}
            setExpanded={setExpanded}
            focus={focus}
            setFocus={setFocus}
            onMapReady={setMap}
          />
        )}

        {status === 'ready' && view === 'scenario' && (
          <ScenarioLab
            dataset={dataset}
            scenarios={scenarios}
            places={places}
            rise={rise}
            setRise={setRise}
            onOpenAlerts={() => setView('alerts')}
          />
        )}

        {status === 'ready' && view === 'alerts' && (
          <AlertCentre
            dataset={dataset}
            scenarios={scenarios}
            places={places}
            rise={rise}
            alerts={alerts}
            onLogged={(alert) => setAlerts((current) => [alert, ...current])}
          />
        )}

        {status === 'ready' && view === 'evidence' && <Evidence dataset={dataset} scenario={scenario} />}

        {status === 'ready' && view === 'report' && (
          <Report
            info={report}
            rise={rise}
            scenarios={scenarios}
            places={places}
            dataset={dataset}
            alerts={alerts}
            onPrint={() => window.print()}
            onBack={() => setView('situation')}
          />
        )}
      </main>
    </div>
  )
}
