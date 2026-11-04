import { useEffect, useRef, useState } from 'react'
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Feature as GeoFeature, FeatureCollection, Geometry } from 'geojson'

// Bundling breaks MapLibre's automatic worker lookup, so point to it directly
setWorkerUrl(workerUrl)

const SIMALUGURI: [number, number] = [94.756, 26.92]
const SETTLEMENTS = 'settlements'
const ALERT_PREVIEW_COUNT = 8

const KINDS = ['observed', 'forecast', 'simulated'] as const
type Kind = (typeof KINDS)[number]

const KIND_INFO: Record<Kind, { label: string; help: string; color: string }> = {
  observed: { label: 'Observed', help: 'Measured on the ground or by satellite', color: '#1565c0' },
  forecast: { label: 'Forecast', help: 'Model prediction of the future', color: '#b45309' },
  simulated: { label: 'Simulated', help: 'What-if flood scenarios', color: '#7b1fa2' },
}

const STANDARD_FIELDS = new Set(['kind', 'name', 'source', 'timestamp', 'quality'])
const POLYGON_FILTER: ExpressionSpecification = [
  'in',
  ['geometry-type'],
  ['literal', ['Polygon', 'MultiPolygon']],
]
const POINT_FILTER: ExpressionSpecification = ['==', ['geometry-type'], 'Point']

type Properties = Record<string, string | number | null>
type Feature = GeoFeature<Geometry, Properties>
type Layer = FeatureCollection<Geometry, Properties>
type Layers = Record<Kind, Layer | null>
type Alert = {
  id: number
  created_at: string
  rise_m: number
  settlements: string[]
  channel: string
}

const EMPTY_LAYERS: Layers = { observed: null, forecast: null, simulated: null }

function formatTime(timestamp: string | number | null) {
  if (!timestamp) return 'Time not available'
  const date = new Date(String(timestamp))
  return Number.isNaN(date.getTime()) ? String(timestamp) : date.toLocaleString('en-IN')
}

function formatField(key: string) {
  return key
    .replace(/_km2$/, ' (km²)')
    .replace(/_mm$/, ' (mm)')
    .replace(/_m$/, ' (m)')
    .replace(/_/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

function extraFields(properties: Properties) {
  return Object.entries(properties).filter(([key]) => !STANDARD_FIELDS.has(key))
}

function popupContent(properties: Properties) {
  const root = document.createElement('div')
  root.className = 'popup'
  const addLine = (text: string, className?: string) => {
    const line = document.createElement('div')
    line.textContent = text
    if (className) line.className = className
    root.appendChild(line)
  }
  addLine(String(properties.name ?? 'Unnamed'), 'popup-title')
  for (const [key, value] of extraFields(properties)) {
    addLine(`${formatField(key)}: ${value ?? 'not available'}`)
  }
  addLine(`Time: ${formatTime(properties.timestamp)}`)
  addLine(`Source: ${properties.source ?? 'Not stated'}`)
  addLine(`Quality: ${properties.quality ?? 'Not stated'}`)
  return root
}

function FeatureCard({ feature, kind }: { feature: Feature; kind: Kind }) {
  const { properties } = feature
  return (
    <article className="card" style={{ borderLeftColor: KIND_INFO[kind].color }}>
      <h3>{properties.name}</h3>
      {extraFields(properties).map(([key, value]) => (
        <p key={key}>
          <strong>{formatField(key)}:</strong> {value ?? 'not available'}
        </p>
      ))}
      <p>
        <strong>Time:</strong> {formatTime(properties.timestamp)}
      </p>
      <p>
        <strong>Source:</strong> {properties.source}
      </p>
      <p>
        <strong>Quality:</strong> {properties.quality}
      </p>
    </article>
  )
}

function Tile({ kind, label, value }: { kind: Kind; label: string; value: string }) {
  const info = KIND_INFO[kind]
  return (
    <div className="tile">
      <span className="tile-kind" style={{ color: info.color }}>
        {info.label}
      </span>
      <strong>{value}</strong>
      <span className="tile-label">{label}</span>
    </div>
  )
}

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [layers, setLayers] = useState<Layers>(EMPTY_LAYERS)
  const layersRef = useRef<Layers>(EMPTY_LAYERS)
  const [settlements, setSettlements] = useState<Layer | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [rise, setRise] = useState(2)
  const [visible, setVisible] = useState<Record<Kind, boolean>>({
    observed: true,
    forecast: true,
    simulated: true,
  })
  const [error, setError] = useState<string | null>(null)
  const [alertError, setAlertError] = useState<string | null>(null)
  const [sendingAlert, setSendingAlert] = useState(false)

  useEffect(() => {
    if (!mapContainer.current) return
    const map = new MapLibreMap({
      container: mapContainer.current,
      center: SIMALUGURI,
      zoom: 10,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
    })
    map.addControl(new NavigationControl(), 'top-right')

    const addInteraction = (layerId: string, kind: Kind | null) => {
      map.on('click', layerId, (event) => {
        // MapLibre drops null values from clicked features, so use the original data
        const clicked = event.features?.[0]?.properties as Properties | undefined
        if (!clicked) return
        const original = kind
          ? layersRef.current[kind]?.features.find(
              (feature) => feature.properties.name === clicked.name,
            )
          : undefined
        new Popup()
          .setLngLat(event.lngLat)
          .setDOMContent(popupContent(original?.properties ?? clicked))
          .addTo(map)
      })
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    map.on('load', () => {
      const empty: Layer = { type: 'FeatureCollection', features: [] }
      for (const kind of KINDS) {
        const { color } = KIND_INFO[kind]
        map.addSource(kind, { type: 'geojson', data: empty })
        map.addLayer({
          id: `${kind}-area`,
          type: 'fill',
          source: kind,
          filter: POLYGON_FILTER,
          paint: { 'fill-color': color, 'fill-opacity': 0.4 },
        })
      }
      map.addSource(SETTLEMENTS, { type: 'geojson', data: empty })
      map.addLayer({
        id: SETTLEMENTS,
        type: 'circle',
        source: SETTLEMENTS,
        paint: {
          'circle-color': KIND_INFO.simulated.color,
          'circle-radius': 5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      })
      addInteraction(SETTLEMENTS, null)
      for (const kind of KINDS) {
        const { color } = KIND_INFO[kind]
        map.addLayer({
          id: `${kind}-point`,
          type: 'circle',
          source: kind,
          filter: POINT_FILTER,
          paint: {
            'circle-color': color,
            'circle-radius': 9,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        })
        addInteraction(`${kind}-point`, kind)
      }
      addInteraction('simulated-area', 'simulated')
      setMapReady(true)
    })
    mapRef.current = map
    return () => {
      setMapReady(false)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const getJson = async <T,>(url: string) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${url} failed with status ${response.status}`)
      return (await response.json()) as T
    }
    Promise.all([
      Promise.all(
        KINDS.map(async (kind) => [kind, await getJson<Layer>(`/api/layers/${kind}`)] as const),
      ),
      getJson<Layer>('/api/settlements'),
      getJson<Alert[]>('/api/alerts'),
    ])
      .then(([layerResults, settlementLayer, alertLog]) => {
        if (cancelled) return
        setLayers(Object.fromEntries(layerResults) as Layers)
        setSettlements(settlementLayer)
        setAlerts(alertLog)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    layersRef.current = layers
    const map = mapRef.current
    if (!map || !mapReady) return
    for (const kind of KINDS) {
      const layer = layers[kind]
      if (layer) (map.getSource(kind) as GeoJSONSource).setData(layer)
      const visibility = visible[kind] ? 'visible' : 'none'
      map.setLayoutProperty(`${kind}-area`, 'visibility', visibility)
      map.setLayoutProperty(`${kind}-point`, 'visibility', visibility)
    }
    if (settlements) (map.getSource(SETTLEMENTS) as GeoJSONSource).setData(settlements)
    map.setLayoutProperty(SETTLEMENTS, 'visibility', visible.simulated ? 'visible' : 'none')
    map.setFilter('simulated-area', ['all', POLYGON_FILTER, ['==', ['get', 'rise_m'], rise]])
    map.setFilter(SETTLEMENTS, [
      'all',
      ['has', 'first_flooded_at_m'],
      ['<=', ['to-number', ['get', 'first_flooded_at_m']], rise],
    ])
  }, [layers, settlements, visible, rise, mapReady])

  const scenarios = [...(layers.simulated?.features ?? [])].sort(
    (a, b) => Number(a.properties.rise_m) - Number(b.properties.rise_m),
  )
  const selected = scenarios.find((scenario) => scenario.properties.rise_m === rise)
  const riseValues = scenarios.map((scenario) => Number(scenario.properties.rise_m))
  const affected = (settlements?.features ?? [])
    .filter((settlement) => {
      const level = settlement.properties.first_flooded_at_m
      return level !== null && Number(level) <= rise
    })
    .map((settlement) => String(settlement.properties.name))
    .sort()
  const pilotLevel = settlements?.features.find(
    (settlement) => settlement.properties.name === 'Simaluguri',
  )?.properties.first_flooded_at_m
  const pilotFlooded = pilotLevel != null && Number(pilotLevel) <= rise
  const gauge = layers.observed?.features[0]?.properties
  const rain = layers.forecast?.features[0]?.properties

  const logAlert = async () => {
    setSendingAlert(true)
    setAlertError(null)
    try {
      const response = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rise_m: rise }),
      })
      if (!response.ok) throw new Error(`Status ${response.status}`)
      const alert = (await response.json()) as Alert
      setAlerts((current) => [alert, ...current])
    } catch (reason) {
      setAlertError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSendingAlert(false)
    }
  }

  return (
    <div className="app">
      <aside className="panel">
        <header>
          <h1>NodiBondhu Flood Twin</h1>
          <p>Simaluguri, Sivasagar district, Assam. Prototype, not for operational use.</p>
        </header>
        {error && (
          <p className="error" role="alert">
            Could not load data: {error}
          </p>
        )}

        <div className="tiles">
          <Tile
            kind="simulated"
            label={
              pilotLevel != null
                ? `Simaluguri at +${rise} m. Model floods it from +${pilotLevel} m`
                : `Simaluguri at +${rise} m`
            }
            value={settlements ? (pilotFlooded ? 'Flooded' : 'Not flooded') : 'No data'}
          />
          <Tile
            kind="observed"
            label="River level near Simaluguri"
            value={gauge?.level_m != null ? `${gauge.level_m} m` : 'Pending'}
          />
          <Tile
            kind="forecast"
            label="Rain, next 24 hours"
            value={rain?.rain_next_24h_mm != null ? `${rain.rain_next_24h_mm} mm` : 'Pending'}
          />
          <Tile
            kind="simulated"
            label={`Flooded land at +${rise} m`}
            value={selected ? `${selected.properties.flooded_area_km2} km²` : 'No data'}
          />
          <Tile
            kind="simulated"
            label={`Mapped settlements at +${rise} m`}
            value={settlements ? String(affected.length) : 'No data'}
          />
        </div>

        <section>
          <h2>Flood scenario</h2>
          {riseValues.length > 0 ? (
            <>
              <label className="slider" htmlFor="rise">
                River rise: <strong>+{rise} m</strong>
              </label>
              <input
                id="rise"
                type="range"
                min={Math.min(...riseValues)}
                max={Math.max(...riseValues)}
                step={1}
                value={rise}
                onChange={(event) => setRise(Number(event.target.value))}
              />
              <table>
                <thead>
                  <tr>
                    <th scope="col">Rise</th>
                    <th scope="col">Flooded land</th>
                    <th scope="col">Settlements</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((scenario) => (
                    <tr
                      key={scenario.properties.rise_m}
                      className={scenario === selected ? 'selected' : undefined}
                    >
                      <td>+{scenario.properties.rise_m} m</td>
                      <td>{scenario.properties.flooded_area_km2} km²</td>
                      <td>{scenario.properties.settlements_affected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note">
                Counts only cover places mapped in OpenStreetMap, so the real number will be higher.
              </p>
            </>
          ) : (
            <p className="empty">No scenarios yet</p>
          )}
        </section>

        <section>
          <h2>Alert for this scenario</h2>
          {affected.length > 0 ? (
            <>
              <p className="alert-preview">
                <strong>Simulated scenario, +{rise} m:</strong>{' '}
                {affected.slice(0, ALERT_PREVIEW_COUNT).join(', ')}
                {affected.length > ALERT_PREVIEW_COUNT &&
                  ` and ${affected.length - ALERT_PREVIEW_COUNT} more`}{' '}
                may be affected. An officer must check this before any warning goes out.
              </p>
              <button type="button" onClick={logAlert} disabled={sendingAlert}>
                {sendingAlert ? 'Logging...' : 'Approve and log demo alert'}
              </button>
              <p className="note">Demo only: this is logged here and not sent to anyone.</p>
            </>
          ) : (
            <p className="empty">No settlements affected in this scenario</p>
          )}
          {alertError && (
            <p className="error" role="alert">
              Could not log the alert: {alertError}
            </p>
          )}
          {alerts.length > 0 && (
            <ul className="alert-log">
              {alerts.slice(0, 3).map((alert) => (
                <li key={alert.id}>
                  {formatTime(alert.created_at)}: +{alert.rise_m} m, {alert.settlements.length}{' '}
                  settlements
                </li>
              ))}
            </ul>
          )}
        </section>

        {KINDS.map((kind) => {
          const info = KIND_INFO[kind]
          const features =
            kind === 'simulated' ? (selected ? [selected] : []) : (layers[kind]?.features ?? [])
          return (
            <section key={kind}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={visible[kind]}
                  onChange={(event) => setVisible({ ...visible, [kind]: event.target.checked })}
                />
                <span className="swatch" style={{ backgroundColor: info.color }} />
                <span>
                  <strong>{info.label}</strong>
                  <small>{info.help}</small>
                </span>
              </label>
              {features.length === 0 && !error && <p className="empty">No data yet</p>}
              {features.map((feature, index) => (
                <FeatureCard key={index} feature={feature} kind={kind} />
              ))}
            </section>
          )
        })}
      </aside>
      <main className="map" ref={mapContainer} aria-label="Flood map" />
    </div>
  )
}
