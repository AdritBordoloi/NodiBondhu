import { STANDARD_FIELDS } from './constants'
import { formatCount, reportDayName } from './format'
import type { Feature, FloodReportDay, FloodReports, Layer, Layers, Properties, ReportField } from './types'

export function extraFields(properties: Properties) {
  return Object.entries(properties).filter(([key]) => !STANDARD_FIELDS.has(key))
}

// Each layer can hold several kinds of feature, so find them by what they measure
export function findFeature(layer: Layer | null | undefined, field: string) {
  return layer?.features.find((feature) => feature.properties[field] != null)?.properties
}

export function observedFloodName(layers: Layers) {
  return layers.observed?.features.find((feature) => feature.geometry.type !== 'Point')?.properties
    .name as string | undefined
}

export function isFloodedAt(place: Feature, rise: number) {
  const level = place.properties.first_flooded_at_m
  return level != null && Number(level) <= rise
}

export function findFocusLevel(settlements: Layer | null, focus: string) {
  const place = settlements?.features.find((feature) => feature.properties.name === focus)
  return place ? (place.properties.first_flooded_at_m as number | null) : undefined
}

// A place missing from the data must never read as safe
export function focusStatus(level: number | null | undefined, rise: number) {
  if (level === undefined) return 'Not in mapped data'
  return level !== null && level <= rise ? 'Flooded' : 'Not flooded'
}

// How the region's main place fares at this rise, for the readouts and the scenario details
export function focusSummary(settlements: Layer | null, name: string, rise: number) {
  const level = findFocusLevel(settlements, name)
  return {
    name,
    status: settlements ? focusStatus(level, rise) : 'No data',
    detail: level != null ? `Model floods it from +${level} m` : undefined,
  }
}
export type FocusSummary = ReturnType<typeof focusSummary>

export function summariseVillages(villages: Layer | null, rise: number) {
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

export function mainRoutes(routes: Layer | null) {
  return (routes?.features ?? []).filter((route) => route.properties.segment === 'route')
}

export function floodedKm(route: Feature, rise: number) {
  return Number(route.properties[`flooded_km_${rise}`] ?? 0)
}

export function isPartlyMapped(route: Feature) {
  return Number(route.properties.mapped_km) < Number(route.properties.length_km)
}

export function routeDestination(route: Feature) {
  return String(route.properties.name).split(' to ').pop()
}

export function riverName(reports: FloodReports) {
  return String(reports.gauge).split(' (')[0]
}

// Days where the area is not listed have no figures, so they never count as the peak
export function peakDay(days: FloodReportDay[], field: ReportField) {
  return days
    .filter((day) => day.villages !== null)
    .reduce<FloodReportDay | undefined>(
      (best, day) => (Number(day[field]) > Number(best?.[field] ?? -1) ? day : best),
      undefined,
    )
}

export function floodReportSummary(reports: FloodReports | null) {
  const days = reports?.days ?? []
  if (!reports || days.length === 0) {
    return { value: 'Not available', detail: 'No official flood reports for this location yet' }
  }
  const peak = peakDay(days, 'villages')
  if (!peak) {
    const danger = days.find((day) => day.river_status !== 'not_listed')
    return {
      value: 'Not listed',
      detail: `${reports.area} is not listed as affected, 12 to 28 July${
        danger ? `. The ${riverName(reports)} was above danger level from ${reportDayName(danger.date)}` : ''
      }`,
    }
  }
  return {
    value: `${formatCount(peak.villages)} villages`,
    detail: `Peak reported on ${reportDayName(peak.date)} in ${reports.area}, with ${formatCount(peak.people)} people affected. Official counts for that area, not the map area`,
  }
}
