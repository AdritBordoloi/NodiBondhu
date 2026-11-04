import { IconReport } from '../components/Icons'
import { Chip, ViewHeader } from '../components/ui'
import {
  EAST,
  NORTH,
  SOUTH,
  WEST,
  formatArea,
  formatNumber,
  formatTime,
  type Alert,
  type Dataset,
  type Place,
  type Scenario,
} from '../lib/domain'

export type ReportInfo = {
  generatedAt: string
  mapImage: string | null
  layersShown: string[]
}

export default function Report({
  info,
  rise,
  scenarios,
  places,
  dataset,
  alerts,
  onPrint,
  onBack,
}: {
  info: ReportInfo | null
  rise: number
  scenarios: Scenario[]
  places: Place[]
  dataset: Dataset | null
  alerts: Alert[]
  onPrint: () => void
  onBack: () => void
}) {
  const scenario = scenarios.find((item) => item.rise === rise)
  const affected = places.filter((place) => place.level <= rise)
  const gauge = dataset?.layers.observed?.features[0]?.properties
  const rain = dataset?.layers.forecast?.features[0]?.properties
  const status = dataset?.settlements?.features.find((f) => f.properties.name === 'Simaluguri')?.properties
    .first_flooded_at_m
  const pilotFlooded = status != null && Number(status) <= rise
  const levels = scenarios.filter((item) => item.rise <= rise)
  const alert = alerts.find((item) => item.rise_m === rise)

  const readings = [
    {
      type: 'Observed',
      measure: 'River level near Simaluguri',
      value: gauge?.level_m != null ? `${gauge.level_m} m` : 'Pending: no gauge connected',
      time: gauge ? formatTime(gauge.timestamp) : 'Not available',
      source: gauge ? String(gauge.source) : 'Not available',
      quality: gauge ? String(gauge.quality) : 'Not available',
    },
    {
      type: 'Forecast',
      measure: 'Rain, next 24 hours',
      value: rain?.rain_next_24h_mm != null ? `${rain.rain_next_24h_mm} mm` : 'Pending',
      time: rain ? formatTime(rain.timestamp) : 'Not available',
      source: rain ? String(rain.source) : 'Not available',
      quality: rain ? String(rain.quality) : 'Not available',
    },
    {
      type: 'Forecast',
      measure: 'Rain, next 72 hours',
      value: rain?.rain_next_72h_mm != null ? `${rain.rain_next_72h_mm} mm` : 'Pending',
      time: rain ? formatTime(rain.timestamp) : 'Not available',
      source: rain ? String(rain.source) : 'Not available',
      quality: rain ? String(rain.quality) : 'Not available',
    },
    {
      type: 'Simulated',
      measure: `Flooded land at +${rise} m`,
      value: formatArea(scenario?.area ?? 0),
      time: scenario ? formatTime(scenario.feature.properties.timestamp) : 'Not available',
      source: scenario ? String(scenario.feature.properties.source) : 'Not available',
      quality: scenario ? String(scenario.feature.properties.quality) : 'Not available',
    },
  ]

  return (
    <div className="page report-page">
      <ViewHeader
        eyebrow="Situation report"
        title="Printable brief"
        lead="A one-page brief for a duty officer: the current scenario, the readings behind it and the limits of the model. Print or save as A4 PDF."
        actions={
          <>
            <button type="button" className="ghost-button" onClick={onBack}>
              Back to map
            </button>
            <button type="button" className="primary-button" onClick={onPrint}>
              <IconReport size={16} />
              Print or save as PDF
            </button>
          </>
        }
      />

      <article className="report-sheet">
        <header className="sheet-head">
          <div>
            <p className="sheet-kicker">NodiBondhu · Flood Twin prototype</p>
            <h1>Flood Situation Report</h1>
            <p className="sheet-sub">Simaluguri, Sivasagar district, Assam</p>
          </div>
          <div className="sheet-stamp">
            <Chip tone="warn" dot>
              Demonstration only
            </Chip>
            <span>{formatTime(info?.generatedAt)}</span>
          </div>
        </header>

        <dl className="sheet-meta">
          <div>
            <dt>Pilot area</dt>
            <dd>Simaluguri, Sivasagar district, Assam</dd>
          </div>
          <div>
            <dt>Bounding box</dt>
            <dd>
              {SOUTH.toFixed(2)}–{NORTH.toFixed(2)}° N, {WEST.toFixed(2)}–{EAST.toFixed(2)}° E
            </dd>
          </div>
          <div>
            <dt>Scenario</dt>
            <dd>+{rise} m river rise (simulated)</dd>
          </div>
          <div>
            <dt>Map layers shown</dt>
            <dd>{info?.layersShown.join(', ') || 'none'}</dd>
          </div>
        </dl>

        <p className="sheet-banner">
          <strong>Demonstration only.</strong> This is a simulated scenario, not an official warning. It has not
          been validated against a real flood extent. An officer must review it before any use.
        </p>

        <h2 className="sheet-section">Summary</h2>
        <p className="sheet-text">
          If rivers stood {rise} m above the water surface in the terrain model, about{' '}
          {formatArea(scenario?.area ?? 0)} of the pilot window would be flooded, reaching {affected.length} of{' '}
          {places.length} places with a modelled flood level ({dataset?.settlements?.features.length ?? places.length}{' '}
          mapped in OpenStreetMap). Simaluguri is{' '}
          {pilotFlooded ? 'flooded' : 'not flooded'} in this scenario
          {status != null ? `; the model floods it from +${status} m` : ''}.
        </p>
        <p className="sheet-text">
          No evacuation or response advice is given here, because the model has not yet been checked against a
          real flood.
        </p>

        <h2 className="sheet-section">Map</h2>
        {info?.mapImage ? (
          <figure className="sheet-figure">
            <img src={info.mapImage} alt={`Map of the +${rise} m scenario around Simaluguri`} />
            <figcaption>
              Map view when this report was generated. Imagery © Esri, Maxar, Earthstar Geographics. Flood
              extent from the NodiBondhu HAND model.
            </figcaption>
          </figure>
        ) : (
          <p className="sheet-empty">Map image not available — open the situation view, then generate again.</p>
        )}

        <h2 className="sheet-section">Readings by data type</h2>
        <table className="sheet-table">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Measure</th>
              <th scope="col">Value</th>
              <th scope="col">Time</th>
              <th scope="col">Source</th>
              <th scope="col">Quality</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((reading) => (
              <tr key={reading.measure}>
                <td>{reading.type}</td>
                <td>{reading.measure}</td>
                <td>
                  <strong>{reading.value}</strong>
                </td>
                <td>{reading.time}</td>
                <td>{reading.source}</td>
                <td>{reading.quality}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="sheet-section">Places by first flood level</h2>
        <table className="sheet-table">
          <thead>
            <tr>
              <th scope="col">First floods at</th>
              <th scope="col">Count</th>
              <th scope="col">Places</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((level) => {
              const names = places.filter((place) => place.level === level.rise).map((place) => place.name)
              return (
                <tr key={level.rise}>
                  <td>+{level.rise} m</td>
                  <td>{names.length}</td>
                  <td>{names.join(', ') || 'None'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <h2 className="sheet-section">All scenarios</h2>
        <table className="sheet-table">
          <thead>
            <tr>
              <th scope="col">Rise</th>
              <th scope="col">Flooded land</th>
              <th scope="col">Places</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((item) => (
              <tr key={item.rise} className={item.rise === rise ? 'is-active' : undefined}>
                <td>+{item.rise} m</td>
                <td>{formatArea(item.area)}</td>
                <td>{formatNumber(item.affected)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="sheet-section">Alert status</h2>
        <p className="sheet-text">
          {alert
            ? `Demo alert logged ${formatTime(alert.created_at)} for ${alert.settlements.length} places. ${alert.channel}.`
            : 'No demo alert has been logged for this scenario.'}
        </p>

        <footer className="sheet-foot">
          <span>
            Sources: Open-Meteo forecast API · OpenStreetMap contributors · Copernicus DEM GLO-30. Counts cover
            mapped places only.
          </span>
          <span>NESFIC-D-18 · NodiBondhu prototype · not for operational use</span>
        </footer>
      </article>
    </div>
  )
}
