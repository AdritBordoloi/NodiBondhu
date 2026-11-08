import { summariseVillages } from '../analysis'
import { KIND_INFO } from '../constants'
import { formatCount, formatPercent } from '../format'
import type { ChartBar, Feature, LandUse, Layer, ModelCheckResult } from '../types'
import { ChartTile, ColumnChart } from './charts'

type ScenarioChartsProps = {
  scenarios: Feature[]
  rise: number
  villages: Layer | null
  landUse: LandUse | null
  check: ModelCheckResult | null
}

export function ScenarioCharts({ scenarios, rise, villages, landUse, check }: ScenarioChartsProps) {
  const last = scenarios.length - 1
  // One bar per scenario, with the chosen rise strong and the highest labelled
  const riseBars = (value: (riseM: number, scenario: Feature) => number, shown: (value: number) => string) =>
    scenarios.map((scenario, index): ChartBar => {
      const riseM = Number(scenario.properties.rise_m)
      const amount = value(riseM, scenario)
      return {
        label: `+${riseM} m`,
        value: amount,
        shown: shown(amount),
        highlight: riseM === rise,
        labelled: index === last,
      }
    })
  const flooded = riseBars(
    (_, scenario) => Number(scenario.properties.flooded_area_km2),
    (area) => `${Math.round(area).toLocaleString('en-IN')} km²`,
  )
  const people = riseBars((riseM) => summariseVillages(villages, riseM).people, formatCount)
  const atRise = (bars: ChartBar[]) => {
    const selected = bars.find((bar) => bar.highlight)
    return selected ? `${selected.shown} at +${rise} m` : 'No data'
  }
  const land = landUse?.scenarios?.find((item) => item.rise_m === rise)?.land_types ?? []
  const ranked = [...land].sort((a, b) => b.share - a.share)
  const largestShare = ranked[0]?.share ?? 0
  const overlaps = check?.scenarios ?? []
  const best = overlaps.find((item) => item.rise_m === check?.best_rise_m)
  return (
    <div className="chart-grid">
      <ChartTile title="Flooded land" headline={atRise(flooded)} note="Simulated. Higher rises are likely too large.">
        <ColumnChart bars={flooded} kind="simulated" />
      </ChartTile>
      <ChartTile
        title="People in villages with flooded land"
        headline={atRise(people)}
        note="2001 census, whole villages, not people flooded. Villages with no figure are left out."
      >
        <ColumnChart bars={people} kind="simulated" />
      </ChartTile>
      <ChartTile
        title={`Flooded land use at +${rise} m`}
        headline={ranked[0] ? `Mostly ${ranked[0].name.toLowerCase()}, ${formatPercent(largestShare)}` : 'No data'}
        note={ranked.length ? 'Estimated from sampled squares.' : 'Not available for this region yet.'}
      >
        <div className="chart-rows">
          {ranked.map((item) => (
            <div
              className="chart-row"
              key={item.name}
              data-tip={`About ${Math.round(item.flooded_km2).toLocaleString('en-IN')} km²`}
            >
              <span className="chart-row-name">{item.name}</span>
              <span className="chart-track">
                <span
                  className="chart-row-bar"
                  style={{
                    width: `${largestShare > 0 ? (item.share / largestShare) * 100 : 0}%`,
                    background: KIND_INFO.simulated.color,
                  }}
                />
              </span>
              <span className="chart-row-value">{Math.round(item.share * 100)}%</span>
            </div>
          ))}
        </div>
      </ChartTile>
      <ChartTile
        title="Match with radar flood"
        headline={best ? `Closest +${best.rise_m} m, ${formatPercent(best.overlap_score)} overlap` : 'No data'}
        note={best ? `Sentinel-1, ${check?.image_date}. Only a partial match.` : 'No radar check for this region yet.'}
      >
        <ColumnChart
          bars={overlaps.map((item) => ({
            label: `+${item.rise_m} m`,
            value: item.overlap_score,
            shown: formatPercent(item.overlap_score),
            highlight: item.rise_m === check?.best_rise_m,
          }))}
          kind="observed"
        />
      </ChartTile>
    </div>
  )
}
