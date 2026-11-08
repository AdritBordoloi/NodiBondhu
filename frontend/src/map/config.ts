import type { ExpressionSpecification } from 'maplibre-gl'

// Only shown for a moment, until the locations have loaded
export const INITIAL_CENTER: [number, number] = [94.7, 26.93]
export const BHUVAN_ATTRIBUTION = 'Imagery: Bhuvan, NRSC/ISRO'
// Free font files for map labels. If they cannot load, the map still works without names
export const GLYPHS_URL = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf'
export const INDIA_BOUNDS: [number, number, number, number] = [68, 6, 98, 38]
// Only some Bhuvan layers match the web map's projection. bhuvan_marc is the clearest
// when zoomed out but stops at zoom 11, and bhuvan_wbase_v3 is sharp from zoom 12
export const SATELLITE_WIDE_MAX_ZOOM = 11
export const SATELLITE_DETAIL_MIN_ZOOM = 12
export const SATELLITE_DETAIL_MAX_ZOOM = 15
export const SATELLITE_LAYERS = ['satellite-wide', 'satellite-detail']

// Source and layer ids
export const PILOT_AREA = 'pilot-area'
export const SETTLEMENTS = 'settlements'
export const ROUTES = 'routes'
export const ROUTES_CASING = 'routes-casing'
export const ROUTES_FLOODED = 'routes-flooded'
export const ROUTE_ENDS = 'route-ends'
export const VILLAGES = 'villages'
export const PLACE_LABELS_MAJOR = 'place-labels-major'
export const PLACE_LABELS_MINOR = 'place-labels-minor'
export const VILLAGE_LABELS = 'village-labels'
export const OBSERVED_AREA = 'observed-area'
export const ROAD_LAYERS = [ROUTES, ROUTES_CASING, ROUTES_FLOODED, ROUTE_ENDS]
// Shown and hidden with the simulated layer toggle
export const SIMULATED_LAYERS = [SETTLEMENTS, ROUTES_CASING, ROUTES, ROUTES_FLOODED, ROUTE_ENDS, VILLAGES, VILLAGE_LABELS]

export function floodLayerId(locationId: string) {
  return `flood-${locationId}`
}

export function bhuvanTiles(layer: string) {
  return (
    'https://bhuvan-ras1.nrsc.gov.in/tilecache/tilecache.py?service=WMS&version=1.1.1' +
    `&request=GetMap&layers=${layer}&styles=&srs=EPSG:3857&bbox={bbox-epsg-3857}` +
    '&width=256&height=256&format=image/jpeg'
  )
}

export const MINOR_LABEL_MIN_ZOOM = 10.5
export const VILLAGE_LABEL_MIN_ZOOM = 12
export const FLIGHT_DURATION_MS = 3600
export const FLOOD_FADE_MS = 1500
export const FLOOD_OPACITY = 0.4
// Scenarios overlap, so the land that floods first builds up to the strongest colour
export const HEAT_OPACITY = 0.65
export const OBSERVED_OPACITY = 0.7
export const HEAT_COLORS: ExpressionSpecification = [
  'match', ['get', 'rise_m'],
  1, '#d7191c', 2, '#f46d43', 3, '#fdae61', 4, '#a6d96a', 5, '#1a9850',
  '#2b83ba',
]

export const POLYGON_FILTER: ExpressionSpecification = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]]
export const POINT_FILTER: ExpressionSpecification = ['==', ['geometry-type'], 'Point']
export const ROUTE_LINE_FILTER: ExpressionSpecification = ['==', ['get', 'segment'], 'route']
