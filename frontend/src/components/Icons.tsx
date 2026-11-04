import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/* ---------- navigation ---------- */

export function IconScope(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
      <circle cx="12" cy="12" r="2.2" />
    </Svg>
  )
}

export function IconSliders(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </Svg>
  )
}

export function IconBroadcast(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="1.8" />
      <path d="M8.1 8.1a5.5 5.5 0 0 0 0 7.8M15.9 8.1a5.5 5.5 0 0 1 0 7.8" />
      <path d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" />
    </Svg>
  )
}

export function IconDatabase(props: IconProps) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
      <path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
    </Svg>
  )
}

export function IconReport(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 3.5h7l4.5 4.5v12.5h-11.5z" />
      <path d="M13.5 3.5V8H18" />
      <path d="M9 16.5l2.2-2.6 1.8 1.6 2.5-3" />
    </Svg>
  )
}

/* ---------- layer glyphs ---------- */

export function IconDroplet(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.6c3.1 3.5 5.4 6.4 5.4 9.1a5.4 5.4 0 0 1-10.8 0c0-2.7 2.3-5.6 5.4-9.1z" />
    </Svg>
  )
}

export function IconCloudRain(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.2 15.5a3.7 3.7 0 0 1-.3-7.4 5 5 0 0 1 9.6 1 3.2 3.2 0 0 1 .4 6.4" />
      <path d="M8.6 18.4l-.9 2M12.4 18.4l-.9 2M16.2 18.4l-.9 2" />
    </Svg>
  )
}

export function IconWaves(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8.6c1.8 0 2.6-1.6 4.5-1.6s2.7 1.6 4.5 1.6 2.6-1.6 4.5-1.6 2.7 1.6 4.5 1.6" />
      <path d="M3 13.4c1.8 0 2.6-1.6 4.5-1.6s2.7 1.6 4.5 1.6 2.6-1.6 4.5-1.6 2.7 1.6 4.5 1.6" />
      <path d="M3 18.2c1.8 0 2.6-1.6 4.5-1.6s2.7 1.6 4.5 1.6 2.6-1.6 4.5-1.6 2.7 1.6 4.5 1.6" />
    </Svg>
  )
}

export function IconVillage(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20V11.2L9.6 6l5.6 5.2V20" />
      <path d="M3 20h18" />
      <path d="M15.2 12.2L20 16v4" />
      <path d="M9.6 20v-3.6" />
    </Svg>
  )
}

export function IconBoundary(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" strokeDasharray="2.4 2.4" />
      <path d="M9 12h6" strokeDasharray="2.4 2.4" />
    </Svg>
  )
}

/* ---------- controls ---------- */

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5.6l10 6.4-10 6.4z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconPause(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth={2.2} />
    </Svg>
  )
}

export function IconReset(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 9.5A7.6 7.6 0 1 1 5 15" />
      <path d="M4.2 4.8v4.9h4.9" />
    </Svg>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.2" />
      <path d="M15.6 15.6L20 20" />
    </Svg>
  )
}

export function IconExpand(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </Svg>
  )
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

export function IconChevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 5l7 7-7 7" />
    </Svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Svg>
  )
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" />
    </Svg>
  )
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4V12l3.2 1.9" />
    </Svg>
  )
}

export function IconArea(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 8.5l7-4 8 5-1.5 8-8 3.5-5.5-4z" />
      <path d="M4.5 8.5l5 4 5.5-3.5M9.5 12.5l1.5 8" strokeDasharray="2.2 2.2" />
    </Svg>
  )
}

export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.2L2.9 19.5h18.2z" />
      <path d="M12 10v4.2M12 16.9v.1" />
    </Svg>
  )
}

export function IconPin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21s6.2-6 6.2-10.6a6.2 6.2 0 1 0-12.4 0C5.8 15 12 21 12 21z" />
      <circle cx="12" cy="10.2" r="2.3" />
    </Svg>
  )
}

export function IconTrend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 16.5l5.2-5.4 3.4 3 5-5.6" />
      <path d="M13.5 8.5h3.6v3.6" />
      <path d="M3.5 20.5h17" />
    </Svg>
  )
}

export function IconLink(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.2 13.8a3.8 3.8 0 0 0 5.4 0l2.4-2.4a3.8 3.8 0 0 0-5.4-5.4L11.4 7.2" />
      <path d="M13.8 10.2a3.8 3.8 0 0 0-5.4 0l-2.4 2.4a3.8 3.8 0 0 0 5.4 5.4l1.2-1.2" />
    </Svg>
  )
}
