import type { Location } from './types'

type Value = string | number | null

export function formatTime(timestamp: Value) {
  if (!timestamp) return 'Time not available'
  const date = new Date(String(timestamp))
  return Number.isNaN(date.getTime()) ? String(timestamp) : date.toLocaleString('en-IN')
}

export function formatField(key: string) {
  return key
    .replace(/_km2$/, ' (km²)')
    .replace(/_mm$/, ' (mm)')
    .replace(/_m3s$/, ' (m³/s)')
    .replace(/_m$/, ' (m)')
    .replace(/_/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

export function formatCount(value: Value) {
  return value === null ? 'No data' : Number(value).toLocaleString('en-IN')
}

export function formatArea(value: Value) {
  return value === null ? 'No data' : `${formatCount(value)} km²`
}

export function formatPercent(share: number) {
  return `${Math.round(share * 100)}%`
}

export function formatReachedAt(level: Value | undefined) {
  return typeof level === 'number' ? `+${level} m` : 'Not reached'
}

export function formatBbox([west, south, east, north]: Location['bbox']) {
  return `${south.toFixed(2)}–${north.toFixed(2)}° N, ${west.toFixed(2)}–${east.toFixed(2)}° E`
}

export function reportDayName(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

export function dayOfMonth(date: string) {
  return Number(date.slice(8))
}
