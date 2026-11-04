import { useEffect, useState, type ReactNode } from 'react'
import { IconCheck, IconCopy } from './Icons'

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  flush = false,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || actions) && (
        <header className="panel-head">
          <div className="panel-heading">
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && <p className="panel-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'panel-body is-flush' : 'panel-body'}>{children}</div>
    </section>
  )
}

export function ViewHeader({
  eyebrow,
  title,
  lead,
  actions,
}: {
  eyebrow: string
  title: string
  lead: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="view-head">
      <div className="view-heading">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="lead">{lead}</p>
      </div>
      {actions && <div className="view-actions">{actions}</div>}
    </header>
  )
}

export function StatTile({
  label,
  value,
  unit,
  sub,
  tone = 'default',
  icon,
}: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  tone?: 'default' | 'accent' | 'warn' | 'danger' | 'ok'
  icon?: ReactNode
}) {
  return (
    <div className={`stat tone-${tone}`}>
      <div className="stat-label">
        {icon && <span className="stat-icon">{icon}</span>}
        {label}
      </div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  icon,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      className={`switch-row ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-glyph">{icon}</span>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint && <span className="switch-hint">{hint}</span>}
      </span>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </button>
  )
}

export function Chip({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'ok' | 'ghost'
  dot?: boolean
}) {
  return (
    <span className={`chip tone-${tone}`}>
      {dot && <span className="chip-dot" />}
      {children}
    </span>
  )
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={`tab ${tab.id === active ? 'is-active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count != null && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true" />
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
    </div>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      className="ghost-button is-compact"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

export function LoadingBlock() {
  return (
    <div className="loading-block" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  )
}
