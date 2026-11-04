import { BrandMark } from '../components/Brand'
import { IconScope, IconSliders } from '../components/Icons'

export default function Launch({
  onEnter,
  onScenario,
  placeCount,
  levels,
}: {
  onEnter: () => void
  onScenario: () => void
  placeCount: number
  levels: number
}) {
  return (
    <div className="launch">
      <div className="launch-grid" aria-hidden="true" />
      <svg className="launch-waves" viewBox="0 0 1200 500" aria-hidden="true" preserveAspectRatio="none">
        {Array.from({ length: 9 }, (_, index) => (
          <path
            key={index}
            d={`M-40 ${210 + index * 26} C 220 ${150 + index * 26}, 420 ${280 + index * 24}, 640 ${
              220 + index * 25
            } S 1020 ${140 + index * 27}, 1260 ${230 + index * 24}`}
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            opacity={0.22 - index * 0.018}
          />
        ))}
      </svg>

      <header className="launch-top">
        <span className="launch-brand">
          <BrandMark size={28} />
          <span>
            NodiBondhu
            <em>flood twin</em>
          </span>
        </span>
        <span className="launch-meta">
          NESFIC-D-18<br />
          Digital twin for flood management
        </span>
      </header>

      <main className="launch-main">
        <p className="launch-kicker">Simaluguri · Sivasagar · Dikhow sub-basin</p>
        <h1>
          Read the river
          <br />
          before it rises.
        </h1>
        <p className="launch-lead">
          NodiBondhu keeps observed, forecast and simulated data apart, then turns each metre of modelled river
          rise into an extent, a list of places and an alert a duty officer can approve.
        </p>
        <div className="launch-actions">
          <button type="button" className="primary-button is-large" onClick={onEnter}>
            <IconScope size={17} />
            Enter command view
          </button>
          <button type="button" className="ghost-button is-large" onClick={onScenario}>
            <IconSliders size={17} />
            Open scenario lab
          </button>
        </div>
        <dl className="launch-facts">
          <div>
            <dt>Pilot window</dt>
            <dd>60 × 60 km</dd>
          </div>
          <div>
            <dt>Rise levels</dt>
            <dd>{levels} modelled</dd>
          </div>
          <div>
            <dt>Mapped places</dt>
            <dd>{placeCount} in OSM</dd>
          </div>
          <div>
            <dt>Live input</dt>
            <dd>Rain forecast</dd>
          </div>
        </dl>
      </main>

      <footer className="launch-foot">
        <span>Observed · forecast · simulated, never mixed</span>
        <span className="launch-warn">Prototype — not an official warning</span>
        <span>Team NodiBondhu · 2026</span>
      </footer>
    </div>
  )
}
