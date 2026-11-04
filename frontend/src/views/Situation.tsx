import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import FloodMap from '../components/FloodMap'
import {
  IconArea,
  IconBoundary,
  IconChevron,
  IconCloudRain,
  IconDroplet,
  IconExpand,
  IconPause,
  IconPlay,
  IconReset,
  IconSearch,
  IconVillage,
  IconWaves,
} from '../components/Icons'
import { Chip, Empty, StatTile, Switch, Tabs } from '../components/ui'
import { LevelBars } from '../components/charts'
import {
  SEVERITY_INFO,
  formatArea,
  formatClock,
  formatNumber,
  percentOfPilot,
  pilotStatus,
  severityFor,
  type Dataset,
  type Layer,
  type Place,
  type Scenario,
} from '../lib/domain'

type LayerKey = 'observed' | 'forecast' | 'simulated' | 'places' | 'boundary'

type Props = {
  dataset: Dataset | null
  scenarios: Scenario[]
  places: Place[]
  rise: number
  setRise: Dispatch<SetStateAction<number>>
  visible: Record<LayerKey, boolean>
  setVisible: (next: Record<LayerKey, boolean>) => void
  expanded: boolean
  setExpanded: (next: boolean) => void
  focus: Place | null
  setFocus: (place: Place | null) => void
  onMapReady: (map: MapLibreMap | null) => void
}

const DEFAULT_VISIBLE: Record<LayerKey, boolean> = {
  observed: true,
  forecast: true,
  simulated: true,
  places: true,
  boundary: true,
}

const LEGEND_RULE = {
  severe: '2 m or more above first-flood level',
  moderate: '1 m or more above',
  watch: 'at or just above',
} as const

export default function Situation({
  dataset,
  scenarios,
  places,
  rise,
  setRise,
  visible,
  setVisible,
  expanded,
  setExpanded,
  focus,
  setFocus,
  onMapReady,
}: Props) {
  const [tab, setTab] = useState<'places' | 'levels'>('places')
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState(false)
  const [basemap, setBasemap] = useState<'imagery' | 'dark'>('imagery')
  const totalMapped = dataset?.settlements?.features.length ?? places.length

  const scenario = scenarios.find((item) => item.rise === rise)
  const riseValues = scenarios.map((item) => item.rise)
  const minRise = riseValues.length ? Math.min(...riseValues) : 1
  const maxRise = riseValues.length ? Math.max(...riseValues) : 6
  const status = pilotStatus(dataset?.settlements ?? null, rise)
  const rain = dataset?.layers.forecast?.features[0]?.properties
  const affected = places.filter((place) => place.level <= rise)
  const filtered = places
    .filter((place) => place.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => {
      const aAffected = a.level <= rise ? 0 : 1
      const bAffected = b.level <= rise ? 0 : 1
      return aAffected - bAffected || a.level - b.level || a.name.localeCompare(b.name)
    })

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setRise((current) => (current >= maxRise ? minRise : current + 1))
    }, 1200)
    return () => window.clearInterval(timer)
  }, [playing, maxRise, minRise, setRise])

  const simulatedGeo = useMemo<Layer>(
    () => ({
      type: 'FeatureCollection',
      features: scenario ? [scenario.feature] : [],
    }),
    [scenario],
  )

  const placesGeo = useMemo<Layer>(
    () => ({
      type: 'FeatureCollection',
      features: places.map((place) => ({
        ...place.feature,
        properties: {
          ...place.feature.properties,
          level: place.level,
          state: severityFor(place, rise),
        },
      })),
    }),
    [places, rise],
  )

  const resetLayers = () => setVisible({ ...DEFAULT_VISIBLE })

  return (
    <div className={`situation ${expanded ? 'is-expanded' : ''}`}>
      <aside className="rail rail-left" aria-label="Map layers and scenario">
        <div className="rail-head">
          <span>Map layers</span>
          <button type="button" className="icon-button" onClick={resetLayers} title="Reset layers">
            <IconReset size={15} />
          </button>
        </div>
        <div className="rail-scroll">
          <div className="basemap-switch" role="group" aria-label="Basemap">
            <button
              type="button"
              className={basemap === 'imagery' ? 'is-active' : ''}
              onClick={() => setBasemap('imagery')}
            >
              Imagery
            </button>
            <button
              type="button"
              className={basemap === 'dark' ? 'is-active' : ''}
              onClick={() => setBasemap('dark')}
            >
              Dark canvas
            </button>
          </div>
          <Switch
            label="Flood extent"
            hint="HAND terrain model"
            checked={visible.simulated}
            onChange={(next) => setVisible({ ...visible, simulated: next })}
            icon={<IconWaves size={16} />}
          />
          <Switch
            label="Observed points"
            hint="Ground and satellite"
            checked={visible.observed}
            onChange={(next) => setVisible({ ...visible, observed: next })}
            icon={<IconDroplet size={16} />}
          />
          <Switch
            label="Rain forecast"
            hint="Open-Meteo, 72 h"
            checked={visible.forecast}
            onChange={(next) => setVisible({ ...visible, forecast: next })}
            icon={<IconCloudRain size={16} />}
          />
          <Switch
            label="Places"
            hint={`${formatNumber(totalMapped)} mapped in OSM`}
            checked={visible.places}
            onChange={(next) => setVisible({ ...visible, places: next })}
            icon={<IconVillage size={16} />}
          />
          <Switch
            label="Pilot boundary"
            hint="60 × 60 km window"
            checked={visible.boundary}
            onChange={(next) => setVisible({ ...visible, boundary: next })}
            icon={<IconBoundary size={16} />}
          />

          <div className="rail-divider" />

          <div className="rail-head">
            <span>Scenario rise</span>
            <span className="rail-badge">SIM</span>
          </div>
          <div className="rise-readout">
            <button
              type="button"
              className="step-button"
              onClick={() => setRise((current) => Math.max(minRise, current - 1))}
              aria-label="Decrease river rise"
            >
              −
            </button>
            <div className="rise-value">
              +{rise}
              <span>m</span>
            </div>
            <button
              type="button"
              className="step-button"
              onClick={() => setRise((current) => Math.min(maxRise, current + 1))}
              aria-label="Increase river rise"
            >
              +
            </button>
          </div>
          <input
            className="rise-slider"
            type="range"
            min={minRise}
            max={maxRise}
            step={1}
            value={rise}
            aria-label="River rise in metres"
            onChange={(event) => setRise(Number(event.target.value))}
            style={{
              backgroundSize: `${((rise - minRise) / Math.max(1, maxRise - minRise)) * 100}% 100%`,
            }}
          />
          <div className="rise-ticks">
            {scenarios.map((item) => (
              <button
                key={item.rise}
                type="button"
                className={item.rise === rise ? 'is-active' : ''}
                onClick={() => setRise(item.rise)}
              >
                +{item.rise}
              </button>
            ))}
          </div>

          <div className="rail-divider" />

          <div className="rail-head">
            <span>Legend</span>
          </div>
          <ul className="legend">
            <li>
              <span className="legend-swatch is-water" />
              Simulated flood extent, +{rise} m
            </li>
            {(Object.keys(SEVERITY_INFO) as (keyof typeof SEVERITY_INFO)[]).map((key) => (
              <li key={key}>
                <span className="legend-dot" style={{ background: SEVERITY_INFO[key].color }} />
                {SEVERITY_INFO[key].label} · {LEGEND_RULE[key]}
              </li>
            ))}
            <li>
              <span className="legend-line" />
              Pilot boundary
            </li>
          </ul>
        </div>
      </aside>

      <div className="map-shell">
        <FloodMap
          simulated={simulatedGeo}
          places={placesGeo}
          observed={dataset?.layers.observed ?? null}
          forecast={dataset?.layers.forecast ?? null}
          visible={visible}
          expanded={expanded}
          basemap={basemap}
          focus={focus}
          onReady={onMapReady}
        />

        <div className="map-kpis">
          <StatTile
            label="Flooded area"
            value={formatArea(scenario?.area ?? 0)}
            sub={`${percentOfPilot(scenario?.area ?? 0).toFixed(0)}% of pilot window`}
            tone="accent"
            icon={<IconArea size={14} />}
          />
          <StatTile
            label="Places in extent"
            value={formatNumber(affected.length)}
            unit={`of ${places.length}`}
            sub={`${formatNumber(affected.filter((p) => p.level === rise).length)} newly reached · ${formatNumber(
              totalMapped,
            )} mapped`}
            icon={<IconVillage size={14} />}
          />
          <StatTile
            label="Simaluguri"
            value={status.flooded ? 'Flooded' : 'Dry'}
            sub={status.level != null ? `model floods it from +${status.level} m` : 'not modelled'}
            tone={status.flooded ? 'danger' : 'ok'}
            icon={<IconDroplet size={14} />}
          />
          <StatTile
            label="Rain next 24 h"
            value={rain?.rain_next_24h_mm != null ? `${rain.rain_next_24h_mm} mm` : '—'}
            sub={rain?.rain_next_72h_mm != null ? `${rain.rain_next_72h_mm} mm over 72 h` : 'no forecast yet'}
            tone="warn"
            icon={<IconCloudRain size={14} />}
          />
        </div>

        <div className="map-tools">
          <button
            type="button"
            className="icon-button is-glass"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Show side panels' : 'Full view'}
          >
            <IconExpand size={16} />
          </button>
        </div>

        <div className="map-foot">
          <Chip tone="warn" dot>
            Screening estimate · not validated against a real flood
          </Chip>
          <span className="map-credit">
            Imagery © Esri, Maxar · terrain: Copernicus DEM GLO-30 · places: OpenStreetMap
          </span>
        </div>
      </div>

      <aside className="rail rail-right" aria-label="Places and scenario levels">
        <Tabs
          tabs={[
            { id: 'places', label: 'Places', count: affected.length },
            { id: 'levels', label: 'Levels', count: scenarios.length },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === 'places' ? (
          <>
            <div className="search">
              <IconSearch size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search a place"
                aria-label="Search places"
              />
            </div>
            <div className="list-head">
              <span>{formatNumber(filtered.length)} places</span>
              <span>First flood level</span>
            </div>
            <div className="list">
              {filtered.length === 0 && <Empty title="No place matches" hint="Try a shorter search." />}
              {filtered.map((place) => {
                const severity = severityFor(place, rise)
                const inExtent = place.level <= rise
                return (
                  <button
                    key={`${place.name}-${place.coordinates.join(',')}`}
                    type="button"
                    className={`place-row ${inExtent ? 'is-affected' : ''} ${
                      focus?.name === place.name ? 'is-focus' : ''
                    }`}
                    onClick={() => setFocus(place)}
                  >
                    <span
                      className="place-dot"
                      style={{ background: inExtent ? SEVERITY_INFO[severity].color : 'var(--line-2)' }}
                    />
                    <span className="place-main">
                      <span className="place-name">{place.name}</span>
                      <span className="place-meta">
                        {inExtent ? `${SEVERITY_INFO[severity].label} · ${rise - place.level} m above threshold` : 'outside extent'}
                      </span>
                    </span>
                    <span className="place-level">+{place.level}</span>
                    <IconChevron size={13} />
                  </button>
                )
              })}
            </div>
            <p className="rail-note">
              Only places mapped in OpenStreetMap are counted, so real numbers will be higher.
            </p>
          </>
        ) : (
          <div className="level-panel">
            <div className="level-list">
              {scenarios.map((item) => (
                <button
                  key={item.rise}
                  type="button"
                  className={`level-row ${item.rise === rise ? 'is-active' : ''}`}
                  onClick={() => setRise(item.rise)}
                >
                  <span className="level-name">+{item.rise} m</span>
                  <span className="level-area">{formatArea(item.area)}</span>
                  <span className="level-count">{item.affected} places</span>
                </button>
              ))}
            </div>
            <div className="panel-inset">
              <span className="field-label">Places reached by level</span>
              <LevelBars scenarios={scenarios} rise={rise} onSelect={setRise} />
            </div>
            <p className="rail-note">
              Every level is a separate pre-computed HAND run over the same terrain window. The model ignores
              embankments, flow and timing.
            </p>
          </div>
        )}
      </aside>

      <div className="timeline">
        <button
          type="button"
          className={`play-button ${playing ? 'is-playing' : ''}`}
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? 'Pause scenario playback' : 'Play through scenario levels'}
        >
          {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
        </button>
        <div className="timeline-body">
          <div className="timeline-labels">
            {scenarios.map((item) => (
              <button
                key={item.rise}
                type="button"
                className={item.rise === rise ? 'is-active' : ''}
                onClick={() => {
                  setPlaying(false)
                  setRise(item.rise)
                }}
              >
                <span>+{item.rise} m</span>
                <span className="timeline-sub">{formatNumber(item.affected)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="timeline-meta">
          <span className="timeline-clock">
            Model run {formatClock(dataset?.layers.simulated?.features[0]?.properties.timestamp)}
          </span>
          <span className="timeline-note">HAND · {formatArea(scenario?.area ?? 0)} at current level</span>
        </div>
      </div>
    </div>
  )
}
