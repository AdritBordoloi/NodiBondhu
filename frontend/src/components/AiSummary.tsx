import { useEffect, useState } from 'react'
import { getSummary } from '../api'
import type { AiResult } from '../types'

// Worded by a local model from the report's figures. The report is complete without it
export function AiSummary({ locationId, rise }: { locationId: string; rise: number }) {
  const [result, setResult] = useState<AiResult | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    getSummary(locationId, rise, controller.signal)
      .then(setResult)
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ status: 'off', message: 'AI summary is not available. The rest of this report is complete.' })
        }
      })
    return () => controller.abort()
  }, [locationId, rise])
  if (!result) return <p className="note">Writing an AI summary with the local model...</p>
  if (result.status !== 'ok') return <p className="note">{result.message}</p>
  return (
    <div className="ai-summary">
      {result.text?.split(/\n+/).map((paragraph) => (
        <p className="report-text" key={paragraph}>
          {paragraph}
        </p>
      ))}
      <p className="note">
        AI-written by {result.model} on this computer, from the figures in this report. Its numbers
        were checked against those figures, but its wording was not, so an officer must read it.
        {result.plain ? ' Parts that failed the check show the plain figures instead.' : ''}
      </p>
    </div>
  )
}
