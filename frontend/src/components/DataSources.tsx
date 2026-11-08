import { extraFields } from '../analysis'
import { CENSUS_DOT_COLOR, KIND_INFO, KINDS, RIVER_STATUS_LABEL, ROAD_FLOODED_COLOR, ROADS_TARGET, SELECTED_SCENARIO_TARGET } from '../constants'
import { formatCount, formatField, formatReachedAt, formatTime, reportDayName } from '../format'
import type { Feature, FloodReportDay, FloodReports, Kind, Layer, LocationData } from '../types'
import { DataPanel, Table } from './common'
import { FloodReportSource } from './FloodTimeline'
import { RoadCheck } from './ReportSections'

// Census counts shown for each village, after its name and tehsil
const CENSUS_COUNTS = [
  ['Population', 'population_2001'], ['Households', 'households_2001'], ['Male', 'male_2001'], ['Female', 'female_2001'],
  ['Scheduled caste', 'scheduled_caste_2001'], ['Scheduled tribe', 'scheduled_tribe_2001'], ['Literate', 'literate_2001'],
]

function FeatureCard({ feature, kind, targeted }: { feature: Feature; kind: Kind; targeted: boolean }) {
  const { properties } = feature
  return (
    <article className={targeted ? 'card map-target' : 'card'} style={{ borderLeftColor: KIND_INFO[kind].color }}>
      <h3>{properties.name}</h3>
      {extraFields(properties).map(([key, value]) => (
        <p key={key}>
          <strong>{formatField(key)}:</strong> {value ?? 'not available'}
        </p>
      ))}
      <p>
        <strong>Time:</strong> {formatTime(properties.timestamp)}
      </p>
      <p>
        <strong>Source:</strong> {properties.source}
      </p>
      <p>
        <strong>Quality:</strong> {properties.quality}
      </p>
    </article>
  )
}

function SettlementData({ settlements, mapTarget }: { settlements: Layer | null; mapTarget: string | null }) {
  const places = [...(settlements?.features ?? [])].sort((a, b) =>
    String(a.properties.name).localeCompare(String(b.properties.name)),
  )
  return (
    <DataPanel color={KIND_INFO.simulated.color} title="Mapped settlements">
      {places.length === 0 ? (
        <p className="empty">No data yet</p>
      ) : (
        <>
          <p className="note">
            Locations from OpenStreetMap, with the lowest scenario that reaches each one. Not
            reached only means the model did not reach this mapped point, not that the place is
            safe.
          </p>
          <Table columns={['Settlement', 'Type', 'First flooded at']}>
            {places.map((place, index) => {
              const name = String(place.properties.name)
              return (
                <tr
                  // Different places can share a name, and each gets marked when one is selected
                  key={`${name}-${index}`}
                  className={mapTarget === `settlement:${name}` ? 'map-target' : undefined}
                >
                  <td>{name}</td>
                  <td>{place.properties.place ?? 'Not known'}</td>
                  <td>{formatReachedAt(place.properties.first_flooded_at_m)}</td>
                </tr>
              )
            })}
          </Table>
        </>
      )}
    </DataPanel>
  )
}

type CensusDataProps = { villages: Layer | null; regionName: string; mapTarget: string | null; onBack: () => void }

function CensusData({ villages, regionName, mapTarget, onBack }: CensusDataProps) {
  const withFigure = (villages?.features ?? [])
    .filter((village) => village.properties.population_2001 !== null)
    .sort((a, b) => String(a.properties.name).localeCompare(String(b.properties.name)))
  const people = withFigure.reduce((total, village) => total + Number(village.properties.population_2001), 0)
  const first = withFigure[0]?.properties
  return (
    <DataPanel color={CENSUS_DOT_COLOR} title="Census villages">
      {withFigure.length === 0 ? (
        <p className="empty">Census village data is not available for {regionName} yet.</p>
      ) : (
        <>
          <p className="note">
            {withFigure.length} villages in the {regionName} area have a census figure, with{' '}
            {formatCount(people)} people in 2001. These are whole village populations, not people
            flooded, and villages with no reliable figure are left out.
          </p>
          <Table columns={['Village', 'Tehsil', ...CENSUS_COUNTS.map(([label]) => label), 'First flooded land at']}>
            {withFigure.map((village) => {
              const key = String(village.properties.village_key)
              return (
                <tr key={key} className={mapTarget === `village:${key}` ? 'map-target' : undefined}>
                  <td>{village.properties.name}</td>
                  <td>{village.properties.taluk ?? 'Not known'}</td>
                  {CENSUS_COUNTS.map(([label, field]) => (
                    <td key={label}>{formatCount(village.properties[field])}</td>
                  ))}
                  <td>{formatReachedAt(village.properties.first_flooded_at_m)}</td>
                </tr>
              )
            })}
          </Table>
          <p className="note">
            {first?.quality}. Source: {first?.source}.{' '}
            <button type="button" className="link" onClick={onBack}>
              Back to the map
            </button>
          </p>
        </>
      )}
    </DataPanel>
  )
}

function FloodReportData({ reports }: { reports: FloodReports | null }) {
  const days = reports?.days ?? []
  // A day where the area is not listed has no figures at all
  const missing = (day: FloodReportDay) => (day.villages === null ? 'Not listed' : 'No figure')
  return (
    <DataPanel color={KIND_INFO.observed.color} title="Official flood reports">
      {!reports || days.length === 0 ? (
        <p className="empty">Official flood reports are not available for this location yet.</p>
      ) : (
        <>
          <p className="note">
            Daily figures for {reports.area}, and {reports.gauge} status from the CWC bulletin quoted
            in each report.
          </p>
          <Table
            columns={['Date', 'Villages affected', 'People affected', 'Crop area submerged', 'River status', 'Report generated']}
          >
            {days.map((day) => (
              <tr key={day.date}>
                <td>{reportDayName(day.date)}</td>
                <td>{day.villages === null ? 'Not listed' : formatCount(day.villages)}</td>
                <td>{day.people !== null ? formatCount(day.people) : missing(day)}</td>
                <td>{day.crop_hectares !== null ? `${day.crop_hectares} ha` : missing(day)}</td>
                <td>{RIVER_STATUS_LABEL[day.river_status]}</td>
                <td>{day.report_generated ?? 'Not stated'}</td>
              </tr>
            ))}
          </Table>
          <FloodReportSource reports={reports} />
        </>
      )}
    </DataPanel>
  )
}

// Every dataset behind the map, in full. Clicking something on the map opens its place here
type DataSourcesProps = LocationData & {
  selected?: Feature
  hasError: boolean
  mapTarget: string | null
  rise: number
  regionName: string
  onBack: () => void
}

export function DataSources(props: DataSourcesProps) {
  const { layers, settlements, routes, floodReports, villages, selected, hasError, mapTarget, rise } = props
  return (
    <>
      {KINDS.map((kind) => {
        const info = KIND_INFO[kind]
        const features = kind === 'simulated' ? (selected ? [selected] : []) : (layers[kind]?.features ?? [])
        return (
          <DataPanel key={kind} color={info.color} title={info.label}>
            <p className="note">{info.help}</p>
            {features.length === 0 && !hasError && <p className="empty">No data yet</p>}
            {features.map((feature, index) => (
              <FeatureCard
                key={index}
                feature={feature}
                kind={kind}
                targeted={
                  mapTarget === `feature:${feature.properties.name}` ||
                  (kind === 'simulated' && mapTarget === SELECTED_SCENARIO_TARGET)
                }
              />
            ))}
          </DataPanel>
        )
      })}
      <SettlementData settlements={settlements} mapTarget={mapTarget} />
      <DataPanel color={ROAD_FLOODED_COLOR} title={<>Road routes at +{rise} m</>} targeted={mapTarget === ROADS_TARGET}>
        <RoadCheck routes={routes} rise={rise} />
      </DataPanel>
      <FloodReportData reports={floodReports} />
      <CensusData villages={villages} regionName={props.regionName} mapTarget={mapTarget} onBack={props.onBack} />
    </>
  )
}
