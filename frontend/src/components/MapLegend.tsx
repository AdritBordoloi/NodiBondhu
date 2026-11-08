import type { ReactNode } from 'react'
import { CENSUS_DOT_COLOR, KIND_INFO, OUTLINE_COLOR, ROAD_FLOODED_COLOR } from '../constants'
import type { Kind, Layer } from '../types'

const dot = (color: string, size = 8, stroke = '#ffffff') => (
  <span className="legend-dot" style={{ background: color, width: size, height: size, borderColor: stroke }} />
)
const line = (color: string) => <span className="legend-line" style={{ background: color }} />

type MapLegendProps = {
  heat?: boolean
  kinds: Kind[]
  rise: number
  focus: string
  villages: Layer | null
  routes: Layer | null
  observedFlood?: string
  hasGauge: boolean
}

export function MapLegend({ kinds, rise, focus, villages, routes, observedFlood, hasGauge, heat = false }: MapLegendProps) {
  const showSimulated = kinds.includes('simulated')
  const showRoutes = showSimulated && Boolean(routes?.features.length)
  const hasCensusDots = (villages?.features ?? []).some((village) => village.properties.population_2001 !== null)
  const items: { key: string; symbol: ReactNode; label: string; detail: string; show: boolean }[] = [
    { key: 'pin', symbol: <span className="legend-pin" />, label: focus, detail: `${focus} location`, show: true },
    { key: 'area', symbol: <span className="legend-box" />, label: 'Study area', detail: 'Area covered by these results', show: true },
    {
      key: 'flood',
      symbol: <span className="legend-fill" style={{ background: KIND_INFO.simulated.color }} />,
      label: `Flood, +${rise} m`,
      detail: `Flood area at +${rise} m`,
      show: showSimulated && !heat,
    },
    {
      key: 'heat',
      symbol: <span className="legend-ramp" />,
      label: 'Simulated flood-prone land: floods at +1 m (red) to +6 m (blue)',
      detail: 'The lowest river rise that floods the land in the model. Higher rises are likely too large',
      show: heat,
    },
    {
      key: 'radar',
      symbol: <span className="legend-fill" style={{ background: KIND_INFO.observed.color }} />,
      label: 'Flood seen by radar',
      detail: observedFlood ?? 'Flood seen by radar',
      show: kinds.includes('observed') && Boolean(observedFlood) && !heat,
    },
    {
      key: 'settlement',
      symbol: dot(KIND_INFO.simulated.color, 9),
      label: 'Flooded settlement',
      detail: 'Mapped settlement reached by flood',
      show: showSimulated,
    },
    {
      key: 'village',
      symbol: dot(CENSUS_DOT_COLOR, 7, OUTLINE_COLOR),
      label: 'Village, census figure',
      detail: 'Village with flooded land and a census figure',
      show: showSimulated && hasCensusDots,
    },
    { key: 'route', symbol: line('#ffffff'), label: 'Road route', detail: 'Main road route', show: showRoutes },
    {
      key: 'route-flooded',
      symbol: line(ROAD_FLOODED_COLOR),
      label: 'Flooded road',
      detail: 'Road stretch in flood area',
      show: showRoutes,
    },
    {
      key: 'route-end',
      symbol: dot('#ffffff', 8, OUTLINE_COLOR),
      label: 'Route end',
      detail: 'End of a road route',
      show: showRoutes,
    },
    {
      key: 'rain',
      symbol: dot(KIND_INFO.forecast.color, 10),
      label: 'Rain and river forecast',
      detail: 'Rain forecast point, and the river point used for flow',
      show: kinds.includes('forecast'),
    },
    {
      key: 'gauge',
      symbol: dot(KIND_INFO.observed.color, 10),
      label: 'River level reading',
      detail: 'A reported river level, not a live gauge',
      show: kinds.includes('observed') && hasGauge,
    },
  ]
  return (
    <ul className="legend" aria-label="Map legend">
      {items
        .filter((item) => item.show)
        .map((item) => (
          <li key={item.key} title={item.detail}>
            <span className="legend-swatch" aria-hidden="true">
              {item.symbol}
            </span>
            {item.label}
          </li>
        ))}
    </ul>
  )
}
