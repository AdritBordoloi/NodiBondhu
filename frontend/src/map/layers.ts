import type {
  CircleLayerSpecification, ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl'
import { CENSUS_DOT_COLOR, KIND_INFO, OUTLINE_COLOR, ROAD_FLOODED_COLOR, SHARED_MAP_KINDS } from '../constants'
import type { Kind, Layer, Location, LocationData, MapMode } from '../types'
import {
  FLOOD_FADE_MS, FLOOD_OPACITY, HEAT_COLORS, HEAT_OPACITY, MINOR_LABEL_MIN_ZOOM, OBSERVED_AREA,
  OBSERVED_OPACITY, PILOT_AREA, PLACE_LABELS_MAJOR, PLACE_LABELS_MINOR, POINT_FILTER, POLYGON_FILTER,
  ROUTE_ENDS, ROUTE_LINE_FILTER, ROUTES, ROUTES_CASING, ROUTES_FLOODED, SATELLITE_LAYERS, SETTLEMENTS,
  SIMULATED_LAYERS, VILLAGE_LABEL_MIN_ZOOM, VILLAGE_LABELS, VILLAGES, floodLayerId,
} from './config'

// MapLibre reloads its style for a moment when its workers restart, which React's double start in
// development can cause. A change made then would throw, so it waits for the reload to finish
export function whenStyleLoaded(map: MapLibreMap, run: () => void) {
  if ((map.style as unknown as { _loaded?: boolean } | undefined)?._loaded === false) map.once('style.load', run)
  else run()
}

const ROUND_LINE = { 'line-cap': 'round', 'line-join': 'round' } as const
const MAJOR_PLACES: ExpressionSpecification = ['in', ['get', 'place'], ['literal', ['city', 'town']]]

function circlePaint(color: string, radius: number, stroke: string, strokeWidth: number) {
  return {
    'circle-color': color,
    'circle-radius': radius,
    'circle-stroke-color': stroke,
    'circle-stroke-width': strokeWidth,
  } satisfies CircleLayerSpecification['paint']
}

function labelLayout(
  font: string,
  size: NonNullable<SymbolLayerSpecification['layout']>['text-size'],
  sortKey?: ExpressionSpecification,
): SymbolLayerSpecification['layout'] {
  return {
    'text-field': ['get', 'name'],
    'text-font': [font],
    'text-size': size,
    'text-anchor': 'top',
    'text-offset': [0, 0.5],
    ...(sortKey && { 'symbol-sort-key': sortKey }),
  }
}

const labelPaint = { 'text-color': '#ffffff', 'text-halo-color': 'rgba(10, 20, 40, 0.9)', 'text-halo-width': 1.6 }

function routeLine(id: string, color: string, width: number, filter?: ExpressionSpecification): LayerSpecification {
  const paint = { 'line-color': color, 'line-width': width }
  return { id, type: 'line', source: ROUTES, ...(filter && { filter }), layout: ROUND_LINE, paint }
}

// Each kind shares one source for its areas and points, kept apart so the points sit on top
const kindArea = (kind: Kind): LayerSpecification => ({
  id: `${kind}-area`,
  type: 'fill',
  source: kind,
  filter: POLYGON_FILTER,
  paint: { 'fill-color': KIND_INFO[kind].color, 'fill-opacity': OBSERVED_OPACITY },
})
const kindPoint = (kind: Kind): LayerSpecification => ({
  id: `${kind}-point`,
  type: 'circle',
  source: kind,
  filter: POINT_FILTER,
  paint: circlePaint(KIND_INFO[kind].color, 9, '#ffffff', 2),
})

const DATA_SOURCES = [...SHARED_MAP_KINDS, PILOT_AREA, ROUTES, VILLAGES, SETTLEMENTS]

// Bottom to top. Each location's flood layer is slipped in under the observed area once loaded.
// Place names sit above the flood area and roads but below the dots, and the map hides names that
// would overlap
const dataLayers = (): LayerSpecification[] => [
  ...SHARED_MAP_KINDS.map(kindArea),
  { id: PILOT_AREA, type: 'line', source: PILOT_AREA, paint: { 'line-color': '#ffd54a', 'line-width': 2, 'line-dasharray': [3, 2] } },
  routeLine(ROUTES_CASING, OUTLINE_COLOR, 4.5, ROUTE_LINE_FILTER),
  routeLine(ROUTES, '#ffffff', 2.5, ROUTE_LINE_FILTER),
  // Its filter follows the rise, so it is set with the rest of the view
  routeLine(ROUTES_FLOODED, ROAD_FLOODED_COLOR, 3),
  {
    id: ROUTE_ENDS,
    type: 'circle',
    source: ROUTES,
    filter: ['==', ['get', 'segment'], 'end'],
    paint: circlePaint('#ffffff', 5, OUTLINE_COLOR, 2),
  },
  // Place names are drawn from OpenStreetMap, like the default map
  {
    id: PLACE_LABELS_MAJOR,
    type: 'symbol',
    source: SETTLEMENTS,
    filter: MAJOR_PLACES,
    layout: labelLayout('Open Sans Bold', ['match', ['get', 'place'], 'city', 15, 13], ['match', ['get', 'place'], 'city', 0, 1]),
    paint: labelPaint,
  },
  {
    id: PLACE_LABELS_MINOR,
    type: 'symbol',
    source: SETTLEMENTS,
    minzoom: MINOR_LABEL_MIN_ZOOM,
    filter: ['!', MAJOR_PLACES],
    layout: labelLayout(
      'Open Sans Regular',
      ['match', ['get', 'place'], 'suburb', 12, 11],
      ['match', ['get', 'place'], 'suburb', 2, 'village', 3, 4],
    ),
    paint: labelPaint,
  },
  { id: VILLAGES, type: 'circle', source: VILLAGES, paint: circlePaint(CENSUS_DOT_COLOR, 3.5, OUTLINE_COLOR, 1) },
  { id: SETTLEMENTS, type: 'circle', source: SETTLEMENTS, paint: circlePaint(KIND_INFO.simulated.color, 5, '#ffffff', 1.5) },
  {
    id: VILLAGE_LABELS,
    type: 'symbol',
    source: VILLAGES,
    minzoom: VILLAGE_LABEL_MIN_ZOOM,
    layout: labelLayout('Open Sans Regular', 10),
    paint: { ...labelPaint, 'text-color': '#d6f1ff' },
  },
  ...SHARED_MAP_KINDS.map(kindPoint),
]

// The sources start empty and are filled for the selected location
export function addDataLayers(map: MapLibreMap) {
  for (const id of DATA_SOURCES) {
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  for (const layer of dataLayers()) map.addLayer(layer)
}

// Simulated flood areas get their own layer per location, so they can fade across
export function addFloodLayers(map: MapLibreMap, locations: Location[], allData: Record<string, LocationData>) {
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
        // Draws the lowest rise last, so it sits on top in the heat map
        layout: { 'fill-sort-key': ['-', 0, ['get', 'rise_m']] },
        paint: {
          'fill-color': KIND_INFO.simulated.color,
          'fill-opacity': 0,
          'fill-opacity-transition': { duration: FLOOD_FADE_MS, delay: 0 },
        },
      },
      OBSERVED_AREA,
    )
  }
}

type MapData = Pick<LocationData, 'layers' | 'settlements' | 'routes' | 'villages'>

// Fills the shared sources with one location's data and outlines its study area
export function showLocationData(map: MapLibreMap, bbox: Location['bbox'], { layers, settlements, routes, villages }: MapData) {
  const sources: [string, Layer | null][] = [
    ...SHARED_MAP_KINDS.map((kind) => [kind, layers[kind]] as [string, Layer | null]),
    [SETTLEMENTS, settlements],
    [ROUTES, routes],
    [VILLAGES, villages],
  ]
  for (const [id, data] of sources) {
    if (data) (map.getSource(id) as GeoJSONSource).setData(data)
  }
  const [west, south, east, north] = bbox
  ;(map.getSource(PILOT_AREA) as GeoJSONSource).setData({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [[west, south], [east, south], [east, north], [west, north], [west, south]],
    },
  })
}

type MapView = { visible: Record<Kind, boolean>; mapMode: MapMode; rise: number; locations: Location[]; locationId: string | null }

// Shows, hides, filters and colours the layers for the chosen view, layer toggles and rise
export function applyMapView(map: MapLibreMap, { visible, mapMode, rise, locations, locationId }: MapView) {
  const show = (layerId: string, shown: boolean) => map.setLayoutProperty(layerId, 'visibility', shown ? 'visible' : 'none')
  for (const kind of SHARED_MAP_KINDS) {
    show(`${kind}-area`, visible[kind])
    show(`${kind}-point`, visible[kind])
  }
  const heat = mapMode === 'heat'
  const satellite = mapMode === 'satellite'
  for (const layerId of SATELLITE_LAYERS) show(layerId, satellite)
  // The street map already has place names, so only the satellite view needs these
  for (const layerId of [PLACE_LABELS_MAJOR, PLACE_LABELS_MINOR]) {
    if (map.getLayer(layerId)) show(layerId, satellite)
  }
  map.setPaintProperty('osm', 'raster-saturation', heat ? -1 : 0)
  // Radar would cover the heat colours, and it is a different kind of evidence
  if (heat) show(OBSERVED_AREA, false)
  for (const { id } of locations) {
    const layerId = floodLayerId(id)
    if (!map.getLayer(layerId)) continue
    show(layerId, heat || visible.simulated)
    map.setFilter(layerId, heat ? POLYGON_FILTER : ['all', POLYGON_FILTER, ['==', ['get', 'rise_m'], rise]])
    map.setPaintProperty(layerId, 'fill-color', heat ? HEAT_COLORS : KIND_INFO.simulated.color)
    const opacity = heat ? HEAT_OPACITY : FLOOD_OPACITY
    map.setPaintProperty(layerId, 'fill-opacity', id === locationId ? opacity : 0)
  }
  for (const layerId of SIMULATED_LAYERS) show(layerId, visible.simulated)
  map.setFilter(ROUTES_FLOODED, ['all', ['==', ['get', 'segment'], 'flooded'], ['==', ['get', 'rise_m'], rise]])
  // A null level means the model never floods the place, and to-number would turn it into 0
  const reachedFilter: ExpressionSpecification = [
    'case',
    ['==', ['typeof', ['get', 'first_flooded_at_m']], 'number'],
    ['<=', ['to-number', ['get', 'first_flooded_at_m']], rise],
    false,
  ]
  map.setFilter(SETTLEMENTS, reachedFilter)
  // Only villages with a census figure are drawn
  const drawnVillages: ExpressionSpecification = ['all', reachedFilter, ['==', ['typeof', ['get', 'population_2001']], 'number']]
  map.setFilter(VILLAGES, drawnVillages)
  map.setFilter(VILLAGE_LABELS, drawnVillages)
}
