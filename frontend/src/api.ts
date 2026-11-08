import { KINDS } from './constants'
import type {
  AiResult, Alert, FloodReports, LandUse, Layer, Layers, Location, LocationData, ModelCheckResult,
} from './types'

export function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

export async function getJson<T>(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${url} failed with status ${response.status}`)
  return (await response.json()) as T
}

async function getLocationData(id: string, signal: AbortSignal): Promise<LocationData> {
  const get = <T,>(path: string) => getJson<T>(`/api/locations/${id}/${path}`, signal)
  // These add detail, so a problem with them must never stop the flood map from loading
  const optional = <T,>(path: string, fallback: () => T) => get<T>(path).catch(fallback)
  const empty = (): Layer => ({ type: 'FeatureCollection', features: [] })
  const [layerResults, settlements, villages, landUse, routes, modelCheck, floodReports] = await Promise.all([
    Promise.all(KINDS.map(async (kind) => [kind, await get<Layer>(`layers/${kind}`)] as const)),
    get<Layer>('settlements'),
    optional('villages', empty),
    optional('land-use', (): LandUse => ({})),
    optional('routes', empty),
    optional('model-check', (): ModelCheckResult => ({})),
    optional('flood-reports', (): FloodReports => ({})),
  ])
  return {
    layers: Object.fromEntries(layerResults) as Layers,
    settlements,
    villages,
    landUse,
    routes,
    modelCheck,
    floodReports,
  }
}

// Loads every location up front, so switching never waits on the network
export async function loadLocations(signal: AbortSignal) {
  const locations = await getJson<Location[]>('/api/locations', signal)
  const entries = await Promise.all(
    locations.map(async (item) => [item.id, await getLocationData(item.id, signal)] as const),
  )
  return { locations, data: Object.fromEntries(entries) as Record<string, LocationData> }
}

export async function postAlert(location: string | null, rise: number) {
  const response = await fetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location, rise_m: rise }),
  })
  if (!response.ok) throw new Error(`Status ${response.status}`)
  return (await response.json()) as Alert
}

// The summary reply explains itself when the model is off, so it is read whatever the status
export function getSummary(locationId: string, rise: number, signal: AbortSignal) {
  return fetch(`/api/locations/${locationId}/summary?rise=${rise}`, { signal }).then(
    (response) => response.json() as Promise<AiResult>,
  )
}
