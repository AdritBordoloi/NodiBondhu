import type { ReactNode } from 'react'
import { CHART_TINT, KIND_INFO } from '../constants'
import type { ChartBar } from '../types'

// Ordered bars: the chosen one is strong and the rest are a tint of the same colour
export function ColumnChart({ bars, kind }: { bars: ChartBar[]; kind: keyof typeof CHART_TINT }) {
  const largest = Math.max(...bars.map((bar) => bar.value), 0)
  const height = (value: number) => (largest > 0 ? (value / largest) * 100 : 0)
  return (
    <div className="chart-columns" role="img" aria-label={bars.map((bar) => `${bar.label}: ${bar.shown}`).join(', ')}>
      {bars.map((bar) => (
        <div className="chart-column" key={bar.label} data-tip={`${bar.label}: ${bar.shown}`}>
          <div className="chart-plot">
            {(bar.highlight || bar.labelled) && (
              <span className="chart-value" style={{ bottom: `${height(bar.value)}%` }}>
                {bar.shown}
              </span>
            )}
            <span
              className="chart-bar"
              style={{
                height: `${height(bar.value)}%`,
                background: bar.highlight ? KIND_INFO[kind].color : CHART_TINT[kind],
              }}
            />
          </div>
          <span className={bar.highlight ? 'chart-axis chart-axis-strong' : 'chart-axis'}>
            {bar.label}
          </span>
        </div>
      ))}
    </div>
  )
}

type ChartTileProps = { title: string; headline: string; note: string; children: ReactNode }

export function ChartTile({ title, headline, note, children }: ChartTileProps) {
  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">{title}</span>
        <strong className="chart-headline">{headline}</strong>
      </figcaption>
      {children}
      <p className="chart-note">{note}</p>
    </figure>
  )
}
