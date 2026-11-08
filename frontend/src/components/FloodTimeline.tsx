import { peakDay, riverName } from '../analysis'
import { FLOOD_TIMELINE_START, RIVER_STATUS_LABEL } from '../constants'
import { dayOfMonth, formatCount, reportDayName } from '../format'
import type { ChartBar, FloodReports, ReportField } from '../types'
import { ChartTile, ColumnChart } from './charts'

const TIMELINE_CHARTS: { field: ReportField; title: string; note: string; unit?: string }[] = [
  { field: 'villages', title: 'Villages affected', note: 'Reported each day, 16 to 28 July 2026.' },
  { field: 'people', title: 'People affected', note: 'Official count, not people in floodwater.' },
  {
    field: 'crop_hectares',
    title: 'Crop area submerged',
    note: 'Hectares reported that day, which can be revised.',
    unit: ' ha',
  },
]

export function FloodReportSource({ reports }: { reports: FloodReports }) {
  return (
    <p className="note">
      {reports.quality}. Source:{' '}
      <a href={reports.source_url} target="_blank" rel="noreferrer">
        {reports.source}
      </a>
      .
    </p>
  )
}

// What officials reported day by day during the flood. This is evidence the flood happened, not a
// score for the model, because the reports cover whole districts and revenue circles
export function FloodTimeline({ reports, radarDate }: { reports: FloodReports | null; radarDate?: string }) {
  // Earlier days show almost no change, so the charts start where the flood begins to build
  const days = (reports?.days ?? []).filter((day) => day.date >= FLOOD_TIMELINE_START)
  if (!reports || days.length === 0) {
    return <p className="empty">Official flood reports are not available for this location yet.</p>
  }
  const radarDay = radarDate?.match(/^(\d+) July 2026$/)?.[1]
  const river = riverName(reports)
  const listed = days.filter((day) => day.villages !== null)
  const figure = (value: number | null, unit = '') => `${formatCount(Math.round(Number(value)))}${unit}`
  const bars = (field: ReportField, unit = ''): ChartBar[] => {
    const peak = peakDay(days, field)
    return days.map((day) => ({
      label: String(dayOfMonth(day.date)),
      value: Number(day[field] ?? 0),
      shown: day.villages === null ? 'Not listed' : day[field] === null ? 'No figure' : figure(day[field], unit),
      highlight: day === peak,
    }))
  }
  const headline = (field: ReportField, unit = '') => {
    const peak = peakDay(days, field)
    return peak ? `${figure(peak[field], unit)} on ${reportDayName(peak.date)}` : 'Not listed'
  }
  const firstHigh = days.find((day) => day.river_status === 'highest')
  const firstDanger = days.find((day) => day.river_status !== 'not_listed')
  return (
    <>
      <p className="report-text">
        <strong>
          {firstHigh
            ? `The ${river} was above its highest flood level on ${reportDayName(firstHigh.date)}. `
            : firstDanger
              ? `The ${river} was above danger level from ${reportDayName(firstDanger.date)}. `
              : ''}
          {listed.length > 0
            ? `Reported villages affected in ${reports.area} peaked at ${headline('villages')}.`
            : `${reports.area} is not listed as affected in these reports.`}
        </strong>{' '}
        These are official counts for {reports.area}, not the map area, so they show the flood was
        real, not that the map is correct.
      </p>
      {listed.length > 0 && (
        <div className="chart-grid chart-grid-three">
          {TIMELINE_CHARTS.map(({ field, title, note, unit }) => (
            <ChartTile key={field} title={title} headline={headline(field, unit)} note={note}>
              <ColumnChart bars={bars(field, unit)} kind="observed" />
            </ChartTile>
          ))}
        </div>
      )}
      <div className="river-strip" role="list" aria-label={`${reports.gauge} status by day`}>
        {days.map((day) => (
          <div
            role="listitem"
            key={day.date}
            className={`river-day river-${day.river_status}`}
            title={`${reportDayName(day.date)}: ${RIVER_STATUS_LABEL[day.river_status]}`}
          >
            <span className="river-date">
              {dayOfMonth(day.date)}
              {String(dayOfMonth(day.date)) === radarDay && ' ◆'}
            </span>
            <span>
              {day.river_status === 'highest' ? 'Highest' : day.river_status === 'danger' ? 'Danger' : '–'}
            </span>
          </div>
        ))}
      </div>
      <p className="note">
        July 2026, {reports.gauge}: Highest means above highest flood level, Danger means above danger
        level, and – means not listed above danger level.
        {radarDay && ' ◆ marks the radar image used in the model check.'}
      </p>
    </>
  )
}
