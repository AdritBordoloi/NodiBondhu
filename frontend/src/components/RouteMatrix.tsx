import type { ReactNode } from 'react'
import { floodedKm, isPartlyMapped, mainRoutes, routeDestination } from '../analysis'
import type { Feature, Layer } from '../types'

type RouteMatrixProps = { routes: Layer | null; rise: number; rises: number[]; settlements: Layer | null }

// Every route against every river rise. "Clear" only means no flooded stretch was found in the model
export function RouteMatrix({ routes, rise, rises, settlements }: RouteMatrixProps) {
  const firstFlooded = (route: Feature) =>
    rises.find((level) => floodedKm(route, level) > 0) ?? Number.POSITIVE_INFINITY
  const ranked = mainRoutes(routes).sort(
    (a, b) =>
      firstFlooded(b) - firstFlooded(a) || Number(a.properties.length_km) - Number(b.properties.length_km),
  )
  // Leaves out the last two routes that have flooded road at every rise
  const neverClear = ranked.filter((route) => rises.every((level) => floodedKm(route, level) > 0))
  const leftOut = neverClear.slice(-2)
  const list = ranked.filter((route) => !leftOut.includes(route))
  if (list.length === 0) {
    return <p className="empty">Road routes are not available for this location yet.</p>
  }
  const placeLevel = (route: Feature) => {
    const end = routeDestination(route)
    const place = settlements?.features.find((item) => item.properties.name === end)
    if (!place) return 'Outside flood map'
    const level = place.properties.first_flooded_at_m
    return typeof level === 'number' ? `Reached at +${level} m` : 'Not reached'
  }
  const clearAt = (level: number) => list.filter((route) => floodedKm(route, level) === 0)
  const clearNow = clearAt(rise)
  // Least road in the flood area, then a fully checked route, then the shorter one
  const safestAt = (level: number) =>
    [...list].sort(
      (a, b) =>
        floodedKm(a, level) - floodedKm(b, level) ||
        Number(isPartlyMapped(a)) - Number(isPartlyMapped(b)) ||
        Number(a.properties.length_km) - Number(b.properties.length_km),
    )[0]
  const safestNow = safestAt(rise)
  const levelClass = (level: number) => (level === rise ? 'route-level route-level-now' : 'route-level')
  const totals: { label: string; cell: (level: number) => ReactNode }[] = [
    {
      label: 'Routes with no flooded stretch',
      cell: (level) => (
        <>
          {clearAt(level).length} of {list.length}
        </>
      ),
    },
    { label: '★ Safest in the model', cell: (level) => routeDestination(safestAt(level)) },
  ]
  return (
    <>
      <p className="report-text">
        <strong>
          {clearNow.length} of {list.length} routes have no flooded stretch in the model at +{rise} m
          {clearNow.length > 0 && `: ${clearNow.map(routeDestination).join(', ')}`}.{' '}
          {floodedKm(safestNow, rise) > 0
            ? `No route is clear, so the safest in the model is ${safestNow.properties.name}, with ${floodedKm(safestNow, rise)} km in the flood area.`
            : `The safest in the model is ${safestNow.properties.name}.`}
        </strong>{' '}
        This is not a safety check, so confirm a road is open before using it. * Only part of the
        route was checked.
      </p>
      <div className="table-wrap">
        <table className="route-matrix">
          <thead>
            <tr>
              <th scope="col">Route</th>
              <th scope="col">Length</th>
              <th scope="col">Checked</th>
              <th scope="col">Destination</th>
              {rises.map((level) => (
                <th scope="col" key={level} className={levelClass(level)}>
                  +{level} m
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((route) => (
              <tr key={String(route.properties.name)}>
                <td>{route.properties.name}</td>
                <td>{route.properties.length_km} km</td>
                <td>{route.properties.mapped_km} km</td>
                <td>{placeLevel(route)}</td>
                {rises.map((level) => {
                  const km = floodedKm(route, level)
                  const label = km > 0 ? `${km} km` : isPartlyMapped(route) ? 'Clear*' : 'Clear'
                  const safest = safestAt(level) === route
                  return (
                    <td
                      key={level}
                      className={`route-level ${km > 0 ? 'route-flooded' : 'route-clear'}${safest ? ' route-safest' : ''}${level === rise ? ' route-level-now' : ''}`}
                    >
                      {safest ? `★ ${label}` : label}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {totals.map(({ label, cell }) => (
              <tr key={label}>
                <th scope="row" colSpan={4}>
                  {label}
                </th>
                {rises.map((level) => (
                  <td key={level} className={levelClass(level)}>
                    {cell(level)}
                  </td>
                ))}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </>
  )
}
