import { formatNumber, type Scenario } from '../lib/domain'

export function RiseChart({
  scenarios,
  rise,
  onSelect,
}: {
  scenarios: Scenario[]
  rise: number
  onSelect: (level: number) => void
}) {
  const width = 620
  const height = 240
  const pad = { top: 18, right: 16, bottom: 34, left: 54 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  if (scenarios.length < 2) return <p className="muted">Not enough scenarios to plot.</p>

  const maxArea = Math.max(...scenarios.map((s) => s.area)) * 1.08
  const x = (index: number) => pad.left + (index * innerW) / (scenarios.length - 1)
  const y = (area: number) => pad.top + innerH - (area / maxArea) * innerH
  const points = scenarios.map((scenario, index) => ({
    scenario,
    cx: x(index),
    cy: y(scenario.area),
  }))
  const line = points.map(({ cx, cy }) => `${cx.toFixed(1)},${cy.toFixed(1)}`).join(' ')
  const areaPath = `M${pad.left},${pad.top + innerH} L${line.replace(/ /g, ' L')} L${
    pad.left + innerW
  },${pad.top + innerH} Z`
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(maxArea * fraction))

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Flooded area by river rise">
      <defs>
        <linearGradient id="rise-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {ticks.map((tick) => {
        const ty = y(tick)
        return (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + innerW} y1={ty} y2={ty} className="chart-grid" />
            <text x={pad.left - 10} y={ty + 3.5} className="chart-tick" textAnchor="end">
              {formatNumber(tick)}
            </text>
          </g>
        )
      })}

      <path d={areaPath} fill="url(#rise-fill)" />
      <polyline points={line} className="chart-line" />

      {points.map(({ scenario, cx, cy }) => {
        const active = scenario.rise === rise
        return (
          <g
            key={scenario.rise}
            role="button"
            tabIndex={0}
            aria-label={`Select +${scenario.rise} metre scenario`}
            className={`chart-point ${active ? 'is-active' : ''}`}
            onClick={() => onSelect(scenario.rise)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(scenario.rise)
            }}
          >
            <circle cx={cx} cy={cy} r={active ? 12 : 9} className="chart-hit" />
            <circle cx={cx} cy={cy} r={active ? 4.6 : 3} className="chart-dot" />
            {active && <circle cx={cx} cy={cy} r={8} className="chart-halo" />}
            <text x={cx} y={height - 12} className="chart-tick" textAnchor="middle">
              +{scenario.rise} m
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function LevelBars({
  scenarios,
  rise,
  onSelect,
}: {
  scenarios: Scenario[]
  rise: number
  onSelect: (level: number) => void
}) {
  const max = Math.max(...scenarios.map((s) => s.affected), 1)
  return (
    <div className="level-bars">
      {scenarios.map((scenario) => {
        const active = scenario.rise === rise
        return (
          <button
            key={scenario.rise}
            type="button"
            className={`level-bar ${active ? 'is-active' : ''}`}
            onClick={() => onSelect(scenario.rise)}
            aria-pressed={active}
            title={`+${scenario.rise} m: ${scenario.affected} mapped places`}
          >
            <span className="level-bar-value">{scenario.affected}</span>
            <span className="level-bar-track">
              <span
                className="level-bar-fill"
                style={{ height: `${Math.max(6, (scenario.affected / max) * 100)}%` }}
              />
            </span>
            <span className="level-bar-label">+{scenario.rise}</span>
          </button>
        )
      })}
    </div>
  )
}
