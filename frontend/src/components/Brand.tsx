export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" stroke="currentColor" strokeOpacity="0.35" />
      <path
        d="M9 21.2c1.9 0 2.8-1.7 4.7-1.7s2.8 1.7 4.7 1.7 2.8-1.7 4.7-1.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M9 25.2c1.9 0 2.8-1.7 4.7-1.7s2.8 1.7 4.7 1.7 2.8-1.7 4.7-1.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeOpacity="0.45"
      />
      <path
        d="M16 5.2c3 3.4 5 5.9 5 8.2a5 5 0 0 1-10 0c0-2.3 2-4.8 5-8.2z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <BrandMark />
      <span className="wordmark-text">
        <strong>NodiBondhu</strong>
        <span>flood twin · Assam</span>
      </span>
    </span>
  )
}
