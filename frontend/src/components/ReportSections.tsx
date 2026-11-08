import { floodedKm, isPartlyMapped, mainRoutes, summariseVillages } from '../analysis'
import { formatArea, formatCount, formatPercent } from '../format'
import type { Feature, LandUse, Layer, ModelCheckResult } from '../types'
import { Table } from './common'

// The sections below appear both under Scenario Analysis and in the Situation Report

export function CensusVillages({ villages, rise, printable = false }: { villages: Layer | null; rise: number; printable?: boolean }) {
  const quality = villages?.features[0]?.properties.quality
  const source = villages?.features[0]?.properties.source
  if (!villages?.features.length) {
    return <p className="empty">Census village data is not available for this location yet.</p>
  }
  const { reached, people, missingCounts } = summariseVillages(villages, rise)
  return (
    <>
      <p className="report-text">
        <strong>
          {reached.length} of {villages.features.length} mapped villages have flooded land at +
          {rise} m.
        </strong>{' '}
        {formatCount(people)} people lived in the {reached.length - missingCounts} with a census
        figure in 2001
        {missingCounts > 0 &&
          `. The other ${missingCounts} have no reliable figure, so the real total is higher`}
        . This is the whole village population, not the number of people flooded.
      </p>
      {reached.length > 0 && (
        <Table
          columns={['Village', 'Tehsil', 'First flooded land at', 'Population, 2001', 'Households, 2001']}
          wrapClassName={printable ? 'table-wrap' : 'table-wrap village-table'}
        >
          {reached.map((village) => (
            <tr key={`${village.properties.name}-${JSON.stringify(village.geometry)}`}>
              <td>{village.properties.name}</td>
              <td>{village.properties.taluk ?? 'Not known'}</td>
              <td>+{village.properties.first_flooded_at_m} m</td>
              <td>{formatCount(village.properties.population_2001)}</td>
              <td>{formatCount(village.properties.households_2001)}</td>
            </tr>
          ))}
        </Table>
      )}
      <p className="note">
        On the map, small blue dots are villages with flooded land and a census figure. Villages with
        no reliable figure are listed here but not drawn. {quality}. Source: {source}.
      </p>
    </>
  )
}

export function FloodedLandUse({ landUse, rise }: { landUse: LandUse | null; rise: number }) {
  const scenario = landUse?.scenarios?.find((item) => item.rise_m === rise)
  if (!scenario) {
    return <p className="empty">Land use estimates are not available for this location yet.</p>
  }
  const missing = landUse?.squares_without_data ?? 0
  return (
    <>
      <Table columns={['Land type', 'Estimated flooded area', 'Share']}>
        {scenario.land_types.map((item) => (
          <tr key={item.name}>
            <td>{item.name}</td>
            <td>about {Math.round(item.flooded_km2).toLocaleString('en-IN')} km²</td>
            <td>{Math.round(item.share * 100)}%</td>
          </tr>
        ))}
      </Table>
      <p className="note">
        {landUse?.quality}.{' '}
        {missing > 0 && `${missing} of ${landUse?.squares_checked} squares had no land use data. `}
        Source: {landUse?.source}.
      </p>
    </>
  )
}

export function RoadCheck({ routes, rise }: { routes: Layer | null; rise: number }) {
  const list = mainRoutes(routes)
  if (list.length === 0) {
    return <p className="empty">Road routes are not available for this location yet.</p>
  }
  const flooded = (route: Feature) => floodedKm(route, rise)
  return (
    <>
      <p className="report-text">
        <strong>
          {list.filter((route) => flooded(route) > 0).length} of {list.length} main routes pass
          through the flood area at +{rise} m.
        </strong>{' '}
        On the map, routes are white with a dot at each end, and the stretches in the flood area are
        red. Routes were only
        checked where the flood map covers them, so white outside that area does not mean dry.
      </p>
      <Table columns={['Route', 'Length', 'Flood map covers', <>In flood area at +{rise} m</>]}>
        {list.map((route) => (
          <tr key={String(route.properties.name)}>
            <td>{route.properties.name}</td>
            <td>about {route.properties.length_km} km</td>
            <td>{route.properties.mapped_km} km</td>
            <td>about {flooded(route)} km</td>
          </tr>
        ))}
      </Table>
      <p className="note">
        {list.some(isPartlyMapped) &&
          'Where the flood map covers only part of a route, the rest was not checked, so the real distance could be higher. '}
        {list[0].properties.quality}. Source: {list[0].properties.source}.
      </p>
    </>
  )
}

export function ModelCheck({ check }: { check: ModelCheckResult | null }) {
  const scenarios = check?.scenarios
  if (!scenarios?.length) {
    return <p className="empty">No radar check is available for this location yet.</p>
  }
  const best = scenarios.find((item) => item.rise_m === check?.best_rise_m)
  return (
    <>
      <p className="report-text">
        <strong>
          Sentinel-1 radar on {check?.image_date} saw about {check?.observed_km2} km² of water that was not
          there on {check?.compared_with}.
        </strong>{' '}
        The closest scenario is +{check?.best_rise_m} m
        {best && `, with ${formatPercent(best.overlap_score)} overlap`}. Event: {check?.event}.
        {check?.radar_coverage_share != null &&
          ` The radar images cover ${formatPercent(check.radar_coverage_share)} of this area, so the table only compares that part.`}
      </p>
      <Table columns={['Scenario', 'Model flood area', 'Radar flood inside the model', 'Model area radar saw as water', 'Overlap']}>
        {scenarios.map((item) => (
          <tr key={item.rise_m} className={item.rise_m === check?.best_rise_m ? 'selected' : undefined}>
            <td>+{item.rise_m} m</td>
            <td>{item.model_km2} km²</td>
            <td>{formatPercent(item.observed_inside_model_share)}</td>
            <td>{formatPercent(item.model_seen_by_radar_share)}</td>
            <td>{formatPercent(item.overlap_score)}</td>
          </tr>
        ))}
      </Table>
      <p className="note">
        Compared with radar from {check?.compared_with}. {check?.quality}. Source: {check?.source}.
      </p>
    </>
  )
}

export function ScenarioTable({ scenarios, selected }: { scenarios: Feature[]; selected?: Feature }) {
  return (
    <Table columns={['Rise', 'Flooded land', 'Settlements']}>
      {scenarios.map((scenario) => (
        <tr key={scenario.properties.rise_m} className={scenario === selected ? 'selected' : undefined}>
          <td>+{scenario.properties.rise_m} m</td>
          <td>{formatArea(scenario.properties.flooded_area_km2)}</td>
          <td>{scenario.properties.settlements_affected}</td>
        </tr>
      ))}
    </Table>
  )
}
