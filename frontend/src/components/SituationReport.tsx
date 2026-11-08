import { findFeature, findFocusLevel, focusStatus, isFloodedAt, observedFloodName } from '../analysis'
import { KIND_INFO, KINDS } from '../constants'
import { formatArea, formatBbox, formatCount, formatTime } from '../format'
import { BHUVAN_ATTRIBUTION } from '../map/config'
import type { Alert, Feature, Kind, Location, LocationData, Properties, ReportInfo } from '../types'
import { AiSummary } from './AiSummary'
import { KindTag, Table } from './common'
import { FloodReportSource, FloodTimeline } from './FloodTimeline'
import { MapLegend } from './MapLegend'
import { CensusVillages, FloodedLandUse, ModelCheck, RoadCheck, ScenarioTable } from './ReportSections'

const RAIN_READINGS = [
  ['Rain, next 24 hours', 'rain_next_24h_mm'],
  ['Rain, next 72 hours', 'rain_next_72h_mm'],
  ['Rain, past 7 days', 'rain_past_7d_mm'],
]

type SituationReportProps = LocationData & {
  info: ReportInfo
  location: Location
  rise: number
  scenarios: Feature[]
  selected: Feature
  alert?: Alert
  onBack: () => void
}

export function SituationReport(props: SituationReportProps) {
  const { info, location, rise, scenarios, selected, alert, onBack } = props
  const { settlements, villages, landUse, routes, modelCheck, floodReports, layers } = props
  const places = settlements?.features ?? []
  const focusLevel = findFocusLevel(settlements, location.focus)
  const affectedCount = places.filter((place) => isFloodedAt(place, rise)).length
  const levels = scenarios
    .map((scenario) => Number(scenario.properties.rise_m))
    .filter((level) => level <= rise)
  const gauge = findFeature(layers.observed, 'level_m')
  const rain = findFeature(layers.forecast, 'rain_next_24h_mm')
  const flow = findFeature(layers.forecast, 'flow_peak_next_7d_m3s')
  const readings: { kind: Kind; measure: string; value: string; properties?: Properties }[] = [
    {
      kind: 'observed',
      measure: `River level near ${location.focus}`,
      value: gauge?.level_m != null ? `${gauge.level_m} m, a past reading` : 'Pending: no gauge connected yet',
      properties: gauge,
    },
    ...RAIN_READINGS.map(([measure, field]) => ({
      kind: 'forecast' as const,
      measure,
      value: rain?.[field] != null ? `${rain[field]} mm` : 'Pending',
      properties: rain,
    })),
    {
      kind: 'forecast',
      measure: 'River flow, highest in next 7 days',
      value:
        flow?.flow_peak_next_7d_m3s != null
          ? `${formatCount(flow.flow_peak_next_7d_m3s)} m³/s (2026 monsoon peak: ${formatCount(flow.monsoon_peak_2026_m3s)} m³/s on ${flow.monsoon_peak_date})`
          : 'Pending',
      properties: flow,
    },
    {
      kind: 'simulated',
      measure: `Flooded land at +${rise} m`,
      value: formatArea(selected.properties.flooded_area_km2),
      properties: selected.properties,
    },
  ]

  return (
    <article className="panel report">
      <div className="report-actions">
        <button type="button" className="primary" onClick={() => window.print()}>
          Print or save as PDF
        </button>
        <button type="button" className="secondary" onClick={onBack}>
          Back to Scenario Analysis
        </button>
      </div>

      <p className="report-banner">
        <strong>Demonstration only.</strong> This is a simulated scenario and not an official
        warning. An officer must check it before any use.
      </p>

      <dl className="details">
        <dt>Location</dt>
        <dd>{location.label}</dd>
        <dt>Bounding box</dt>
        <dd>{formatBbox(location.bbox)}</dd>
        <dt>Scenario</dt>
        <dd>+{rise} m river rise</dd>
        <dt>Generated</dt>
        <dd>{formatTime(info.generatedAt)}</dd>
      </dl>

      <h2 className="section-title">Summary</h2>
      <AiSummary locationId={location.id} rise={rise} />
      <p className="report-text">
        If rivers stood {rise} m above the water surface in the terrain data, the model estimates
        about {formatArea(selected.properties.flooded_area_km2)} of flooded land in the{' '}
        {location.name} map area, reaching {affectedCount} of {places.length} settlements mapped in
        OpenStreetMap.{' '}
        {focusLevel === undefined
          ? `${location.focus} is not in the mapped settlement data.`
          : `${location.focus} is ${focusStatus(focusLevel, rise).toLowerCase()} in this scenario${
              focusLevel === null ? '' : `; the model floods it from +${focusLevel} m`
            }.`}
      </p>
      <p className="report-text">
        This report gives no evacuation or response advice, because the model has only been compared
        with limited satellite data, not field records.
      </p>

      <h2 className="section-title">Map</h2>
      {info.mapImage ? (
        <figure className="report-map">
          <img src={info.mapImage} alt={`Map of the +${rise} m flood scenario in the ${location.name} area`} />
          <MapLegend
            kinds={KINDS.filter((kind) => info.layersShown.includes(KIND_INFO[kind].label))}
            heat={info.mapMode === 'heat'}
            rise={rise}
            focus={location.focus}
            villages={villages}
            routes={routes}
            observedFlood={observedFloodName(layers)}
            hasGauge={gauge?.level_m != null}
          />
          <figcaption className="note">
            Map view when this report was generated. Layers shown:{' '}
            {info.layersShown.join(', ') || 'none'}.{' '}
            {info.mapMode === 'satellite' && `${BHUVAN_ATTRIBUTION}. `}Map data © OpenStreetMap
            contributors.
          </figcaption>
        </figure>
      ) : (
        <p className="empty">Map image not available</p>
      )}

      <h2 className="section-title">Readings by data type</h2>
      <Table columns={['Type', 'Measure', 'Value', 'Time', 'Source', 'Quality']}>
        {readings.map(({ kind, measure, value, properties }) => (
          <tr key={measure}>
            <td>
              <KindTag kind={kind} />
            </td>
            <td>{measure}</td>
            <td>
              <strong>{value}</strong>
            </td>
            <td>{properties ? formatTime(properties.timestamp) : 'Not available'}</td>
            <td>{properties?.source ?? 'Not available'}</td>
            <td>{properties?.quality ?? 'Not available'}</td>
          </tr>
        ))}
      </Table>

      <h2 className="section-title">Settlements by first flood level</h2>
      <Table columns={['First floods at', 'Count', 'Settlements']}>
        {levels.map((level) => {
          const names = places
            .filter((place) => place.properties.first_flooded_at_m === level)
            .map((place) => String(place.properties.name))
            .sort()
          return (
            <tr key={level}>
              <td>+{level} m</td>
              <td>{names.length}</td>
              <td>{names.join(', ') || 'None'}</td>
            </tr>
          )
        })}
      </Table>
      <p className="note">
        Counts only cover places mapped in OpenStreetMap, so the real number will be higher.
      </p>

      <h2 className="section-title">Census villages with flooded land</h2>
      <CensusVillages villages={villages} rise={rise} printable />

      <h2 className="section-title">Land use in the flood area</h2>
      <FloodedLandUse landUse={landUse} rise={rise} />

      <h2 className="section-title">Roads in the flood area</h2>
      <RoadCheck routes={routes} rise={rise} />

      <h2 className="section-title">Model check against a real flood</h2>
      <ModelCheck check={modelCheck} />

      <h2 className="section-title">Official flood reports, July 2026</h2>
      <FloodTimeline reports={floodReports} radarDate={modelCheck?.image_date} />
      {floodReports?.source && <FloodReportSource reports={floodReports} />}

      <h2 className="section-title">All scenarios</h2>
      <ScenarioTable scenarios={scenarios} selected={selected} />

      <h2 className="section-title">Alert status</h2>
      <p className="report-text">
        {alert
          ? `Demo alert logged ${formatTime(alert.created_at)} for ${alert.settlements.length} settlements. ${alert.channel}.`
          : 'No demo alert has been logged for this scenario.'}
      </p>
    </article>
  )
}
