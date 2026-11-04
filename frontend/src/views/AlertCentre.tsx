import { useState } from 'react'
import { IconAlert, IconCheck, IconClock } from '../components/Icons'
import { Chip, Empty, Panel, ViewHeader } from '../components/ui'
import {
  SEVERITY_INFO,
  formatClock,
  formatNumber,
  formatTime,
  pilotStatus,
  postAlert,
  severityFor,
  type Alert,
  type Dataset,
  type Place,
  type Scenario,
} from '../lib/domain'

export default function AlertCentre({
  dataset,
  scenarios,
  places,
  rise,
  alerts,
  onLogged,
}: {
  dataset: Dataset | null
  scenarios: Scenario[]
  places: Place[]
  rise: number
  alerts: Alert[]
  onLogged: (alert: Alert) => void
}) {
  const [reviewed, setReviewed] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logged, setLogged] = useState<Alert | null>(null)

  const scenario = scenarios.find((item) => item.rise === rise)
  const affected = places.filter((place) => place.level <= rise)
  const groups = (['severe', 'moderate', 'watch'] as const).map((severity) => ({
    severity,
    places: affected.filter((place) => severityFor(place, rise) === severity),
  }))
  const status = pilotStatus(dataset?.settlements ?? null, rise)
  const message = [
    `NodiBondhu simulated scenario: rivers +${rise} m above the terrain water surface.`,
    `${affected.length} mapped places may be affected: ${affected
      .slice(0, 5)
      .map((place) => place.name)
      .join(', ')}${affected.length > 5 ? ` and ${affected.length - 5} more` : ''}.`,
    `Simaluguri is ${status.flooded ? 'flooded' : 'dry'} in this run.`,
    'Verify against the Dikhow gauge and field reports before any warning.',
    'Demo only — this is not an official alert.',
  ].join(' ')

  const submit = async () => {
    setSending(true)
    setError(null)
    try {
      const alert = await postAlert(rise)
      setLogged(alert)
      setReviewed(false)
      onLogged(alert)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="page">
      <ViewHeader
        eyebrow="Alert centre"
        title="Approval queue"
        lead="Predicted flooding becomes an alert only after an officer reviews the scenario and its source quality. Every action below is logged locally — nothing is dispatched."
        actions={
          <Chip tone="ghost" dot>
            Demo channel · log only
          </Chip>
        }
      />

      <div className="severity-strip">
        {(['severe', 'moderate', 'watch'] as const).map((severity) => {
          const count = affected.filter((place) => severityFor(place, rise) === severity).length
          return (
            <div key={severity} className="severity-item">
              <span className="severity-dot" style={{ background: SEVERITY_INFO[severity].color }} />
              <span className="severity-label">{SEVERITY_INFO[severity].label}</span>
              <span className="severity-count">{count}</span>
            </div>
          )
        })}
        <div className="severity-item is-quiet">
          <span className="severity-dot" style={{ background: 'var(--muted)' }} />
          <span className="severity-label">Logged alerts</span>
          <span className="severity-count">{alerts.length}</span>
        </div>
        <div className="severity-note">
          Queue for the +{rise} m scenario · {formatNumber(affected.length)} of {places.length} mapped places
        </div>
      </div>

      <div className="grid-alerts">
        <div className="stack">
          <Panel
            title="Officer approval"
            subtitle={`Scenario +${rise} m · ${formatNumber(affected.length)} places in extent`}
            actions={<Chip tone="accent">Step 1 of 2</Chip>}
          >
            <label className={`checkbox-row ${reviewed ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              <span className="checkbox-box">{reviewed && <IconCheck size={12} />}</span>
              <span>
                I have reviewed the scenario, its terrain source and the quality statement, and I accept that
                this is a screening estimate.
              </span>
            </label>
            <div className="approval-actions">
              <button
                type="button"
                className="primary-button"
                disabled={!reviewed || affected.length === 0 || sending}
                onClick={submit}
              >
                <IconAlert size={16} />
                {sending ? 'Logging…' : 'Approve and log demo alert'}
              </button>
              <span className="approval-hint">
                {affected.length === 0
                  ? 'No place is inside this extent yet.'
                  : 'Writes to the local alert log. No SMS, WhatsApp or email is sent.'}
              </span>
            </div>
            {error && (
              <p className="inline-error" role="alert">
                Could not log the alert: {error}
              </p>
            )}
            {logged && (
              <div className="approval-success">
                <IconCheck size={14} />
                <span>
                  Alert #{logged.id} logged at {formatClock(logged.created_at)} for {logged.settlements.length}{' '}
                  places. {logged.channel}.
                </span>
              </div>
            )}
          </Panel>

          <Panel
            title="Queue"
            subtitle="Ranked by how far each place sits above its first-flood level"
            flush
            actions={<Chip tone="ghost">+{rise} m</Chip>}
          >
            {affected.length === 0 ? (
              <Empty title="Nothing in the queue" hint="Raise the scenario level to bring places into the extent." />
            ) : (
              <div className="queue">
                {groups.map(({ severity, places: rows }) =>
                  rows.length ? (
                    <div key={severity} className="queue-group">
                      <div className="queue-group-head">
                        <span className="severity-dot" style={{ background: SEVERITY_INFO[severity].color }} />
                        {SEVERITY_INFO[severity].label}
                        <span className="queue-group-count">{rows.length}</span>
                        <span className="queue-group-rule">{severityRule(severity)}</span>
                      </div>
                      {rows.map((place) => (
                        <div key={`${place.name}-${place.coordinates.join(',')}`} className="queue-row">
                          <span className="queue-name">{place.name}</span>
                          <span className="queue-meta">first floods +{place.level} m</span>
                          <span className="queue-depth">{rise - place.level} m above</span>
                          <span className="queue-ico" aria-hidden="true">
                            <IconAlert size={13} />
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </Panel>
        </div>

        <div className="stack">
          <Panel title="What the ward officer receives" subtitle="On-screen mock of the message preview" flush>
            <div className="phone-wrap">
              <div className="phone">
                <div className="phone-top">
                  <span className="phone-brand">NodiBondhu</span>
                  <span className="phone-time">{formatClock(scenario?.feature.properties.timestamp)}</span>
                </div>
                <div className="phone-app">
                  <span className="phone-app-dot" />
                  NodiBondhu alerts
                  <span className="phone-app-sub">ward officer</span>
                </div>
                <div className="phone-card">
                  <div className="phone-card-head">
                    <Chip tone="warn" dot>
                      Simulated
                    </Chip>
                    <span>+{rise} m</span>
                  </div>
                  <p>{message}</p>
                  <div className="phone-card-foot">
                    <IconClock size={12} />
                    {formatTime(scenario?.feature.properties.timestamp)}
                  </div>
                </div>
                <div className="phone-foot">Logged locally · no dispatch</div>
              </div>
            </div>
          </Panel>

          <Panel
            title="Logged alerts"
            subtitle="Append-only demo log held by the API"
            flush
            actions={<Chip tone="ghost">{alerts.length}</Chip>}
          >
            {alerts.length === 0 ? (
              <Empty title="No alert logged yet" hint="Approve a scenario to create the first entry." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Level</th>
                      <th scope="col">Places</th>
                      <th scope="col">Channel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((alert) => (
                      <tr key={alert.id}>
                        <td>{formatTime(alert.created_at)}</td>
                        <td>+{alert.rise_m} m</td>
                        <td>{alert.settlements.length}</td>
                        <td className="cell-muted">{alert.channel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function severityRule(severity: 'severe' | 'moderate' | 'watch') {
  if (severity === 'severe') return '2 m or more above the first-flood level'
  if (severity === 'moderate') return '1 m or more above'
  return 'at or just above'
}
