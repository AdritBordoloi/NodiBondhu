import { TABS } from '../constants'
import type { Location, TabId } from '../types'

type TopBarProps = {
  tab: TabId | 'report'
  onTab: (tab: TabId) => void
  locations: Location[]
  locationId: string | null
  onLocation: (id: string) => void
  canReport: boolean
  mapReady: boolean
  onGenerateReport: () => void
}

export function TopBar({ tab, onTab, locations, locationId, onLocation, canReport, mapReady, onGenerateReport }: TopBarProps) {
  return (
    <header className="topbar">
      <span className="brand">
        <img src="/logo.png" alt="" width={40} height={40} />
        NodiBondhu
      </span>
      <nav className="tabs" aria-label="Sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="tab"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => onTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {locations.length > 0 && tab !== 'report' && (
        <div className="topbar-actions">
          <select
            className="topbar-select"
            aria-label="Study region"
            value={locationId ?? ''}
            onChange={(event) => onLocation(event.target.value)}
          >
            {locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {canReport && (
            <button type="button" className="topbar-button" onClick={onGenerateReport} disabled={!mapReady}>
              {mapReady ? 'Generate Situation Report' : 'Loading map...'}
            </button>
          )}
        </div>
      )}
    </header>
  )
}
