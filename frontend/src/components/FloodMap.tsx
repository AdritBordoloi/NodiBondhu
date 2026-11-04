import { useEffect, useRef } from 'react'
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { EAST, NORTH, SIMALUGURI, SOUTH, WEST, type Layer, type Place } from '../lib/domain'

// Bundling breaks MapLibre's automatic worker lookup, so point to it directly
setWorkerUrl(workerUrl)

const PILOT = 'pilot-boundary'

type Props = {
  simulated: Layer
  places: Layer
  observed: Layer | null
  forecast: Layer | null
  visible: Record<string, boolean>
  expanded: boolean
  basemap: 'imagery' | 'dark'
  focus: Place | null
  onReady: (map: MapLibreMap | null) => void
}

function emptyLayer(): Layer {
  return { type: 'FeatureCollection', features: [] }
}

export default function FloodMap({
  simulated,
  places,
  observed,
  forecast,
  visible,
  expanded,
  basemap,
  focus,
  onReady,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)
  const dataRef = useRef({ simulated, places, observed, forecast })

  useEffect(() => {
    if (!container.current) return
    const map = new MapLibreMap({
      container: container.current,
      bounds: [
        [WEST, SOUTH],
        [EAST, NORTH],
      ],
      fitBoundsOptions: { padding: { top: 40, bottom: 60, left: 40, right: 40 } },
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          imagery: {
            type: 'raster',
            tiles: [
              'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            attribution:
              'Imagery © <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
          },
          imageryLabels: {
            type: 'raster',
            tiles: [
              'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
          },
          darkBase: {
            type: 'raster',
            tiles: [
              'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            attribution: 'Basemap © <a href="https://www.esri.com">Esri</a>, HERE, Garmin, OpenStreetMap',
          },
          darkLabels: {
            type: 'raster',
            tiles: [
              'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
          },
        },
        layers: [
          { id: 'dark-base', type: 'raster', source: 'darkBase', layout: { visibility: 'none' } },
          { id: 'dark-labels', type: 'raster', source: 'darkLabels', layout: { visibility: 'none' } },
          { id: 'imagery', type: 'raster', source: 'imagery' },
          { id: 'imagery-labels', type: 'raster', source: 'imageryLabels' },
          {
            id: 'imagery-wash',
            type: 'background',
            paint: { 'background-color': '#03060c', 'background-opacity': 0.44 },
          },
        ],
      },
    })

    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    new Marker({ color: '#2ee6d6', scale: 0.85 })
      .setLngLat(SIMALUGURI)
      .setPopup(new Popup({ offset: 12 }).setText('Simaluguri · pilot location'))
      .addTo(map)

    map.once('style.load', () => {
      map.addSource('simulated', { type: 'geojson', data: emptyLayer() })
      map.addLayer({
        id: 'sim-fill',
        type: 'fill',
        source: 'simulated',
        filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
        paint: {
          'fill-color': '#2ee6d6',
          'fill-opacity': 0.22,
        },
      })
      map.addLayer({
        id: 'sim-line',
        type: 'line',
        source: 'simulated',
        filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
        paint: {
          'line-color': '#79f2e6',
          'line-width': 1.1,
          'line-opacity': 0.55,
        },
      })

      map.addSource(PILOT, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [WEST, SOUTH],
              [EAST, SOUTH],
              [EAST, NORTH],
              [WEST, NORTH],
              [WEST, SOUTH],
            ],
          },
        },
      })
      map.addLayer({
        id: PILOT,
        type: 'line',
        source: PILOT,
        paint: {
          'line-color': '#f5b544',
          'line-width': 1.2,
          'line-opacity': 0.5,
          'line-dasharray': [3, 3],
        },
      })

      map.addSource('places', { type: 'geojson', data: emptyLayer() })
      map.addLayer({
        id: 'places-glow',
        type: 'circle',
        source: 'places',
        filter: ['!=', ['get', 'state'], 'safe'],
        paint: {
          'circle-color': [
            'match',
            ['get', 'state'],
            'severe',
            '#ff6b6b',
            'moderate',
            '#f5b544',
            '#7dd3fc',
          ],
          'circle-radius': 11,
          'circle-blur': 1,
          'circle-opacity': 0.35,
        },
      })
      map.addLayer({
        id: 'places',
        type: 'circle',
        source: 'places',
        paint: {
          'circle-color': [
            'match',
            ['get', 'state'],
            'severe',
            '#ff6b6b',
            'moderate',
            '#f5b544',
            'watch',
            '#7dd3fc',
            '#3a4f6a',
          ],
          'circle-radius': ['match', ['get', 'state'], 'safe', 2.6, 4.2],
          'circle-stroke-color': ['match', ['get', 'state'], 'safe', 'rgba(0,0,0,0)', '#061019'],
          'circle-stroke-width': 1,
          'circle-opacity': ['match', ['get', 'state'], 'safe', 0.75, 1],
        },
      })

      for (const kind of ['observed', 'forecast'] as const) {
        map.addSource(kind, { type: 'geojson', data: emptyLayer() })
        map.addLayer({
          id: `${kind}-points`,
          type: 'circle',
          source: kind,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-color': kind === 'observed' ? '#4cc9f0' : '#f5b544',
            'circle-radius': 5,
            'circle-stroke-color': '#04070e',
            'circle-stroke-width': 2,
          },
        })
      }

      const popup = new Popup({ offset: 14, closeButton: false, className: 'nb-popup' })
      map.on('click', 'places', (event: MapLayerMouseEvent) => {
        const clicked = event.features?.[0]?.properties
        if (!clicked) return
        const root = document.createElement('div')
        root.className = 'map-popup'
        const title = document.createElement('strong')
        title.textContent = String(clicked.name ?? 'Place')
        const level = document.createElement('span')
        level.textContent = `First floods at +${clicked.level} m`
        const note = document.createElement('span')
        note.className = 'map-popup-note'
        note.textContent = 'OpenStreetMap place point · modelled, not observed'
        root.append(title, level, note)
        popup.setLngLat(event.lngLat).setDOMContent(root).addTo(map)
      })
      for (const id of ['places', 'observed-points', 'forecast-points']) {
        map.on('mouseenter', id, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', id, () => {
          map.getCanvas().style.cursor = ''
        })
      }

      readyRef.current = true
      const { simulated: sim, places: placeData, observed: obs, forecast: fc } = dataRef.current
      ;(map.getSource('simulated') as GeoJSONSource).setData(sim)
      ;(map.getSource('places') as GeoJSONSource).setData(placeData)
      ;(map.getSource('observed') as GeoJSONSource).setData(obs ?? emptyLayer())
      ;(map.getSource('forecast') as GeoJSONSource).setData(fc ?? emptyLayer())
      onReady(map)
    })

    mapRef.current = map
    return () => {
      readyRef.current = false
      onReady(null)
      map.remove()
      mapRef.current = null
    }
  }, [onReady])

  // Push new data into the existing sources
  useEffect(() => {
    dataRef.current = { simulated, places, observed, forecast }
    const map = mapRef.current
    if (!map || !readyRef.current) return
    ;(map.getSource('simulated') as GeoJSONSource).setData(simulated)
    ;(map.getSource('places') as GeoJSONSource).setData(places)
    ;(map.getSource('observed') as GeoJSONSource | undefined)?.setData(observed ?? emptyLayer())
    ;(map.getSource('forecast') as GeoJSONSource | undefined)?.setData(forecast ?? emptyLayer())
  }, [simulated, places, observed, forecast])

  // Switch between satellite imagery and the dark canvas basemap
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const show = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    const useImagery = basemap === 'imagery'
    show('imagery', useImagery)
    show('imagery-labels', useImagery)
    show('imagery-wash', useImagery)
    show('dark-base', !useImagery)
    show('dark-labels', !useImagery)
  }, [basemap])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const set = (id: string, on: boolean) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    set('sim-fill', visible.simulated)
    set('sim-line', visible.simulated)
    set('places', visible.places)
    set('places-glow', visible.places)
    set('observed-points', visible.observed)
    set('forecast-points', visible.forecast)
    set(PILOT, visible.boundary)
  }, [visible])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const timer = window.setTimeout(() => map.resize(), 240)
    return () => window.clearTimeout(timer)
  }, [expanded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.flyTo({ center: focus.coordinates, zoom: 11.4, duration: 900, essential: true })
  }, [focus])

  return <div className="map-canvas" ref={container} role="region" aria-label="Flood map of the Simaluguri area" />
}
