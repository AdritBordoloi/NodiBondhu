import type { ReactNode } from 'react'
import { IconCloudRain, IconDatabase, IconDroplet, IconLink, IconWaves } from '../components/Icons'
import { Chip, CopyButton, Panel, ViewHeader } from '../components/ui'
import {
  KIND_INFO,
  formatArea,
  formatNumber,
  formatTime,
  type Dataset,
  type Kind,
  type Properties,
  type Scenario,
} from '../lib/domain'

const ENDPOINTS = [
  { method: 'GET', path: '/api/layers/observed', note: 'Gauge and satellite observations, GeoJSON' },
  { method: 'GET', path: '/api/layers/forecast', note: 'Rain forecast near the pilot point' },
  { method: 'GET', path: '/api/layers/simulated', note: 'One polygon per pre-computed rise level' },
  { method: 'GET', path: '/api/settlements', note: 'Places with their first-flood level' },
  { method: 'GET', path: '/api/alerts', note: 'Append-only demo alert log' },
  { method: 'POST', path: '/api/alerts', note: 'Log an officer-approved demo alert' },
  { method: 'GET', path: '/api/health', note: 'Service liveness check' },
]

const SOURCES = [
  {
    name: 'Open-Meteo forecast API',
    use: 'Rain totals for the next 24 and 72 hours',
    state: 'Live',
    tone: 'ok' as const,
    licence: 'Free for non-commercial use, attribution required',
  },
  {
    name: 'OpenStreetMap places',
    use: 'Hamlet and village points in the pilot window',
    state: 'Static extract',
    tone: 'neutral' as const,
    licence: 'ODbL, attribution required',
  },
  {
    name: 'OpenStreetMap rivers',
    use: 'Drainage network used by the HAND pre-processing',
    state: 'Static extract',
    tone: 'neutral' as const,
    licence: 'ODbL, attribution required',
  },
  {
    name: 'Copernicus DEM GLO-30',
    use: 'Terrain heights behind every simulated level',
    state: 'Pre-processed',
    tone: 'neutral' as const,
    licence: 'Copernicus DEM licence, attribution required',
  },
  {
    name: 'CWC gauge, Dikhow / Disang',
    use: 'Observed river level for the pilot area',
    state: 'Not connected',
    tone: 'warn' as const,
    licence: 'India-WRIS, access not confirmed',
  },
  {
    name: 'Sentinel-1 flood extent',
    use: 'Historical extent to validate the model',
    state: 'Not yet',
    tone: 'danger' as const,
    licence: 'Copernicus open data',
  },
]

const ICONS: Record<Kind, ReactNode> = {
  observed: <IconDroplet size={16} />,
  forecast: <IconCloudRain size={16} />,
  simulated: <IconWaves size={16} />,
}

export default function Evidence({
  dataset,
  scenario,
}: {
  dataset: Dataset | null
  scenario: Scenario | undefined
}) {
  const featureOf = (kind: Kind): Properties | undefined => dataset?.layers[kind]?.features[0]?.properties
  const countOf = (kind: Kind) => dataset?.layers[kind]?.features.length ?? 0

  return (
    <div className="page">
      <ViewHeader
        eyebrow="Evidence"
        title="Provenance and interoperability"
        lead="Every layer states where it came from, when it was produced and how much to trust it. Observed, forecast and simulated data are never mixed into a single number."
        actions={
          <Chip tone="ghost" dot>
            Open GeoJSON over HTTP
          </Chip>
        }
      />

      <div className="kind-grid">
        {(Object.keys(KIND_INFO) as Kind[]).map((kind) => {
          const info = KIND_INFO[kind]
          const properties = featureOf(kind)
          const empty = countOf(kind) === 0
          return (
            <article key={kind} className="kind-card" style={{ ['--kind' as string]: info.color }}>
              <header>
                <span className="kind-icon">{ICONS[kind]}</span>
                <div>
                  <h2>{info.label}</h2>
                  <p>{info.help}</p>
                </div>
                <Chip tone={empty ? 'warn' : 'ghost'} dot={empty}>
                  {empty ? 'Pending' : `${countOf(kind)} ${countOf(kind) === 1 ? 'feature' : 'features'}`}
                </Chip>
              </header>
              {empty ? (
                <div className="kind-empty">
                  <p>No observed feature is connected yet.</p>
                  <span>
                    The nearest CWC gauge on the Dikhow, Disang or Brahmaputra still has to be identified and
                    ingested. The layer stays empty rather than showing a guess.
                  </span>
                </div>
              ) : (
                <dl className="kind-rows">
                  <dt>Source</dt>
                  <dd>{String(properties?.source ?? 'Not stated')}</dd>
                  <dt>Timestamp</dt>
                  <dd>{formatTime(properties?.timestamp)}</dd>
                  {kind === 'forecast' && (
                    <>
                      <dt>Next 24 h</dt>
                      <dd>{properties?.rain_next_24h_mm ?? '—'} mm</dd>
                      <dt>Next 72 h</dt>
                      <dd>{properties?.rain_next_72h_mm ?? '—'} mm</dd>
                    </>
                  )}
                  {kind === 'simulated' && scenario && (
                    <>
                      <dt>Current level</dt>
                      <dd>+{scenario.rise} m</dd>
                      <dt>Flooded land</dt>
                      <dd>{formatArea(scenario.area)}</dd>
                      <dt>Places in extent</dt>
                      <dd>{formatNumber(scenario.affected)}</dd>
                    </>
                  )}
                  <dt>Quality</dt>
                  <dd className="kind-quality">{String(properties?.quality ?? 'Not stated')}</dd>
                </dl>
              )}
            </article>
          )
        })}
      </div>

      <div className="grid-2">
        <Panel
          title="Source register"
          subtitle="What is real, what is static and what is still missing"
          flush
          actions={<IconDatabase size={16} />}
        >
          <div className="table-wrap">
            <table className="data-table is-roomy">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Used for</th>
                  <th scope="col">State</th>
                  <th scope="col">Terms</th>
                </tr>
              </thead>
              <tbody>
                {SOURCES.map((source) => (
                  <tr key={source.name}>
                    <td>{source.name}</td>
                    <td className="cell-muted">{source.use}</td>
                    <td>
                      <Chip tone={source.tone} dot>
                        {source.state}
                      </Chip>
                    </td>
                    <td className="cell-muted">{source.licence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Open endpoints"
          subtitle="The same numbers the interface shows are available to other systems"
          actions={<IconLink size={16} />}
        >
          <div className="endpoint-list">
            {ENDPOINTS.map((endpoint) => (
              <div key={endpoint.path + endpoint.method} className="endpoint-row">
                <span className={`method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
                <code>{endpoint.path}</code>
                <CopyButton value={`${window.location.origin}${endpoint.path}`} />
                <span className="endpoint-note">{endpoint.note}</span>
              </div>
            ))}
          </div>
          <p className="panel-footnote">
            Everything is plain GeoJSON over HTTP, so a district GIS or the ASDMA dashboard can consume the same
            layers without this interface. A WMS/WFS wrapper and a push subscription are the next step.
          </p>
        </Panel>
      </div>
    </div>
  )
}
