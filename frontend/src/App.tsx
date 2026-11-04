import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type PointLike,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Feature as GeoFeature, FeatureCollection, Geometry } from 'geojson'

// Bundling breaks MapLibre's automatic worker lookup, so point to it directly
setWorkerUrl(workerUrl)

// Only shown for a moment, until the locations have loaded
const INITIAL_CENTER: [number, number] = [94.7, 26.93]
const PILOT_AREA = 'pilot-area'
const SETTLEMENTS = 'settlements'
const ALERT_PREVIEW_COUNT = 8
const MAX_RISE_LEVELS = 6
const FLIGHT_DURATION_MS = 2400
const FLOOD_FADE_MS = 900
const FLOOD_OPACITY = 0.4

const KINDS = ['observed', 'forecast', 'simulated'] as const
type Kind = (typeof KINDS)[number]
// Simulated flood areas get their own layer per location, so they can fade across
const SHARED_MAP_KINDS = ['observed', 'forecast'] as const

const KIND_INFO: Record<Kind, { label: string; help: string; color: string }> = {
  observed: { label: 'Observed', help: 'Measured on the ground or by satellite', color: '#1565c0' },
  forecast: { label: 'Forecast', help: 'Model prediction of the future', color: '#b45309' },
  simulated: { label: 'Simulated', help: 'What-if flood scenarios', color: '#7b1fa2' },
}

const TABS = [
  { id: 'scenario', label: 'Scenario Analysis' },
  { id: 'alerts', label: 'Alert Log' },
  { id: 'data', label: 'Data Sources' },
] as const
type TabId = (typeof TABS)[number]['id']

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
  location?: string
  location_name?: string
  rise_m: number
  settlements: string[]
  channel: string
}
type Location = {
  id: string
  name: string
  label: string
  focus: string
  coordinates: [number, number]
  bbox: [number, number, number, number]
}
type LocationData = { layers: Layers; settlements: Layer }

type ReportInfo = { generatedAt: string; mapImage: string | null; layersShown: string[] }

const EMPTY_LAYERS: Layers = { observed: null, forecast: null, simulated: null }

function floodLayerId(locationId: string) {
  return `flood-${locationId}`
}

function formatBbox([west, south, east, north]: Location['bbox']) {
  return `${south.toFixed(2)}–${north.toFixed(2)}° N, ${west.toFixed(2)}–${east.toFixed(2)}° E`
}

// Pulls back slightly before leaving, then overshoots and settles on arrival
function kineticEasing(t: number) {
  const overshoot = 1.68
  const eased = 2 * t
  return t < 0.5
    ? (eased ** 2 * ((overshoot + 1) * eased - overshoot)) / 2
    : ((eased - 2) ** 2 * ((overshoot + 1) * (eased - 2) + overshoot) + 2) / 2
}

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

function formatArea(value: string | number | null) {
  return value === null ? 'No data' : `${Number(value).toLocaleString('en-IN')} km²`
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

function findFocusLevel(settlements: Layer | null, focus: string) {
  const place = settlements?.features.find((feature) => feature.properties.name === focus)
  return place ? (place.properties.first_flooded_at_m as number | null) : undefined
}

// A place missing from the data must never read as safe
function focusStatus(level: number | null | undefined, rise: number) {
  if (level === undefined) return 'Not in mapped data'
  return level !== null && level <= rise ? 'Flooded' : 'Not flooded'
}

function LocationSwitch({
  locations,
  selectedId,
  onSelect,
}: {
  locations: Location[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const style = {
    '--count': locations.length,
    '--index': locations.findIndex((location) => location.id === selectedId),
  } as CSSProperties
  return (
    <div className="location-switch" role="group" aria-label="Location" style={style}>
      <span className="location-indicator" aria-hidden="true" />
      {locations.map((location) => (
        <button
          key={location.id}
          type="button"
          className="location-button"
          aria-pressed={location.id === selectedId}
          onClick={() => onSelect(location.id)}
        >
          {location.name}
        </button>
      ))}
    </div>
  )
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

function Readout({
  kind,
  label,
  value,
  detail,
}: {
  kind: Kind
  label: string
  value: string
  detail?: string
}) {
  const info = KIND_INFO[kind]
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-value">
        <span className="kind-tag" style={{ color: info.color }}>
          {info.label}
        </span>
        <strong>{value}</strong>
        {detail && <span className="field-detail">{detail}</span>}
      </div>
    </div>
  )
}

function RiseMeter({ level }: { level: number }) {
  return (
    <span className="meter" aria-hidden="true">
      {Array.from({ length: MAX_RISE_LEVELS }, (_, index) => (
        <span key={index} className={index < level ? 'filled' : undefined} />
      ))}
    </span>
  )
}

function ScenarioTable({ scenarios, selected }: { scenarios: Feature[]; selected?: Feature }) {
  return (
    <div className="table-wrap">
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
              <td>{formatArea(scenario.properties.flooded_area_km2)}</td>
              <td>{scenario.properties.settlements_affected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function captureMap(map: MapLibreMap): Promise<string | null> {
  return new Promise((resolve) => {
    const capture = () => {
      // The canvas can only be read straight after a repaint
      map.once('render', () => {
        try {
          resolve(map.getCanvas().toDataURL('image/png'))
        } catch {
          resolve(null)
        }
      })
      map.triggerRepaint()
    }
    if (map.isMoving()) map.once('moveend', capture)
    else capture()
  })
}

function SituationReport({
  info,
  location,
  rise,
  scenarios,
  selected,
  settlements,
  layers,
  alert,
  onBack,
}: {
  info: ReportInfo
  location: Location
  rise: number
  scenarios: Feature[]
  selected: Feature
  settlements: Layer | null
  layers: Layers
  alert?: Alert
  onBack: () => void
}) {
  const places = settlements?.features ?? []
  const focusLevel = findFocusLevel(settlements, location.focus)
  const affectedCount = places.filter(
    (place) =>
      place.properties.first_flooded_at_m != null &&
      Number(place.properties.first_flooded_at_m) <= rise,
  ).length
  const levels = scenarios
    .map((scenario) => Number(scenario.properties.rise_m))
    .filter((level) => level <= rise)
  const gauge = layers.observed?.features[0]?.properties
  const rain = layers.forecast?.features[0]?.properties
  const readings: { kind: Kind; measure: string; value: string; properties?: Properties }[] = [
    {
      kind: 'observed',
      measure: `River level near ${location.focus}`,
      value: gauge?.level_m != null ? `${gauge.level_m} m` : 'Pending: no gauge connected yet',
      properties: gauge,
    },
    {
      kind: 'forecast',
      measure: 'Rain, next 24 hours',
      value: rain?.rain_next_24h_mm != null ? `${rain.rain_next_24h_mm} mm` : 'Pending',
      properties: rain,
    },
    {
      kind: 'forecast',
      measure: 'Rain, next 72 hours',
      value: rain?.rain_next_72h_mm != null ? `${rain.rain_next_72h_mm} mm` : 'Pending',
      properties: rain,
    },
    {
      kind: 'simulated',
      measure: `Flooded land at +${rise} m`,
      value: formatArea(selected.properties.flooded_area_km2),
      properties: selected.properties,
    },
  ]

  return (
    <article className="panel report">
      <div className="report-actions">
        <button type="button" className="primary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <button type="button" className="secondary" onClick={onBack}>
          Back to Scenario Analysis
        </button>
      </div>

      <p className="report-banner">
        <strong>Demonstration only.</strong> This is a simulated scenario and not an official
        warning. An officer must check it before any use.
      </p>

      <dl className="details">
        <dt>Location</dt>
        <dd>{location.label}</dd>
        <dt>Bounding box</dt>
        <dd>{formatBbox(location.bbox)}</dd>
        <dt>Scenario</dt>
        <dd>+{rise} m river rise</dd>
        <dt>Generated</dt>
        <dd>{formatTime(info.generatedAt)}</dd>
      </dl>

      <h2 className="section-title">Summary</h2>
      <p className="report-text">
        If rivers stood {rise} m above the water surface in the terrain data, the model estimates
        about {formatArea(selected.properties.flooded_area_km2)} of flooded land in the{' '}
        {location.name} map area, reaching {affectedCount} of {places.length} settlements mapped in
        OpenStreetMap.{' '}
        {focusLevel === undefined
          ? `${location.focus} is not in the mapped settlement data.`
          : `${location.focus} is ${focusStatus(focusLevel, rise).toLowerCase()} in this scenario${
              focusLevel === null ? '' : `; the model floods it from +${focusLevel} m`
            }.`}
      </p>
      <p className="report-text">
        This report gives no evacuation or response advice, because the model has not yet been
        checked against a real flood.
      </p>

      <h2 className="section-title">Map</h2>
      {info.mapImage ? (
        <figure className="report-map">
          <img
            src={info.mapImage}
            alt={`Map of the +${rise} m flood scenario in the ${location.name} area`}
          />
          <figcaption className="note">
            Map view when this report was generated. Layers shown:{' '}
            {info.layersShown.join(', ') || 'none'}. Base map © OpenStreetMap contributors.
          </figcaption>
        </figure>
      ) : (
        <p className="empty">Map image not available</p>
      )}

      <h2 className="section-title">Readings by data type</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Measure</th>
              <th scope="col">Value</th>
              <th scope="col">Time</th>
              <th scope="col">Source</th>
              <th scope="col">Quality</th>
            </tr>
          </thead>
          <tbody>
            {readings.map(({ kind, measure, value, properties }) => (
              <tr key={measure}>
                <td>
                  <span className="kind-tag" style={{ color: KIND_INFO[kind].color }}>
                    {KIND_INFO[kind].label}
                  </span>
                </td>
                <td>{measure}</td>
                <td>
                  <strong>{value}</strong>
                </td>
                <td>{properties ? formatTime(properties.timestamp) : 'Not available'}</td>
                <td>{properties?.source ?? 'Not available'}</td>
                <td>{properties?.quality ?? 'Not available'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Settlements by first flood level</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">First floods at</th>
              <th scope="col">Count</th>
              <th scope="col">Settlements</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((level) => {
              const names = places
                .filter((place) => place.properties.first_flooded_at_m === level)
                .map((place) => String(place.properties.name))
                .sort()
              return (
                <tr key={level}>
                  <td>+{level} m</td>
                  <td>{names.length}</td>
                  <td>{names.join(', ') || 'None'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        Counts only cover places mapped in OpenStreetMap, so the real number will be higher.
      </p>

      <h2 className="section-title">All scenarios</h2>
      <ScenarioTable scenarios={scenarios} selected={selected} />

      <h2 className="section-title">Alert status</h2>
      <p className="report-text">
        {alert
          ? `Demo alert logged ${formatTime(alert.created_at)} for ${alert.settlements.length} settlements. ${alert.channel}.`
          : 'No demo alert has been logged for this scenario.'}
      </p>
    </article>
  )
}

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const markerRef = useRef<Marker | null>(null)
  const cameraLocationRef = useRef<string | null>(null)
  const popupRef = useRef<Popup | null>(null)
  const [tab, setTab] = useState<TabId | 'report'>('scenario')
  const [reportInfo, setReportInfo] = useState<ReportInfo | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState<string | null>(null)
  const locationIdRef = useRef<string | null>(null)
  const [allData, setAllData] = useState<Record<string, LocationData> | null>(null)
  const layersRef = useRef<Layers>(EMPTY_LAYERS)
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
  const location = locations.find((item) => item.id === locationId)
  const locationData = locationId ? allData?.[locationId] : undefined
  const layers = locationData?.layers ?? EMPTY_LAYERS
  const settlements = locationData?.settlements ?? null
  const focusName = location?.focus ?? 'Location'

  useEffect(() => {
    if (!mapContainer.current) return
    const map = new MapLibreMap({
      container: mapContainer.current,
      center: INITIAL_CENTER,
      zoom: 9,
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

    // 'load' waits for every base map tile, and flood data must not depend on a slow tile server
    map.once('style.load', () => {
      const empty: Layer = { type: 'FeatureCollection', features: [] }
      for (const kind of SHARED_MAP_KINDS) {
        const { color } = KIND_INFO[kind]
        map.addSource(kind, { type: 'geojson', data: empty })
        map.addLayer({
          id: `${kind}-area`,
          type: 'fill',
          source: kind,
          filter: POLYGON_FILTER,
          paint: { 'fill-color': color, 'fill-opacity': FLOOD_OPACITY },
        })
      }
      map.addSource(PILOT_AREA, { type: 'geojson', data: empty })
      map.addLayer({
        id: PILOT_AREA,
        type: 'line',
        source: PILOT_AREA,
        paint: { 'line-color': '#b45309', 'line-width': 2, 'line-dasharray': [3, 2] },
      })
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
      for (const kind of SHARED_MAP_KINDS) {
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
      }

      // Only the topmost feature responds, and hidden flood layers never do
      const featureAt = (point: PointLike) => {
        const layers = [
          ...SHARED_MAP_KINDS.map((kind) => `${kind}-point`),
          SETTLEMENTS,
          floodLayerId(locationIdRef.current ?? ''),
        ].filter((id) => map.getLayer(id))
        return map.queryRenderedFeatures(point, { layers })[0]
      }
      map.on('click', (event) => {
        const clicked = featureAt(event.point)?.properties as Properties | undefined
        if (!clicked) return
        // MapLibre drops null values from clicked features, so use the original data
        const original = KINDS.flatMap((kind) => layersRef.current[kind]?.features ?? []).find(
          (feature) => feature.properties.name === clicked.name,
        )
        popupRef.current?.remove()
        popupRef.current = new Popup()
          .setLngLat(event.lngLat)
          .setDOMContent(popupContent(original?.properties ?? clicked))
          .addTo(map)
      })
      map.on('mousemove', (event) => {
        map.getCanvas().style.cursor = featureAt(event.point) ? 'pointer' : ''
      })
      setMapReady(true)
    })
    mapRef.current = map
    return () => {
      setMapReady(false)
      map.remove()
      mapRef.current = null
      markerRef.current = null
      cameraLocationRef.current = null
    }
  }, [])

  // The map has no size while its tab is hidden, so measure again on return
  useEffect(() => {
    if (tab === 'scenario') mapRef.current?.resize()
  }, [tab])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const messageFor = (reason: unknown) =>
      reason instanceof Error ? reason.message : String(reason)
    const getJson = async <T,>(url: string) => {
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`${url} failed with status ${response.status}`)
      return (await response.json()) as T
    }
    const getLocationData = async (id: string): Promise<LocationData> => {
      const [layerResults, settlementLayer] = await Promise.all([
        Promise.all(
          KINDS.map(
            async (kind) =>
              [kind, await getJson<Layer>(`/api/locations/${id}/layers/${kind}`)] as const,
          ),
        ),
        getJson<Layer>(`/api/locations/${id}/settlements`),
      ])
      return { layers: Object.fromEntries(layerResults) as Layers, settlements: settlementLayer }
    }
    // Load every location up front, so switching never waits on the network
    getJson<Location[]>('/api/locations')
      .then(async (locationList) => {
        const entries = await Promise.all(
          locationList.map(async (item) => [item.id, await getLocationData(item.id)] as const),
        )
        setLocations(locationList)
        setAllData(Object.fromEntries(entries))
        setLocationId(locationList[0]?.id ?? null)
      })
      .catch((reason: unknown) => {
        if (!signal.aborted) setError(messageFor(reason))
      })
    // The alert log is loaded separately, so a problem with it leaves the flood map working
    getJson<Alert[]>('/api/alerts')
      .then(setAlerts)
      .catch((reason: unknown) => {
        if (!signal.aborted) setAlertError(`Could not load the alert log: ${messageFor(reason)}`)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !allData) return
    for (const { id } of locations) {
      const layerId = floodLayerId(id)
      if (map.getSource(layerId)) continue
      const flood = allData[id]?.layers.simulated
      if (!flood) continue
      map.addSource(layerId, { type: 'geojson', data: flood })
      map.addLayer(
        {
          id: layerId,
          type: 'fill',
          source: layerId,
          paint: {
            'fill-color': KIND_INFO.simulated.color,
            'fill-opacity': 0,
            'fill-opacity-transition': { duration: FLOOD_FADE_MS, delay: 0 },
          },
        },
        PILOT_AREA,
      )
    }
  }, [locations, allData, mapReady])

  // Runs only when the location changes, so moving the slider never re-sends map data
  useEffect(() => {
    locationIdRef.current = locationId
    layersRef.current = layers
    const map = mapRef.current
    if (!map || !mapReady || !location) return
    for (const kind of SHARED_MAP_KINDS) {
      const layer = layers[kind]
      if (layer) (map.getSource(kind) as GeoJSONSource).setData(layer)
    }
    if (settlements) (map.getSource(SETTLEMENTS) as GeoJSONSource).setData(settlements)
    const [west, south, east, north] = location.bbox
    ;(map.getSource(PILOT_AREA) as GeoJSONSource).setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      },
    })
  }, [location, locationId, layers, settlements, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    // An open popup would describe a scenario that is no longer on the map
    popupRef.current?.remove()
    for (const kind of SHARED_MAP_KINDS) {
      const visibility = visible[kind] ? 'visible' : 'none'
      map.setLayoutProperty(`${kind}-area`, 'visibility', visibility)
      map.setLayoutProperty(`${kind}-point`, 'visibility', visibility)
    }
    const simulatedVisibility = visible.simulated ? 'visible' : 'none'
    for (const { id } of locations) {
      const layerId = floodLayerId(id)
      if (!map.getLayer(layerId)) continue
      map.setLayoutProperty(layerId, 'visibility', simulatedVisibility)
      map.setFilter(layerId, ['all', POLYGON_FILTER, ['==', ['get', 'rise_m'], rise]])
      map.setPaintProperty(layerId, 'fill-opacity', id === locationId ? FLOOD_OPACITY : 0)
    }
    map.setLayoutProperty(SETTLEMENTS, 'visibility', simulatedVisibility)
    // A null level means the model never floods the place, and to-number would turn it into 0
    map.setFilter(SETTLEMENTS, [
      'case',
      ['==', ['typeof', ['get', 'first_flooded_at_m']], 'number'],
      ['<=', ['to-number', ['get', 'first_flooded_at_m']], rise],
      false,
    ])
  }, [locations, locationId, visible, rise, mapReady, allData])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !location) return
    markerRef.current ??= new Marker({ color: '#16284a' })
      .setLngLat(location.coordinates)
      .addTo(map)
    markerRef.current
      .setLngLat(location.coordinates)
      .setPopup(new Popup().setText(`${location.focus} location`))
    // A hidden map has no size to fit, so it moves when its tab comes back
    if (cameraLocationRef.current === location.id || tab !== 'scenario') return
    const [west, south, east, north] = location.bbox
    const camera = map.cameraForBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 24 },
    )
    if (!camera) return
    if (cameraLocationRef.current === null) {
      map.jumpTo(camera)
    } else {
      // MapLibre turns this into an instant jump for people who ask for reduced motion
      map.flyTo({
        ...camera,
        curve: 1.6,
        duration: FLIGHT_DURATION_MS,
        easing: kineticEasing,
      })
    }
    cameraLocationRef.current = location.id
  }, [location, mapReady, tab])

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
  const pilotLevel = findFocusLevel(settlements, focusName)
  const gauge = layers.observed?.features[0]?.properties
  const rain = layers.forecast?.features[0]?.properties
  const pilotStatus = settlements ? focusStatus(pilotLevel, rise) : 'No data'
  const pilotDetail = pilotLevel != null ? `Model floods it from +${pilotLevel} m` : undefined
  const latestAlert = alerts[0]
  const loading = !allData && !error

  const generateReport = async () => {
    const map = mapRef.current
    const mapImage = map ? await captureMap(map) : null
    setReportInfo({
      generatedAt: new Date().toISOString(),
      mapImage,
      layersShown: KINDS.filter((kind) => visible[kind]).map((kind) => KIND_INFO[kind].label),
    })
    setTab('report')
  }

  const logAlert = async () => {
    setSendingAlert(true)
    setAlertError(null)
    try {
      const response = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: locationId, rise_m: rise }),
      })
      if (!response.ok) throw new Error(`Status ${response.status}`)
      const alert = (await response.json()) as Alert
      setAlerts((current) => [alert, ...current])
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setAlertError(`Could not log the alert: ${message}`)
    } finally {
      setSendingAlert(false)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">NodiBondhu</span>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="tab"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="badge">Prototype</span>
        {location && (
          <span className="context">
            {location.name} · +{rise} m simulated scenario
          </span>
        )}
        {riseValues.length > 0 && tab !== 'report' && (
          <div className="topbar-actions">
            <select
              className="topbar-select"
              aria-label="Flood scenario"
              value={rise}
              onChange={(event) => setRise(Number(event.target.value))}
            >
              {riseValues.map((value) => (
                <option key={value} value={value}>
                  River rise +{value} m
                </option>
              ))}
            </select>
            {tab === 'scenario' && (
              <button
                type="button"
                className="topbar-button"
                onClick={generateReport}
                disabled={!mapReady}
              >
                {mapReady ? 'Generate Situation Report' : 'Loading map...'}
              </button>
            )}
          </div>
        )}
      </header>

      <main className="content">
        <h1>{TABS.find(({ id }) => id === tab)?.label ?? 'Flood Situation Report'}</h1>
        <p className="subtitle">
          {location && `${location.label}. `}Prototype, not for operational use.
        </p>
        {error && (
          <p className="error" role="alert">
            Could not load data: {error}
          </p>
        )}
        {tab !== 'report' && locations.length > 0 && (
          <LocationSwitch locations={locations} selectedId={locationId} onSelect={setLocationId} />
        )}

        <div hidden={tab !== 'scenario'}>
          <h2 className="section-title">Select flood scenario</h2>
          {scenarios.length > 0 ? (
            <div className="scenario-cards">
              {scenarios.map((scenario) => {
                const level = Number(scenario.properties.rise_m)
                return (
                  <button
                    key={`${locationId}-${level}`}
                    type="button"
                    className="scenario-card"
                    style={{ '--order': level } as CSSProperties}
                    aria-pressed={level === rise}
                    onClick={() => setRise(level)}
                  >
                    <RiseMeter level={level} />
                    <span className="scenario-name">+{level} m river rise</span>
                    <span>{formatArea(scenario.properties.flooded_area_km2)} flooded</span>
                    <span>{scenario.properties.settlements_affected} mapped settlements</span>
                    <span>
                      {focusName} {focusStatus(pilotLevel, level).toLowerCase()}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="empty">{loading ? 'Loading flood data...' : 'No scenarios yet'}</p>
          )}

          <div className="columns">
            <section className="panel">
              <h2 className="section-title">Scenario parameters</h2>

              <span className="field-label">Layers shown on map</span>
              <div className="segments">
                {KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="segment"
                    aria-pressed={visible[kind]}
                    onClick={() => setVisible({ ...visible, [kind]: !visible[kind] })}
                  >
                    <span className="swatch" style={{ backgroundColor: KIND_INFO[kind].color }} />
                    {KIND_INFO[kind].label}
                  </button>
                ))}
              </div>

              <div className="fields" key={locationId}>
                <Readout
                  kind="simulated"
                  label={`${focusName} at +${rise} m`}
                  value={pilotStatus}
                  detail={pilotDetail}
                />
                <Readout
                  kind="simulated"
                  label={`Flooded land at +${rise} m`}
                  value={selected ? formatArea(selected.properties.flooded_area_km2) : 'No data'}
                />
                <Readout
                  kind="observed"
                  label={`River level near ${focusName}`}
                  value={gauge?.level_m != null ? `${gauge.level_m} m` : 'Pending'}
                />
                <Readout
                  kind="forecast"
                  label="Rain, next 24 hours"
                  value={rain?.rain_next_24h_mm != null ? `${rain.rain_next_24h_mm} mm` : 'Pending'}
                />
              </div>

              {riseValues.length > 0 && (
                <>
                  <label className="field-label" htmlFor="rise">
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
                </>
              )}

              <span className="field-label">Alert for this scenario</span>
              {affected.length > 0 ? (
                <>
                  <p className="alert-preview">
                    <strong>Simulated scenario, +{rise} m:</strong>{' '}
                    {affected.slice(0, ALERT_PREVIEW_COUNT).join(', ')}
                    {affected.length > ALERT_PREVIEW_COUNT &&
                      ` and ${affected.length - ALERT_PREVIEW_COUNT} more`}{' '}
                    may be affected. An officer must check this before any warning goes out.
                  </p>
                  <button type="button" className="primary" onClick={logAlert} disabled={sendingAlert}>
                    {sendingAlert ? 'Logging...' : 'Approve and log demo alert'}
                  </button>
                  <p className="note">Demo only: this is logged here and not sent to anyone.</p>
                </>
              ) : (
                <p className="empty">No settlements affected in this scenario</p>
              )}
              {alertError && (
                <p className="error" role="alert">
                  {alertError}
                </p>
              )}
              {latestAlert && (
                <p className="note">
                  Last logged {formatTime(latestAlert.created_at)}:{' '}
                  {latestAlert.location_name ?? 'Location not recorded'}, +{latestAlert.rise_m} m,{' '}
                  {latestAlert.settlements.length} settlements.{' '}
                  <button type="button" className="link" onClick={() => setTab('alerts')}>
                    View alert log
                  </button>
                </p>
              )}
            </section>

            <section className="panel map-panel">
              <h2 className="section-title">Selected scenario</h2>
              <div className="map" ref={mapContainer} role="region" aria-label="Flood map" />

              <h3 className="selected-name">
                +{rise} m river rise{location && `, ${location.name} map area`}
              </h3>
              <dl className="details">
                <dt>Bounding box</dt>
                <dd>{location ? formatBbox(location.bbox) : 'No data'}</dd>
                <dt>Flooded land</dt>
                <dd>{selected ? formatArea(selected.properties.flooded_area_km2) : 'No data'}</dd>
                <dt>{focusName}</dt>
                <dd>
                  {pilotStatus}
                  {pilotDetail && `. ${pilotDetail}`}
                </dd>
                <dt>Settlements</dt>
                <dd>
                  {settlements
                    ? `${affected.length} of ${settlements.features.length} mapped: ${
                        affected.join(', ') || 'none'
                      }`
                    : 'No data'}
                </dd>
                <dt>Model run</dt>
                <dd>{selected ? formatTime(selected.properties.timestamp) : 'No data'}</dd>
                <dt>Quality</dt>
                <dd>{selected?.properties.quality ?? 'No data'}</dd>
              </dl>

              <h2 className="section-title">Scenario comparison</h2>
              <ScenarioTable scenarios={scenarios} selected={selected} />
              <p className="note">
                Counts only cover places mapped in OpenStreetMap, so the real number will be higher.
              </p>
            </section>
          </div>
        </div>

        <div hidden={tab !== 'alerts'}>
          <section className="panel">
            <h2 className="section-title">Logged demo alerts</h2>
            {alerts.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Location</th>
                      <th scope="col">Scenario</th>
                      <th scope="col">Settlements</th>
                      <th scope="col">Channel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((alert) => (
                      <tr key={alert.id}>
                        <td>{formatTime(alert.created_at)}</td>
                        <td>{alert.location_name ?? 'Not recorded'}</td>
                        <td>+{alert.rise_m} m</td>
                        <td>
                          {alert.settlements.length}: {alert.settlements.join(', ')}
                        </td>
                        <td>{alert.channel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">
                {alertError ?? 'No alerts logged yet. Approve one under Scenario Analysis.'}
              </p>
            )}
          </section>
        </div>

        <div hidden={tab !== 'data'}>
          {KINDS.map((kind) => {
            const info = KIND_INFO[kind]
            const features =
              kind === 'simulated' ? (selected ? [selected] : []) : (layers[kind]?.features ?? [])
            return (
              <section key={kind} className="panel data-panel">
                <h2 className="section-title">
                  <span className="swatch" style={{ backgroundColor: info.color }} />
                  {info.label}
                </h2>
                <p className="note">{info.help}</p>
                {features.length === 0 && !error && <p className="empty">No data yet</p>}
                {features.map((feature, index) => (
                  <FeatureCard key={index} feature={feature} kind={kind} />
                ))}
              </section>
            )
          })}
        </div>

        {tab === 'report' && reportInfo && selected && location && (
          <SituationReport
            info={reportInfo}
            location={location}
            rise={rise}
            scenarios={scenarios}
            selected={selected}
            settlements={settlements}
            layers={layers}
            alert={alerts.find((alert) => alert.location === locationId && alert.rise_m === rise)}
            onBack={() => setTab('scenario')}
          />
        )}
      </main>
    </div>
  )
}
