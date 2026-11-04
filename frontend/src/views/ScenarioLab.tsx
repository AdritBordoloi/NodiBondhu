import {
  IconAlert,
  IconArea,
  IconDroplet,
  IconTrend,
  IconVillage,
} from '../components/Icons'
import { RiseChart } from '../components/charts'
import { Chip, Panel, StatTile, ViewHeader } from '../components/ui'
import {
  formatArea,
  formatNumber,
  formatTime,
  percentOfPilot,
  pilotStatus,
  type Dataset,
  type Place,
  type Scenario,
} from '../lib/domain'

export default function ScenarioLab({
  dataset,
  scenarios,
  places,
  rise,
  setRise,
  onOpenAlerts,
}: {
  dataset: Dataset | null
  scenarios: Scenario[]
  places: Place[]
  rise: number
  setRise: (level: number) => void
  onOpenAlerts: () => void
}) {
  const scenario = scenarios.find((item) => item.rise === rise)
  const index = scenarios.findIndex((item) => item.rise === rise)
  const previous = index > 0 ? scenarios[index - 1] : null
  const affected = places.filter((place) => place.level <= rise)
  const newlyReached = affected.filter((place) => place.level === rise)
  const status = pilotStatus(dataset?.settlements ?? null, rise)
  const delta = scenario && previous ? scenario.area - previous.area : null
  const quality = scenario?.feature.properties.quality

  return (
    <div className="page">
      <ViewHeader
        eyebrow="Scenario lab"
        title="Rise scenarios"
        lead="Six pre-computed HAND runs over the same terrain window. Pick a river rise, then read which places enter the modelled extent and how much land that adds."
        actions={
          <button type="button" className="primary-button" onClick={onOpenAlerts}>
            <IconAlert size={16} />
            Open alert queue
          </button>
        }
      />

      <div className="cycle-strip" role="group" aria-label="Scenario level">
        <span className="cycle-strip-label">Level</span>
        {scenarios.map((item) => (
          <button
            key={item.rise}
            type="button"
            className={`cycle-chip ${item.rise === rise ? 'is-active' : ''}`}
            onClick={() => setRise(item.rise)}
            aria-pressed={item.rise === rise}
          >
            +{item.rise} m
          </button>
        ))}
        <span className="cycle-strip-note">Model run {formatTime(scenario?.feature.properties.timestamp)}</span>
      </div>

      <div className="stat-row">
        <StatTile
          label="Flooded land"
          value={formatArea(scenario?.area ?? 0)}
          sub={`${percentOfPilot(scenario?.area ?? 0).toFixed(0)}% of the pilot window`}
          tone="accent"
          icon={<IconArea size={14} />}
        />
        <StatTile
          label="Places in extent"
          value={formatNumber(affected.length)}
          unit={`of ${places.length}`}
          sub={`${newlyReached.length} enter exactly at this level`}
          icon={<IconVillage size={14} />}
        />
        <StatTile
          label="Added over previous level"
          value={delta == null ? '—' : `+${formatNumber(delta, 1)}`}
          unit="km²"
          sub={previous ? `compared with +${previous.rise} m` : 'lowest modelled level'}
          icon={<IconTrend size={14} />}
        />
        <StatTile
          label="Simaluguri"
          value={status.flooded ? 'Flooded' : 'Dry'}
          sub={status.level != null ? `first floods at +${status.level} m` : 'not modelled'}
          tone={status.flooded ? 'danger' : 'ok'}
          icon={<IconDroplet size={14} />}
        />
      </div>

      <div className="grid-2">
        <Panel
          title="Flooded area by rise"
          subtitle="Area inside the modelled extent, square kilometres"
          actions={<Chip tone="accent">HAND model</Chip>}
        >
          <RiseChart scenarios={scenarios} rise={rise} onSelect={setRise} />
          <p className="panel-footnote">
            Each point is a separate terrain run, not an interpolation. Slopes in the curve show where the
            floodplain opens up.
          </p>
        </Panel>

        <Panel
          title="Impact by level"
          subtitle="Pick a row to change the whole workspace"
          flush
          actions={<Chip tone="ghost">6 levels</Chip>}
        >
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Rise</th>
                  <th scope="col">Flooded</th>
                  <th scope="col">Places</th>
                  <th scope="col">Simaluguri</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((item) => {
                  const rowStatus = pilotStatus(dataset?.settlements ?? null, item.rise)
                  return (
                    <tr
                      key={item.rise}
                      className={item.rise === rise ? 'is-active' : undefined}
                      onClick={() => setRise(item.rise)}
                    >
                      <td>+{item.rise} m</td>
                      <td>{formatArea(item.area)}</td>
                      <td>{formatNumber(item.affected)}</td>
                      <td>
                        <span className={`status-dot ${rowStatus.flooded ? 'is-danger' : 'is-ok'}`} />
                        {rowStatus.flooded ? 'Flooded' : 'Dry'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel
          title={`Places first reached at +${rise} m`}
          subtitle={`${newlyReached.length} of ${places.length} mapped places`}
          flush
        >
          {newlyReached.length > 0 ? (
            <ul className="name-list">
              {newlyReached.map((place) => (
                <li key={`${place.name}-${place.coordinates.join(',')}`}>
                  <IconVillage size={14} />
                  <span>{place.name}</span>
                  <span className="name-list-meta">+{place.level} m</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel-empty">No added places at this level — the extent grows over land without mapped hamlets.</p>
          )}
        </Panel>

        <Panel title="What this run does and does not do" subtitle="Read before quoting any number">
          <dl className="definition-list">
            <dt>Model</dt>
            <dd>{String(scenario?.feature.properties.source ?? 'HAND terrain model')}</dd>
            <dt>Terrain</dt>
            <dd>Copernicus DEM GLO-30 surface model, several metres of vertical error on flat land.</dd>
            <dt>Not included</dt>
            <dd>Embankments, flow, timing, channel change and drainage capacity.</dd>
            <dt>Validation</dt>
            <dd>Not yet compared with a real flood extent. Treat every level as a screening estimate.</dd>
          </dl>
          <div className="quality-note">
            <Chip tone="warn" dot>
              Screening estimate
            </Chip>
            <p>{quality ? String(quality) : 'Quality statement not available.'}</p>
          </div>
        </Panel>
      </div>
    </div>
  )
}
