import type { CSSProperties } from 'react'
import { floodReportSummary, summariseVillages, type FocusSummary } from '../analysis'
import { ALERT_PREVIEW_COUNT, KIND_INFO, TOGGLE_KINDS } from '../constants'
import { formatArea, formatCount, formatTime } from '../format'
import type { Alert, Feature, FloodReports, Kind, Layer, Location, Properties } from '../types'
import { Readout, Swatch } from './common'

// The parts of the Scenario parameters panel, top to bottom

type LocationSwitchProps = { locations: Location[]; selectedId: string | null; onSelect: (id: string) => void }

export function LocationSwitch({ locations, selectedId, onSelect }: LocationSwitchProps) {
  const style = {
    '--count': locations.length,
    '--index': locations.findIndex((location) => location.id === selectedId),
  } as CSSProperties
  return (
    <div className="location-switch" role="group" aria-label="Study region" style={style}>
      <span className="location-indicator" aria-hidden="true" />
      {locations.map((location) => (
        <button
          key={location.id}
          type="button"
          className="location-button"
          aria-pressed={location.id === selectedId}
          onClick={() => onSelect(location.id)}
        >
          {location.name}
        </button>
      ))}
    </div>
  )
}

type LayerTogglesProps = { visible: Record<Kind, boolean>; onToggle: (kind: Kind) => void }

export function LayerToggles({ visible, onToggle }: LayerTogglesProps) {
  return (
    <>
      <span className="field-label">Layers shown on map</span>
      <div className="segments">
        {TOGGLE_KINDS.map((kind) => (
          <button key={kind} type="button" className="segment" aria-pressed={visible[kind]} onClick={() => onToggle(kind)}>
            <Swatch color={KIND_INFO[kind].color} />
            {KIND_INFO[kind].label}
          </button>
        ))}
      </div>
    </>
  )
}

type ScenarioReadoutsProps = {
  focus: FocusSummary
  rise: number
  selected?: Feature
  gauge?: Properties
  floodReports: FloodReports | null
  villages: Layer | null
}

export function ScenarioReadouts({ focus, rise, selected, gauge, floodReports, villages }: ScenarioReadoutsProps) {
  const villageSummary = summariseVillages(villages, rise)
  return (
    <div className="fields">
      <Readout kind="simulated" label={`${focus.name} at +${rise} m`} value={focus.status} detail={focus.detail} />
      <Readout
        kind="simulated"
        label={`Flooded land at +${rise} m`}
        value={selected ? formatArea(selected.properties.flooded_area_km2) : 'No data'}
      />
      <Readout wide kind="observed" label="Official flood reports, July 2026" {...floodReportSummary(floodReports)} />
      <Readout
        wide
        kind="observed"
        label={`River level near ${focus.name}`}
        value={gauge?.level_m != null ? `${gauge.level_m} m` : 'Pending'}
        detail={
          gauge?.level_m != null
            ? `${gauge.name}, ${formatTime(gauge.timestamp)}. A past reading, not live${
                gauge.danger_level_m != null ? `. Danger level ${gauge.danger_level_m} m` : ''
              }${gauge.warning_level_m != null ? `. Warning level ${gauge.warning_level_m} m` : ''}`
            : 'No live gauge connected'
        }
      />
      <Readout
        wide
        kind="simulated"
        label={`People in census villages with flooded land at +${rise} m`}
        value={villages?.features.length ? formatCount(villageSummary.people) : 'Not available'}
        detail={
          villages?.features.length
            ? `From ${villageSummary.reached.length - villageSummary.missingCounts} of ${villageSummary.reached.length} villages with a census figure, so the real total is higher. 2001 census, whole village population, not people flooded`
            : 'No census village data for this location yet'
        }
      />
    </div>
  )
}

type RiseControlProps = {
  rise: number
  riseValues: number[]
  playing: boolean
  onRise: (rise: number) => void
  onTogglePlay: () => void
}

export function RiseControl({ rise, riseValues, playing, onRise, onTogglePlay }: RiseControlProps) {
  const lowest = Math.min(...riseValues)
  const highest = Math.max(...riseValues)
  return (
    <>
      <label className="field-label" htmlFor="rise">
        River rise: <strong>+{rise} m</strong>
      </label>
      <div className="rise-row">
        <input
          id="rise"
          type="range"
          min={lowest}
          max={highest}
          step={1}
          value={rise}
          onChange={(event) => onRise(Number(event.target.value))}
        />
        <button
          type="button"
          className="rise-play"
          aria-pressed={playing}
          aria-label={playing ? 'Pause river rise' : 'Play river rise'}
          title={playing ? 'Pause' : `Play +${lowest} m to +${highest} m`}
          onClick={onTogglePlay}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            {playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4l13 8-13 8z" />}
          </svg>
        </button>
      </div>
    </>
  )
}

type AlertBlockProps = {
  rise: number
  affected: string[]
  sending: boolean
  error: string | null
  latestAlert?: Alert
  onLog: () => void
  onViewLog: () => void
}

export function AlertBlock({ rise, affected, sending, error, latestAlert, onLog, onViewLog }: AlertBlockProps) {
  return (
    <div className="alert-block">
      <span className="field-label">Alert for this scenario</span>
      {affected.length > 0 ? (
        <>
          <p className="alert-preview">
            <strong>Simulated scenario, +{rise} m:</strong>{' '}
            {affected.slice(0, ALERT_PREVIEW_COUNT).join(', ')}
            {affected.length > ALERT_PREVIEW_COUNT && ` and ${affected.length - ALERT_PREVIEW_COUNT} more`}{' '}
            may be affected. An officer must check this before any warning goes out.
          </p>
          <button type="button" className="primary" onClick={onLog} disabled={sending}>
            {sending ? 'Logging...' : 'Approve and log demo alert'}
          </button>
          <p className="note">Demo only: this is logged here and not sent to anyone.</p>
        </>
      ) : (
        <p className="empty">No settlements affected in this scenario</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {latestAlert && (
        <p className="note">
          Last logged {formatTime(latestAlert.created_at)}.{' '}
          <button type="button" className="link" onClick={onViewLog}>
            View alert log
          </button>
        </p>
      )}
    </div>
  )
}
