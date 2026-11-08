import type { FloodReportDay, Kind, LocationData, MapMode } from './types'

export const KINDS = ['observed', 'forecast', 'simulated'] as const
// Simulated flood areas get their own layer per location, so they can fade across
export const SHARED_MAP_KINDS = ['observed', 'forecast'] as const
export const TOGGLE_KINDS = ['observed', 'simulated'] as const

export const KIND_INFO: Record<Kind, { label: string; help: string; color: string }> = {
  observed: { label: 'Observed', help: 'Measured on the ground or by satellite', color: '#1565c0' },
  forecast: { label: 'Forecast', help: 'Model prediction of the future', color: '#b45309' },
  simulated: { label: 'Simulated', help: 'What-if flood scenarios', color: '#7b1fa2' },
}
// The lighter bars in a chart, next to the strong colour of the chosen one
export const CHART_TINT = { observed: '#bcd3ee', simulated: '#dcc7e6' }
export const CENSUS_DOT_COLOR = '#29b6f6'
export const ROAD_FLOODED_COLOR = '#e53935'
// The dark navy used for outlines on the map and in its legend, and for the location pin
export const OUTLINE_COLOR = '#16284a'

export const TABS = [
  { id: 'scenario', label: 'Scenario Analysis' },
  { id: 'alerts', label: 'Alert Log' },
  { id: 'data', label: 'Data Sources' },
] as const

export const MAP_MODES: { id: MapMode; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'heat', label: 'Heat map' },
]

// Until the selected location has loaded
export const EMPTY_DATA: LocationData = {
  layers: { observed: null, forecast: null, simulated: null },
  settlements: null, villages: null, landUse: null, routes: null, modelCheck: null, floodReports: null,
}
export const STANDARD_FIELDS = new Set(['kind', 'name', 'source', 'timestamp', 'quality', 'points_checked', 'village_key'])

// What a click on the map selects in Data Sources
export const ROADS_TARGET = 'roads'
export const SELECTED_SCENARIO_TARGET = 'selected-scenario'

export const ZOOM_MIN = 1
export const ZOOM_MAX = 4
export const ZOOM_STEP = 0.2
export const ZOOM_LEVELS = Array.from({ length: 16 }, (_, index) => Number((1 + index * ZOOM_STEP).toFixed(1)))
export const ZOOM_DURATION_MS = 500
export const LOCATE_ZOOM = 3
export const ALERT_PREVIEW_COUNT = 4
// A little longer than the map's fade, so each scenario is fully drawn before the next
export const RISE_PLAY_STEP_MS = 2000

export const FLOOD_TIMELINE_START = '2026-07-16'
export const RIVER_STATUS_LABEL: Record<FloodReportDay['river_status'], string> = {
  highest: 'Above highest flood level',
  danger: 'Above danger level',
  not_listed: 'Not listed above danger level',
}
