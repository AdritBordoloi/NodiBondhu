import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type PointLike } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { ROADS_TARGET, SELECTED_SCENARIO_TARGET, SHARED_MAP_KINDS } from '../constants'
import type { Properties } from '../types'
import {
  BHUVAN_ATTRIBUTION, GLYPHS_URL, INDIA_BOUNDS, INITIAL_CENTER, OBSERVED_AREA, ROAD_LAYERS,
  SATELLITE_DETAIL_MAX_ZOOM, SATELLITE_DETAIL_MIN_ZOOM, SATELLITE_WIDE_MAX_ZOOM, SETTLEMENTS, VILLAGE_LABELS,
  VILLAGES, bhuvanTiles,
} from './config'

// Bundling breaks MapLibre's automatic worker lookup, so point to it directly
setWorkerUrl(workerUrl)

const LOCATE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>'

// The base map, with the zoom buttons and a button that returns to the region's main point
export function createMap(container: HTMLElement, onLocate: () => void) {
  const map = new MapLibreMap({
    container,
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
        { id: 'satellite-wide', type: 'raster', source: 'satellite-wide', maxzoom: SATELLITE_DETAIL_MIN_ZOOM, layout: { visibility: 'none' } },
        { id: 'satellite-detail', type: 'raster', source: 'satellite-detail', minzoom: SATELLITE_DETAIL_MIN_ZOOM, layout: { visibility: 'none' } },
      ],
    },
  })
  map.addControl(new NavigationControl(), 'top-right')
  map.addControl(
    {
      onAdd: () => {
        const group = document.createElement('div')
        group.className = 'maplibregl-ctrl maplibregl-ctrl-group'
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'map-locate'
        button.title = 'Locate the main point of this study region'
        button.setAttribute('aria-label', button.title)
        button.innerHTML = LOCATE_ICON
        button.addEventListener('click', onLocate)
        group.append(button)
        return group
      },
      onRemove: () => {},
    },
    'top-right',
  )
  return map
}

// Everything on the map opens its own place in Data Sources, given as a target such as
// 'village:<key>'. The pin stands for the region, so it opens the selected scenario
export function openTargetsOnClick(
  map: MapLibreMap,
  {
    floodLayer,
    pin,
    open,
  }: { floodLayer: () => string; pin: () => HTMLElement | undefined; open: (target: string) => void },
) {
  // Only the topmost feature responds, and hidden flood layers never do
  const featureAt = (point: PointLike) => {
    const layers = [
      ...SHARED_MAP_KINDS.map((kind) => `${kind}-point`),
      SETTLEMENTS,
      VILLAGES,
      VILLAGE_LABELS,
      ...ROAD_LAYERS,
      OBSERVED_AREA,
      floodLayer(),
    ].filter((id) => map.getLayer(id))
    return map.queryRenderedFeatures(point, { layers })[0]
  }
  map.on('click', (event) => {
    if (pin()?.contains(event.originalEvent.target as Node)) {
      open(SELECTED_SCENARIO_TARGET)
      return
    }
    const feature = featureAt(event.point)
    const clicked = feature?.properties as Properties | undefined
    if (!feature || !clicked) return
    const layerId = feature.layer.id
    if (layerId === VILLAGES || layerId === VILLAGE_LABELS) {
      open(`village:${clicked.village_key}`)
    } else if (layerId === SETTLEMENTS) {
      open(`settlement:${clicked.name}`)
    } else if (ROAD_LAYERS.includes(layerId)) {
      open(ROADS_TARGET)
    } else if (layerId === floodLayer()) {
      open(SELECTED_SCENARIO_TARGET)
    } else {
      open(`feature:${clicked.name}`)
    }
  })
  map.on('mousemove', (event) => {
    map.getCanvas().style.cursor = featureAt(event.point) ? 'pointer' : ''
  })
}
