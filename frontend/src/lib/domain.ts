import type { Feature as GeoFeature, FeatureCollection, Geometry } from 'geojson'

export const KINDS = ['observed', 'forecast', 'simulated'] as const
export type Kind = (typeof KINDS)[number]

export const KIND_INFO: Record<
  Kind,
  { label: string; short: string; help: string; color: string }
> = {
  observed: {
    label: 'Observed',
    short: 'OBS',
    help: 'Measured on the ground or seen by satellite',
    color: '#4cc9f0',
  },
  forecast: {
    label: 'Forecast',
    short: 'FCST',
    help: 'Model prediction of what is coming',
    color: '#f5b544',
  },
  simulated: {
    label: 'Simulated',
    short: 'SIM',
    help: 'What-if flood scenarios from terrain',
    color: '#2ee6d6',
  },
}

// Same pilot window as scripts/pilot_area.py
export const WEST = 94.4
export const SOUTH = 26.65
export const EAST = 95.0
export const NORTH = 27.2
export const SIMALUGURI: [number, number] = [94.756, 26.92]

const DEG_KM = 111.32
export const PILOT_AREA_KM2 = Math.round(
  (NORTH - SOUTH) * DEG_KM * ((EAST - WEST) * DEG_KM * Math.cos((SOUTH * Math.PI) / 180)),
)

export type Properties = Record<string, string | number | null>
export type Feature = GeoFeature<Geometry, Properties>
export type Layer = FeatureCollection<Geometry, Properties>
export type Layers = Record<Kind, Layer | null>

export type Alert = {
  id: number
  created_at: string
  rise_m: number
  settlements: string[]
  kind: string
  channel: string
}

export type Dataset = {
  layers: Layers
  settlements: Layer
  alerts: Alert[]
}

const EMPTY_LAYER: Layer = { type: 'FeatureCollection', features: [] }

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return (await response.json()) as T
}

export async function loadDataset(): Promise<Dataset> {
  const [observed, forecast, simulated, settlements, alerts] = await Promise.all([
    getJson<Layer>('/api/layers/observed'),
    getJson<Layer>('/api/layers/forecast'),
    getJson<Layer>('/api/layers/simulated'),
    getJson<Layer>('/api/settlements'),
    getJson<Alert[]>('/api/alerts'),
  ])
  return {
    layers: { observed, forecast, simulated },
    settlements: settlements ?? EMPTY_LAYER,
    alerts: alerts ?? [],
  }
}

export async function postAlert(riseM: number): Promise<Alert> {
  const response = await fetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rise_m: riseM }),
  })
  if (!response.ok) throw new Error(`Alert log returned ${response.status}`)
  return (await response.json()) as Alert
}

/* ---------- formatting ---------- */

export function formatNumber(value: unknown, digits = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return number.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatArea(value: unknown) {
  return `${formatNumber(value, 1)} km²`
}

export function formatTime(value: string | number | null | undefined) {
  if (!value) return 'Not available'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatClock(value: string | number | null | undefined) {
  if (!value) return '—'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function formatField(key: string) {
  return key
    .replace(/_km2$/, ' (km²)')
    .replace(/_mm$/, ' (mm)')
    .replace(/_m$/, ' (m)')
    .replace(/_/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

export const STANDARD_FIELDS = new Set(['kind', 'name', 'source', 'timestamp', 'quality'])

export function extraFields(properties: Properties) {
  return Object.entries(properties).filter(([key]) => !STANDARD_FIELDS.has(key))
}

/* ---------- derived state ---------- */

export type Scenario = {
  rise: number
  area: number
  affected: number
  feature: Feature
}

export function scenariosFrom(layer: Layer | null): Scenario[] {
  if (!layer) return []
  return layer.features
    .map((feature) => ({
      rise: Number(feature.properties.rise_m),
      area: Number(feature.properties.flooded_area_km2),
      affected: Number(feature.properties.settlements_affected),
      feature,
    }))
    .sort((a, b) => a.rise - b.rise)
}

export type Place = {
  name: string
  level: number
  coordinates: [number, number]
  feature: Feature
}

export function placesFrom(layer: Layer | null): Place[] {
  if (!layer) return []
  return layer.features
    .filter((feature) => feature.properties.first_flooded_at_m != null)
    .map((feature) => {
      const geometry = feature.geometry
      const coordinates =
        geometry.type === 'Point' ? (geometry.coordinates as [number, number]) : ([WEST, SOUTH] as [number, number])
      return {
        name: String(feature.properties.name ?? 'Unnamed'),
        level: Number(feature.properties.first_flooded_at_m),
        coordinates,
        feature,
      }
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
}

export function severityFor(place: Place, rise: number): 'severe' | 'moderate' | 'watch' {
  const excess = rise - place.level
  if (excess >= 2) return 'severe'
  if (excess >= 1) return 'moderate'
  return 'watch'
}

export const SEVERITY_INFO = {
  severe: { label: 'Severe', color: '#ff6b6b' },
  moderate: { label: 'Moderate', color: '#f5b544' },
  watch: { label: 'Watch', color: '#7dd3fc' },
} as const

export function pilotStatus(settlements: Layer | null, rise: number) {
  const place = settlements?.features.find((f) => f.properties.name === 'Simaluguri')
  const level = place?.properties.first_flooded_at_m
  if (level == null) return { known: false, flooded: false, level: null as number | null }
  return { known: true, flooded: Number(level) <= rise, level: Number(level) }
}

export function percentOfPilot(area: number) {
  return (area / PILOT_AREA_KM2) * 100
}
