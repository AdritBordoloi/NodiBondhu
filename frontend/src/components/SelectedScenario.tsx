import type { FocusSummary } from '../analysis'
import { formatArea, formatBbox, formatTime } from '../format'
import type { Feature, Location, LocationData } from '../types'
import { CensusVillages, FloodedLandUse, ModelCheck, ScenarioTable } from './ReportSections'
import { ScenarioCharts } from './ScenarioCharts'

type SelectedScenarioProps = LocationData & {
  rise: number
  location?: Location
  scenarios: Feature[]
  selected?: Feature
  focus: FocusSummary
  affected: string[]
}

// The details panel under the map: key facts, charts, then the full tables
export function SelectedScenario(props: SelectedScenarioProps) {
  const { rise, location, scenarios, selected, focus, affected } = props
  const { settlements, villages, landUse, modelCheck } = props
  return (
    <section className="panel scenario-details">
      <h3 className="selected-name">
        +{rise} m river rise{location && `, ${location.name} map area`}
      </h3>
      <dl className="details">
        <dt>Bounding box</dt>
        <dd>{location ? formatBbox(location.bbox) : 'No data'}</dd>
        <dt>Flooded land</dt>
        <dd>{selected ? formatArea(selected.properties.flooded_area_km2) : 'No data'}</dd>
        <dt>{focus.name}</dt>
        <dd>
          {focus.status}
          {focus.detail && `. ${focus.detail}`}
        </dd>
        <dt>Settlements</dt>
        <dd>
          {settlements
            ? `${affected.length} of ${settlements.features.length} mapped: ${affected.join(', ') || 'none'}`
            : 'No data'}
        </dd>
        <dt>Model run</dt>
        <dd>{selected ? formatTime(selected.properties.timestamp) : 'No data'}</dd>
        <dt>Quality</dt>
        <dd>{selected?.properties.quality ?? 'No data'}</dd>
      </dl>

      <ScenarioCharts scenarios={scenarios} rise={rise} villages={villages} landUse={landUse} check={modelCheck} />

      <div className="chart-tables">
        <h2 className="section-title">Scenario comparison</h2>
        <ScenarioTable scenarios={scenarios} selected={selected} />
        <p className="note">
          Counts only cover places mapped in OpenStreetMap, so the real number will be higher.
        </p>

        <h2 className="section-title census-title">Model check against a real flood</h2>
        <ModelCheck check={modelCheck} />

        <h2 className="section-title census-title">Census villages with flooded land</h2>
        <CensusVillages villages={villages} rise={rise} />

        <h2 className="section-title census-title">Land use in the flood area</h2>
        <FloodedLandUse landUse={landUse} rise={rise} />
      </div>
    </section>
  )
}
