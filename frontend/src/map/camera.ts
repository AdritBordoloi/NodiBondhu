import { LngLat, type Map as MapLibreMap } from 'maplibre-gl'
import type { Location } from '../types'
import { FLIGHT_DURATION_MS } from './config'

// Stops the map zooming out past the region's full view or panning away from it. The limits match
// what that view shows on screen, because tighter ones would force the map to zoom in on a wide panel
function lockMapToRegion(map: MapLibreMap, [west, south, east, north]: number[]) {
  const camera = map.cameraForBounds([[west, south], [east, north]], { padding: 24 })
  const { clientWidth, clientHeight } = map.getContainer()
  if (camera?.center === undefined || camera.zoom === undefined || !clientWidth || !clientHeight) return
  const centre = LngLat.convert(camera.center)
  const degreesPerPixel = 360 / (512 * 2 ** camera.zoom)
  const halfWidth = (clientWidth / 2) * degreesPerPixel * 1.01
  const halfHeight = (clientHeight / 2) * degreesPerPixel * Math.cos((centre.lat * Math.PI) / 180) * 1.01
  map.setMinZoom(camera.zoom)
  map.setMaxBounds([
    [centre.lng - halfWidth, centre.lat - halfHeight],
    [centre.lng + halfWidth, centre.lat + halfHeight],
  ])
}

// Keeps the lock in step with the map's size, setting it again whenever the map stops moving
export function holdInRegion(map: MapLibreMap, bbox: Location['bbox']) {
  const applyLock = () => {
    if (!map.isMoving()) lockMapToRegion(map, bbox)
  }
  applyLock()
  map.on('moveend', applyLock)
  map.on('resize', applyLock)
  return () => {
    map.off('moveend', applyLock)
    map.off('resize', applyLock)
  }
}

export function unlockMap(map: MapLibreMap) {
  map.setMaxBounds(null)
  map.setMinZoom(null)
}

// The view at a zoom amount, centred on the region's main point and kept inside the study area
export function regionCamera(map: MapLibreMap, location: Location, amount: number) {
  const [west, south, east, north] = location.bbox
  const [centreLon, centreLat] = location.coordinates
  const halfWidth = (east - west) / amount / 2
  const halfHeight = (north - south) / amount / 2
  const lon = Math.min(east - halfWidth, Math.max(west + halfWidth, centreLon))
  const lat = Math.min(north - halfHeight, Math.max(south + halfHeight, centreLat))
  return map.cameraForBounds([[lon - halfWidth, lat - halfHeight], [lon + halfWidth, lat + halfHeight]], { padding: 24 })
}

// Starts and stops gently, with no pull back or overshoot
function smoothEasing(t: number) {
  return (1 - Math.cos(Math.PI * t)) / 2
}

// Jumps on the first visit and flies between regions. Returns false when the map cannot fit the view
export function moveToRegion(map: MapLibreMap, location: Location, amount: number, fly: boolean) {
  const camera = regionCamera(map, location, amount)
  if (!camera) return false
  // The old region's limits would block the flight. The lock is set again when it lands
  unlockMap(map)
  if (fly) {
    // MapLibre turns this into an instant jump for people who ask for reduced motion
    map.flyTo({ ...camera, curve: 1.2, duration: FLIGHT_DURATION_MS, easing: smoothEasing })
  } else {
    map.jumpTo(camera)
  }
  return true
}

export function captureMap(map: MapLibreMap): Promise<string | null> {
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
