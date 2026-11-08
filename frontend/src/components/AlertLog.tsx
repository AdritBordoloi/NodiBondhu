import { formatTime } from '../format'
import type { Alert } from '../types'
import { Table } from './common'

export function AlertLog({ alerts, error }: { alerts: Alert[]; error: string | null }) {
  return (
    <section className="panel">
      <h2 className="section-title">Logged demo alerts</h2>
      {alerts.length > 0 ? (
        <Table columns={['Time', 'Location', 'Scenario', 'Settlements', 'Channel']}>
          {alerts.map((alert) => (
            <tr key={alert.id}>
              <td>{formatTime(alert.created_at)}</td>
              <td>{alert.location_name ?? 'Not recorded'}</td>
              <td>+{alert.rise_m} m</td>
              <td>
                {alert.settlements.length}: {alert.settlements.join(', ')}
              </td>
              <td>{alert.channel}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="empty">{error ?? 'No alerts logged yet. Approve one under Scenario Analysis.'}</p>
      )}
    </section>
  )
}
