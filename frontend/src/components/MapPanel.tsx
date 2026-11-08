import type { ReactNode, Ref } from 'react'
import { MAP_MODES, ZOOM_LEVELS, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../constants'
import type { MapMode } from '../types'

type MapPanelProps = {
  containerRef: Ref<HTMLDivElement>
  mapLocked: boolean
  onToggleLock: () => void
  mapMode: MapMode
  onMapMode: (mode: MapMode) => void
  legend: ReactNode
  zoom: number
  onZoom: (amount: number) => void
}

// The map itself is drawn by MapLibre into the container, so this only holds its frame and controls
export function MapPanel({ containerRef, mapLocked, onToggleLock, mapMode, onMapMode, legend, zoom, onZoom }: MapPanelProps) {
  return (
    <section className="panel map-panel">
      <div className="map-panel-head">
        <h2 className="section-title">Selected scenario</h2>
        <button
          type="button"
          className="map-lock"
          aria-pressed={mapLocked}
          aria-label="Lock the map to this study region"
          title={mapLocked ? 'Map locked to this study region. Select to unlock' : 'Lock the map to this study region'}
          onClick={onToggleLock}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d={mapLocked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-2'} />
          </svg>
        </button>
        <div className="segments map-mode" role="group" aria-label="Map view">
          {MAP_MODES.map(({ id, label }) => (
            <button key={id} type="button" className="segment" aria-pressed={mapMode === id} onClick={() => onMapMode(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="map" ref={containerRef} role="region" aria-label="Flood map" />
      {legend}
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
            onChange={(event) => onZoom(Number(event.target.value))}
          />
          <select aria-label="Zoom amount" value={zoom} onChange={(event) => onZoom(Number(event.target.value))}>
            {ZOOM_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}×
              </option>
            ))}
          </select>
          <button type="button" className="zoom-reset" disabled={zoom === 1} onClick={() => onZoom(1)}>
            Reset
          </button>
        </div>
      </div>
    </section>
  )
}
