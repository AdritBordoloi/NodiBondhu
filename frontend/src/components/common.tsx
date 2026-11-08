import type { ReactNode } from 'react'
import { KIND_INFO } from '../constants'
import type { Kind } from '../types'

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ backgroundColor: color }} />
}

export function SwatchTitle({ color, children }: { color: string; children: ReactNode }) {
  return (
    <h2 className="section-title">
      <Swatch color={color} />
      {children}
    </h2>
  )
}

type DataPanelProps = { color: string; title: ReactNode; targeted?: boolean; children: ReactNode }

// One block of the Data Sources tab. A map click on what it lists marks it as the target
export function DataPanel({ color, title, targeted = false, children }: DataPanelProps) {
  return (
    <section className={targeted ? 'panel data-panel map-target' : 'panel data-panel'}>
      <SwatchTitle color={color}>{title}</SwatchTitle>
      {children}
    </section>
  )
}

type TableProps = { columns: ReactNode[]; wrapClassName?: string; children: ReactNode }

export function Table({ columns, wrapClassName = 'table-wrap', children }: TableProps) {
  return (
    <div className={wrapClassName}>
      <table>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th scope="col" key={index}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function KindTag({ kind }: { kind: Kind }) {
  const info = KIND_INFO[kind]
  return (
    <span className="kind-tag" style={{ color: info.color }}>
      {info.label}
    </span>
  )
}

type ReadoutProps = { kind: Kind; label: string; value: string; detail?: string; wide?: boolean }

export function Readout({ kind, label, value, detail, wide = false }: ReadoutProps) {
  return (
    <div className={wide ? 'field field-wide' : 'field'}>
      <span className="field-label">{label}</span>
      <div className="field-value">
        <KindTag kind={kind} />
        <strong>{value}</strong>
        {detail && <span className="field-detail">{detail}</span>}
      </div>
    </div>
  )
}
