import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
const BHUVAN_ATTRIBUTION = 'Imagery: Bhuvan, NRSC/ISRO'
// Free font files for map labels. If they cannot load, the map still works without names
const GLYPHS_URL = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf'
const LABEL_FONT = ['Open Sans Regular']
const LABEL_FONT_BOLD = ['Open Sans Bold']
const LABEL_TEXT = '#ffffff'
const LABEL_HALO = 'rgba(10, 20, 40, 0.9)'
const PLACE_LABELS_MAJOR = 'place-labels-major'
const PLACE_LABELS_MINOR = 'place-labels-minor'
const VILLAGE_LABELS = 'village-labels'
const MINOR_LABEL_MIN_ZOOM = 10.5
const VILLAGE_LABEL_MIN_ZOOM = 12
const INDIA_BOUNDS: [number, number, number, number] = [68, 6, 98, 38]
// Only some Bhuvan layers match the web map's projection. bhuvan_marc is the clearest
// when zoomed out but stops at zoom 11, and bhuvan_wbase_v3 is sharp from zoom 12
const SATELLITE_WIDE_MAX_ZOOM = 11
const SATELLITE_DETAIL_MIN_ZOOM = 12
const SATELLITE_DETAIL_MAX_ZOOM = 15
const PILOT_AREA = 'pilot-area'
const SETTLEMENTS = 'settlements'
const ROUTES = 'routes'
const ROUTES_CASING = 'routes-casing'
const ROUTES_FLOODED = 'routes-flooded'
const ROUTE_ENDS = 'route-ends'
const VILLAGES = 'villages'
const CENSUS_DOT_COLOR = '#29b6f6'
const CENSUS_SECTION_ID = 'census-data'
const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.2
const ZOOM_LEVELS = Array.from({ length: 16 }, (_, index) => Number((1 + index * ZOOM_STEP).toFixed(1)))
const ZOOM_DURATION_MS = 500
const ROUTE_LINE_FILTER: ExpressionSpecification = ['==', ['get', 'segment'], 'route']
const ALERT_PREVIEW_COUNT = 8
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

const STANDARD_FIELDS = new Set([
  'kind',
  'name',
  'source',
  'timestamp',
  'quality',
  'points_checked',
  'village_key',
])
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
type LandUse = {
  source?: string
  quality?: string
  land_use_year?: string
  squares_checked?: number
  squares_without_data?: number
  scenarios?: {
    rise_m: number
    flooded_area_km2: number
    land_types: { name: string; flooded_km2: number; share: number }[]
  }[]
}
type LocationData = {
  layers: Layers
  settlements: Layer
  villages: Layer
  landUse: LandUse
  routes: Layer
}

type ReportInfo = { generatedAt: string; mapImage: string | null; layersShown: string[] }

const EMPTY_LAYERS: Layers = { observed: null, forecast: null, simulated: null }

function bhuvanTiles(layer: string) {
  return (
    'https://bhuvan-ras1.nrsc.gov.in/tilecache/tilecache.py?service=WMS&version=1.1.1' +
    `&request=GetMap&layers=${layer}&styles=&srs=EPSG:3857&bbox={bbox-epsg-3857}` +
    '&width=256&height=256&format=image/jpeg'
  )
}

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

function summariseVillages(villages: Layer | null, rise: number) {
  const reached = (villages?.features ?? [])
    .filter((village) => {
      const level = village.properties.first_flooded_at_m
      return typeof level === 'number' && level <= rise
    })
    .sort(
      (a, b) =>
        Number(a.properties.first_flooded_at_m) - Number(b.properties.first_flooded_at_m) ||
        Number(b.properties.population_2001 ?? -1) - Number(a.properties.population_2001 ?? -1),
    )
  const known = reached.filter((village) => village.properties.population_2001 !== null)
  return {
    reached,
    people: known.reduce((total, village) => total + Number(village.properties.population_2001), 0),
    missingCounts: reached.length - known.length,
  }
}

function formatCount(value: string | number | null) {
  return value === null ? 'No data' : Number(value).toLocaleString('en-IN')
}

function CensusVillages({
  villages,
  rise,
  printable = false,
}: {
  villages: Layer | null
  rise: number
  printable?: boolean
}) {
  const quality = villages?.features[0]?.properties.quality
  const source = villages?.features[0]?.properties.source
  if (!villages?.features.length) {
    return <p className="empty">Census village data is not available for this location yet.</p>
  }
  const { reached, people, missingCounts } = summariseVillages(villages, rise)
  return (
    <>
      <p className="report-text">
        <strong>
          {reached.length} of {villages.features.length} mapped villages have flooded land at +
          {rise} m.
        </strong>{' '}
        {formatCount(people)} people lived in the {reached.length - missingCounts} with a census
        figure in 2001
        {missingCounts > 0 &&
          `. The other ${missingCounts} have no reliable figure, so the real total is higher`}
        . This is the whole village population, not the number of people flooded.
      </p>
      {reached.length > 0 && (
        <div className={printable ? 'table-wrap' : 'table-wrap village-table'}>
          <table>
            <thead>
              <tr>
                <th scope="col">Village</th>
                <th scope="col">Tehsil</th>
                <th scope="col">First flooded land at</th>
                <th scope="col">Population, 2001</th>
                <th scope="col">Households, 2001</th>
              </tr>
            </thead>
            <tbody>
              {reached.map((village) => (
                <tr key={`${village.properties.name}-${JSON.stringify(village.geometry)}`}>
                  <td>{village.properties.name}</td>
                  <td>{village.properties.taluk ?? 'Not known'}</td>
                  <td>+{village.properties.first_flooded_at_m} m</td>
                  <td>{formatCount(village.properties.population_2001)}</td>
                  <td>{formatCount(village.properties.households_2001)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        On the map, small blue dots are villages with flooded land and a census figure. Villages with
        no reliable figure are listed here but not drawn. {quality}. Source: {source}.
      </p>
    </>
  )
}

function FloodedLandUse({ landUse, rise }: { landUse: LandUse | null; rise: number }) {
  const scenario = landUse?.scenarios?.find((item) => item.rise_m === rise)
  if (!scenario) {
    return <p className="empty">Land use estimates are not available for this location yet.</p>
  }
  const missing = landUse?.squares_without_data ?? 0
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Land type</th>
              <th scope="col">Estimated flooded area</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {scenario.land_types.map((item) => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td>about {Math.round(item.flooded_km2).toLocaleString('en-IN')} km²</td>
                <td>{Math.round(item.share * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        {landUse?.quality}.{' '}
        {missing > 0 && `${missing} of ${landUse?.squares_checked} squares had no land use data. `}
        Source: {landUse?.source}.
      </p>
    </>
  )
}

function RoadCheck({ routes, rise }: { routes: Layer | null; rise: number }) {
  const list = (routes?.features ?? []).filter((route) => route.properties.segment === 'route')
  if (list.length === 0) {
    return <p className="empty">Road routes are not available for this location yet.</p>
  }
  const floodedKm = (route: Feature) => Number(route.properties[`flooded_km_${rise}`] ?? 0)
  const partlyMapped = list.some(
    (route) => Number(route.properties.mapped_km) < Number(route.properties.length_km),
  )
  return (
    <>
      <p className="report-text">
        <strong>
          {list.filter((route) => floodedKm(route) > 0).length} of {list.length} main routes pass
          through the flood area at +{rise} m.
        </strong>{' '}
        On the map, routes are white with a dot at each end, and the stretches in the flood area are
        red. Routes were only
        checked where the flood map covers them, so white outside that area does not mean dry.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Route</th>
              <th scope="col">Length</th>
              <th scope="col">Flood map covers</th>
              <th scope="col">In flood area at +{rise} m</th>
            </tr>
          </thead>
          <tbody>
            {list.map((route) => (
              <tr key={String(route.properties.name)}>
                <td>{route.properties.name}</td>
                <td>about {route.properties.length_km} km</td>
                <td>{route.properties.mapped_km} km</td>
                <td>about {floodedKm(route)} km</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        {partlyMapped &&
          'Where the flood map covers only part of a route, the rest was not checked, so the real distance could be higher. '}
        {list[0].properties.quality}. Source: {list[0].properties.source}.
      </p>
    </>
  )
}

function CensusData({
  villages,
  regionName,
  onBack,
}: {
  villages: Layer | null
  regionName: string
  onBack: () => void
}) {
  const withFigure = (villages?.features ?? [])
    .filter((village) => village.properties.population_2001 !== null)
    .sort((a, b) => String(a.properties.name).localeCompare(String(b.properties.name)))
  const people = withFigure.reduce(
    (total, village) => total + Number(village.properties.population_2001),
    0,
  )
  const first = withFigure[0]?.properties
  return (
    <section id={CENSUS_SECTION_ID} className="panel data-panel">
      <h2 className="section-title">
        <span className="swatch" style={{ backgroundColor: CENSUS_DOT_COLOR }} />
        Census villages
      </h2>
      {withFigure.length === 0 ? (
        <p className="empty">Census village data is not available for {regionName} yet.</p>
      ) : (
        <>
          <p className="note">
            {withFigure.length} villages in the {regionName} area have a census figure, with{' '}
            {formatCount(people)} people in 2001. These are whole village populations, not people
            flooded, and villages with no reliable figure are left out.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Village</th>
                  <th scope="col">Tehsil</th>
                  <th scope="col">Population</th>
                  <th scope="col">Households</th>
                  <th scope="col">Male</th>
                  <th scope="col">Female</th>
                  <th scope="col">Scheduled caste</th>
                  <th scope="col">Scheduled tribe</th>
                  <th scope="col">Literate</th>
                  <th scope="col">First flooded land at</th>
                </tr>
              </thead>
              <tbody>
                {withFigure.map((village) => {
                  const level = village.properties.first_flooded_at_m
                  return (
                    <tr key={String(village.properties.village_key)}>
                      <td>{village.properties.name}</td>
                      <td>{village.properties.taluk ?? 'Not known'}</td>
                      <td>{formatCount(village.properties.population_2001)}</td>
                      <td>{formatCount(village.properties.households_2001)}</td>
                      <td>{formatCount(village.properties.male_2001)}</td>
                      <td>{formatCount(village.properties.female_2001)}</td>
                      <td>{formatCount(village.properties.scheduled_caste_2001)}</td>
                      <td>{formatCount(village.properties.scheduled_tribe_2001)}</td>
                      <td>{formatCount(village.properties.literate_2001)}</td>
                      <td>{typeof level === 'number' ? `+${level} m` : 'Not reached'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="note">
            {first?.quality}. Source: {first?.source}.{' '}
            <button type="button" className="link" onClick={onBack}>
              Back to the map
            </button>
          </p>
        </>
      )}
    </section>
  )
}

function MapLegend({
  kinds,
  rise,
  focus,
  villages,
  routes,
  hasGauge,
  onVillageClick,
}: {
  kinds: Kind[]
  rise: number
  focus: string
  villages: Layer | null
  routes: Layer | null
  hasGauge: boolean
  onVillageClick?: () => void
}) {
  const showSimulated = kinds.includes('simulated')
  const dot = (color: string, size = 8, stroke = '#ffffff') => (
    <span className="legend-dot" style={{ background: color, width: size, height: size, borderColor: stroke }} />
  )
  const line = (color: string) => <span className="legend-line" style={{ background: color }} />
  const items: {
    key: string
    symbol: ReactNode
    label: string
    detail: string
    show: boolean
    onClick?: () => void
  }[] = [
    {
      key: 'pin',
      symbol: <span className="legend-pin" />,
      label: focus,
      detail: `${focus} location`,
      show: true,
    },
    {
      key: 'area',
      symbol: <span className="legend-box" />,
      label: 'Study area',
      detail: 'Area covered by these results',
      show: true,
    },
    {
      key: 'flood',
      symbol: <span className="legend-fill" style={{ background: KIND_INFO.simulated.color }} />,
      label: `Flood, +${rise} m`,
      detail: `Flood area at +${rise} m`,
      show: showSimulated,
    },
    {
      key: 'settlement',
      symbol: dot(KIND_INFO.simulated.color, 9),
      label: 'Flooded settlement',
      detail: 'Mapped settlement reached by flood',
      show: showSimulated,
    },
    {
      key: 'village',
      symbol: dot(CENSUS_DOT_COLOR, 7, '#16284a'),
      label: 'Village, census figure',
      detail: onVillageClick
        ? 'Village with flooded land and a census figure. Select to see the census data'
        : 'Village with flooded land and a census figure',
      show:
        showSimulated &&
        (villages?.features ?? []).some((village) => village.properties.population_2001 !== null),
      onClick: onVillageClick,
    },
    {
      key: 'route',
      symbol: line('#ffffff'),
      label: 'Road route',
      detail: 'Main road route',
      show: showSimulated && Boolean(routes?.features.length),
    },
    {
      key: 'route-flooded',
      symbol: line('#e53935'),
      label: 'Flooded road',
      detail: 'Road stretch in flood area',
      show: showSimulated && Boolean(routes?.features.length),
    },
    {
      key: 'route-end',
      symbol: dot('#ffffff', 8, '#16284a'),
      label: 'Route end',
      detail: 'End of a road route',
      show: showSimulated && Boolean(routes?.features.length),
    },
    {
      key: 'rain',
      symbol: dot(KIND_INFO.forecast.color, 10),
      label: 'Rain forecast',
      detail: 'Rain forecast point',
      show: kinds.includes('forecast'),
    },
    {
      key: 'gauge',
      symbol: dot(KIND_INFO.observed.color, 10),
      label: 'River gauge',
      detail: 'River gauge reading',
      show: kinds.includes('observed') && hasGauge,
    },
  ]
  return (
    <ul className="legend" aria-label="Map legend">
      {items
        .filter((item) => item.show)
        .map((item) => (
          <li key={item.key} title={item.detail}>
            {item.onClick ? (
              <button type="button" className="legend-link" onClick={item.onClick}>
                <span className="legend-swatch" aria-hidden="true">
                  {item.symbol}
                </span>
                {item.label}
              </button>
            ) : (
              <>
                <span className="legend-swatch" aria-hidden="true">
                  {item.symbol}
                </span>
                {item.label}
              </>
            )}
          </li>
        ))}
    </ul>
  )
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
    <div className="location-switch" role="group" aria-label="Study region" style={style}>
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
  wide = false,
}: {
  kind: Kind
  label: string
  value: string
  detail?: string
  wide?: boolean
}) {
  const info = KIND_INFO[kind]
  return (
    <div className={wide ? 'field field-wide' : 'field'}>
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
  villages,
  landUse,
  routes,
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
  villages: Layer | null
  landUse: LandUse | null
  routes: Layer | null
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
          <MapLegend
            kinds={KINDS.filter((kind) => info.layersShown.includes(KIND_INFO[kind].label))}
            rise={rise}
            focus={location.focus}
            villages={villages}
            routes={routes}
            hasGauge={Boolean(layers.observed?.features.length)}
          />
          <figcaption className="note">
            Map view when this report was generated. Layers shown:{' '}
            {info.layersShown.join(', ') || 'none'}. {BHUVAN_ATTRIBUTION}. Map data ©
            OpenStreetMap contributors.
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

      <h2 className="section-title">Census villages with flooded land</h2>
      <CensusVillages villages={villages} rise={rise} printable />

      <h2 className="section-title">Land use in the flood area</h2>
      <FloodedLandUse landUse={landUse} rise={rise} />

      <h2 className="section-title">Roads in the flood area</h2>
      <RoadCheck routes={routes} rise={rise} />

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
  const scrollToCensusRef = useRef(false)
  const [tab, setTab] = useState<TabId | 'report'>('scenario')
  const [reportInfo, setReportInfo] = useState<ReportInfo | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState<string | null>(null)
  const locationIdRef = useRef<string | null>(null)
  const [allData, setAllData] = useState<Record<string, LocationData> | null>(null)
  const layersRef = useRef<Layers>(EMPTY_LAYERS)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [rise, setRise] = useState(2)
  const [zoom, setZoom] = useState(1)
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
  const villages = locationData?.villages ?? null
  const landUse = locationData?.landUse ?? null
  const routes = locationData?.routes ?? null
  const villageSummary = summariseVillages(villages, rise)
  const focusName = location?.focus ?? 'Location'

  useEffect(() => {
    if (!mapContainer.current) return
    const map = new MapLibreMap({
      container: mapContainer.current,
      center: INITIAL_CENTER,
      zoom: 9,
      style: {
        version: 8,
        glyphs: GLYPHS_URL,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
          'satellite-wide': {
            type: 'raster',
            tiles: [bhuvanTiles('bhuvan_marc')],
            tileSize: 256,
            maxzoom: SATELLITE_WIDE_MAX_ZOOM,
            bounds: INDIA_BOUNDS,
            attribution: BHUVAN_ATTRIBUTION,
          },
          'satellite-detail': {
            type: 'raster',
            tiles: [bhuvanTiles('bhuvan_wbase_v3')],
            tileSize: 256,
            minzoom: SATELLITE_DETAIL_MIN_ZOOM,
            maxzoom: SATELLITE_DETAIL_MAX_ZOOM,
            bounds: INDIA_BOUNDS,
          },
        },
        // OpenStreetMap stays underneath, so the map still shows if Bhuvan is slow or down
        layers: [
          { id: 'osm', type: 'raster', source: 'osm' },
          {
            id: 'satellite-wide',
            type: 'raster',
            source: 'satellite-wide',
            maxzoom: SATELLITE_DETAIL_MIN_ZOOM,
          },
          {
            id: 'satellite-detail',
            type: 'raster',
            source: 'satellite-detail',
            minzoom: SATELLITE_DETAIL_MIN_ZOOM,
          },
        ],
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
        paint: { 'line-color': '#ffd54a', 'line-width': 2, 'line-dasharray': [3, 2] },
      })
      map.addSource(ROUTES, { type: 'geojson', data: empty })
      map.addLayer({
        id: ROUTES_CASING,
        type: 'line',
        source: ROUTES,
        filter: ROUTE_LINE_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#16284a', 'line-width': 4.5 },
      })
      map.addLayer({
        id: ROUTES,
        type: 'line',
        source: ROUTES,
        filter: ROUTE_LINE_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 2.5 },
      })
      map.addLayer({
        id: ROUTES_FLOODED,
        type: 'line',
        source: ROUTES,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#e53935', 'line-width': 3 },
      })
      map.addLayer({
        id: ROUTE_ENDS,
        type: 'circle',
        source: ROUTES,
        filter: ['==', ['get', 'segment'], 'end'],
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': 5,
          'circle-stroke-color': '#16284a',
          'circle-stroke-width': 2,
        },
      })
      map.addSource(VILLAGES, { type: 'geojson', data: empty })
      map.addLayer({
        id: VILLAGES,
        type: 'circle',
        source: VILLAGES,
        paint: {
          'circle-color': CENSUS_DOT_COLOR,
          'circle-radius': 3.5,
          'circle-stroke-color': '#16284a',
          'circle-stroke-width': 1,
        },
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
      // Place names are drawn from OpenStreetMap, like the default map. They sit above the flood
      // area and roads but below the dots, and the map hides names that would overlap
      const labelPaint = {
        'text-color': LABEL_TEXT,
        'text-halo-color': LABEL_HALO,
        'text-halo-width': 1.6,
      }
      map.addLayer(
        {
          id: PLACE_LABELS_MAJOR,
          type: 'symbol',
          source: SETTLEMENTS,
          filter: ['in', ['get', 'place'], ['literal', ['city', 'town']]],
          layout: {
            'text-field': ['get', 'name'],
            'text-font': LABEL_FONT_BOLD,
            'text-size': ['match', ['get', 'place'], 'city', 15, 13],
            'text-anchor': 'top',
            'text-offset': [0, 0.5],
            'symbol-sort-key': ['match', ['get', 'place'], 'city', 0, 1],
          },
          paint: labelPaint,
        },
        VILLAGES,
      )
      map.addLayer(
        {
          id: PLACE_LABELS_MINOR,
          type: 'symbol',
          source: SETTLEMENTS,
          minzoom: MINOR_LABEL_MIN_ZOOM,
          filter: ['!', ['in', ['get', 'place'], ['literal', ['city', 'town']]]],
          layout: {
            'text-field': ['get', 'name'],
            'text-font': LABEL_FONT,
            'text-size': ['match', ['get', 'place'], 'suburb', 12, 11],
            'text-anchor': 'top',
            'text-offset': [0, 0.5],
            'symbol-sort-key': ['match', ['get', 'place'], 'suburb', 2, 'village', 3, 4],
          },
          paint: labelPaint,
        },
        VILLAGES,
      )
      map.addLayer({
        id: VILLAGE_LABELS,
        type: 'symbol',
        source: VILLAGES,
        minzoom: VILLAGE_LABEL_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': LABEL_FONT,
          'text-size': 10,
          'text-anchor': 'top',
          'text-offset': [0, 0.5],
        },
        paint: { ...labelPaint, 'text-color': '#d6f1ff' },
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
          VILLAGES,
          floodLayerId(locationIdRef.current ?? ''),
        ].filter((id) => map.getLayer(id))
        return map.queryRenderedFeatures(point, { layers })[0]
      }
      map.on('click', (event) => {
        const feature = featureAt(event.point)
        const clicked = feature?.properties as Properties | undefined
        if (!feature || !clicked) return
        // MapLibre drops null values from clicked features, so use the original data
        const original = KINDS.flatMap((kind) => layersRef.current[kind]?.features ?? []).find(
          (feature) => feature.properties.name === clicked.name,
        )
        popupRef.current?.remove()
        popupRef.current = new Popup()
          .setLngLat(event.lngLat)
          .setDOMContent(
            popupContent(
              feature.layer.id === VILLAGES
                ? { taluk: null, population_2001: null, households_2001: null, ...clicked }
                : (original?.properties ?? clicked),
            ),
          )
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
    // The data tab is only visible once this runs, so the section can be scrolled to now
    if (tab === 'data' && scrollToCensusRef.current) {
      scrollToCensusRef.current = false
      document.getElementById(CENSUS_SECTION_ID)?.scrollIntoView({ block: 'start' })
    }
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
      const empty = (): Layer => ({ type: 'FeatureCollection', features: [] })
      const [layerResults, settlementLayer, villageLayer, landUse, routeLayer] = await Promise.all([
        Promise.all(
          KINDS.map(
            async (kind) =>
              [kind, await getJson<Layer>(`/api/locations/${id}/layers/${kind}`)] as const,
          ),
        ),
        getJson<Layer>(`/api/locations/${id}/settlements`),
        // These add detail, so a problem with them must never stop the flood map from loading
        getJson<Layer>(`/api/locations/${id}/villages`).catch(empty),
        getJson<LandUse>(`/api/locations/${id}/land-use`).catch((): LandUse => ({})),
        getJson<Layer>(`/api/locations/${id}/routes`).catch(empty),
      ])
      return {
        layers: Object.fromEntries(layerResults) as Layers,
        settlements: settlementLayer,
        villages: villageLayer,
        landUse,
        routes: routeLayer,
      }
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
    if (routes) (map.getSource(ROUTES) as GeoJSONSource).setData(routes)
    if (villages) (map.getSource(VILLAGES) as GeoJSONSource).setData(villages)
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
  }, [location, locationId, layers, settlements, routes, villages, mapReady])

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
    for (const layerId of [
      ROUTES_CASING,
      ROUTES,
      ROUTES_FLOODED,
      ROUTE_ENDS,
      VILLAGES,
      VILLAGE_LABELS,
    ]) {
      map.setLayoutProperty(layerId, 'visibility', simulatedVisibility)
    }
    map.setFilter(ROUTES_FLOODED, [
      'all',
      ['==', ['get', 'segment'], 'flooded'],
      ['==', ['get', 'rise_m'], rise],
    ])
    // A null level means the model never floods the place, and to-number would turn it into 0
    const reachedFilter: ExpressionSpecification = [
      'case',
      ['==', ['typeof', ['get', 'first_flooded_at_m']], 'number'],
      ['<=', ['to-number', ['get', 'first_flooded_at_m']], rise],
      false,
    ]
    map.setFilter(SETTLEMENTS, reachedFilter)
    // Only villages with a census figure are drawn
    const drawnVillages: ExpressionSpecification = [
      'all',
      reachedFilter,
      ['==', ['typeof', ['get', 'population_2001']], 'number'],
    ]
    map.setFilter(VILLAGES, drawnVillages)
    map.setFilter(VILLAGE_LABELS, drawnVillages)
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
    // A new region starts at its full view
    setZoom(1)
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

  // The view stays inside the study area, as near the rain forecast point as it can
  const applyZoom = (amount: number) => {
    setZoom(amount)
    const map = mapRef.current
    if (!map || !location) return
    const [west, south, east, north] = location.bbox
    const [centreLon, centreLat] = location.coordinates
    const halfWidth = (east - west) / amount / 2
    const halfHeight = (north - south) / amount / 2
    const lon = Math.min(east - halfWidth, Math.max(west + halfWidth, centreLon))
    const lat = Math.min(north - halfHeight, Math.max(south + halfHeight, centreLat))
    const camera = map.cameraForBounds(
      [
        [lon - halfWidth, lat - halfHeight],
        [lon + halfWidth, lat + halfHeight],
      ],
      { padding: 24 },
    )
    if (camera) map.easeTo({ ...camera, duration: ZOOM_DURATION_MS })
  }

  const openCensusData = () => {
    scrollToCensusRef.current = true
    setTab('data')
  }

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
        {locations.length > 0 && tab !== 'report' && (
          <div className="topbar-actions">
            <select
              className="topbar-select"
              aria-label="Study region"
              value={locationId ?? ''}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {tab === 'scenario' && riseValues.length > 0 && (
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
        {tab !== 'scenario' && (
          <h1>{TABS.find(({ id }) => id === tab)?.label ?? 'Flood Situation Report'}</h1>
        )}
        {/* The header is left out of a printed report, so it needs its own prototype notice */}
        {tab === 'report' && (
          <p className="subtitle">
            {location && `${location.label}. `}Prototype, not for operational use.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            Could not load data: {error}
          </p>
        )}

        <div hidden={tab !== 'scenario'}>
          {scenarios.length === 0 && (
            <p className="empty">{loading ? 'Loading flood data...' : 'No scenarios yet'}</p>
          )}

          <div className="columns">
            <section className="panel">
              <h2 className="section-title">Scenario parameters</h2>

              {locations.length > 0 && (
                <>
                  <span className="field-label">Study region</span>
                  <LocationSwitch
                    locations={locations}
                    selectedId={locationId}
                    onSelect={setLocationId}
                  />
                </>
              )}

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
                <Readout
                  wide
                  kind="simulated"
                  label={`People in census villages with flooded land at +${rise} m`}
                  value={villages?.features.length ? formatCount(villageSummary.people) : 'Not available'}
                  detail={
                    villages?.features.length
                      ? `From ${villageSummary.reached.length - villageSummary.missingCounts} of ${villageSummary.reached.length} villages with a census figure, so the real total is higher. 2001 census, whole village population, not people flooded`
                      : 'No census village data for this location yet'
                  }
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
              <MapLegend
                kinds={KINDS.filter((kind) => visible[kind])}
                rise={rise}
                focus={focusName}
                villages={villages}
                routes={routes}
                hasGauge={Boolean(layers.observed?.features.length)}
                onVillageClick={openCensusData}
              />
              <div className="zoom-control">
                <div className="zoom-row">
                  <label htmlFor="map-zoom">Zoom</label>
                  <input
                    id="map-zoom"
                    type="range"
                    min={ZOOM_MIN}
                    max={ZOOM_MAX}
                    step={ZOOM_STEP}
                    value={zoom}
                    onChange={(event) => applyZoom(Number(event.target.value))}
                  />
                  <select
                    aria-label="Zoom amount"
                    value={zoom}
                    onChange={(event) => applyZoom(Number(event.target.value))}
                  >
                    {ZOOM_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}×
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="zoom-reset"
                    disabled={zoom === 1}
                    onClick={() => applyZoom(1)}
                  >
                    Reset
                  </button>
                </div>
                <p className="note">
                  Centred on the rain forecast point where possible, and kept inside the study area.
                </p>
              </div>

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

              <h2 className="section-title census-title">Census villages with flooded land</h2>
              <CensusVillages villages={villages} rise={rise} />

              <h2 className="section-title census-title">Land use in the flood area</h2>
              <FloodedLandUse landUse={landUse} rise={rise} />

              <h2 className="section-title census-title">Roads in the flood area</h2>
              <RoadCheck routes={routes} rise={rise} />
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
          <CensusData
            villages={villages}
            regionName={location?.name ?? 'this'}
            onBack={() => setTab('scenario')}
          />
        </div>

        {tab === 'report' && reportInfo && selected && location && (
          <SituationReport
            info={reportInfo}
            location={location}
            rise={rise}
            scenarios={scenarios}
            selected={selected}
            settlements={settlements}
            villages={villages}
            landUse={landUse}
            routes={routes}
            layers={layers}
            alert={alerts.find((alert) => alert.location === locationId && alert.rise_m === rise)}
            onBack={() => setTab('scenario')}
          />
        )}
      </main>
    </div>
  )
}
