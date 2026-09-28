import { useEffect, useState } from 'react'
import type { AttendanceRecord } from '../types'
import { fmtClock, fmtDuration, totalBreakSeconds, workedSeconds } from '../lib/breaks'

type Props = {
  record: AttendanceRecord | null | undefined
  isSubmitting: boolean
  onCheckIn: () => void
  onCheckOut: () => void
  onPause: () => void
  onResume: () => void
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const circleBase: React.CSSProperties = {
  width: 172,
  height: 172,
  borderRadius: '50%',
  border: 'none',
  fontSize: '1.25rem',
  fontWeight: 700,
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto',
  transition: 'opacity 0.15s, transform 0.1s',
}

// Re-renders every second while the day is in progress so the timers tick
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

export default function CheckInButton({ record, isSubmitting, onCheckIn, onCheckOut, onPause, onResume }: Props) {
  const inProgress = !!record?.check_in_time && !record?.check_out_time
  const now = useNow(inProgress)

  if (record === undefined) {
    return (
      <div style={{ ...circleBase, background: '#f1f5f9', color: '#94a3b8', cursor: 'default' }}>
        Loading…
      </div>
    )
  }

  const hasCheckedIn = !!record?.check_in_time
  const hasCheckedOut = !!record?.check_out_time

  if (!hasCheckedIn) {
    return (
      <button
        onClick={onCheckIn}
        disabled={isSubmitting}
        style={{
          ...circleBase,
          background: '#16a34a',
          color: '#fff',
          boxShadow: '0 8px 32px rgba(22,163,74,0.35)',
          opacity: isSubmitting ? 0.6 : 1,
          cursor: isSubmitting ? 'not-allowed' : 'pointer',
        }}
      >
        {isSubmitting ? '…' : 'Check In'}
      </button>
    )
  }

  if (!hasCheckedOut) {
    const onBreak = !!record.break_started_at
    const breakSecs = totalBreakSeconds(record, now)
    const busy = { opacity: isSubmitting ? 0.6 : 1, cursor: isSubmitting ? 'not-allowed' : 'pointer' } as const
    return (
      <div>
        <p style={{ textAlign: 'center', color: '#16a34a', fontWeight: 500, fontSize: '0.875rem', margin: '0 0 0.375rem' }}>
          Checked in at {fmtTime(record.check_in_time)}
          {record.status === 'late' && <span style={{ marginLeft: 8, color: '#d97706' }}>(Late)</span>}
        </p>
        <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.8125rem', margin: '0 0 1rem' }}>
          Worked {fmtDuration(workedSeconds(record, now))}
          <span style={{ margin: '0 0.5rem', color: '#cbd5e1' }}>·</span>
          Break {fmtDuration(breakSecs)}
        </p>

        {onBreak ? (
          <button
            onClick={onResume}
            disabled={isSubmitting}
            style={{
              ...circleBase,
              background: '#d97706',
              color: '#fff',
              boxShadow: '0 8px 32px rgba(217,119,6,0.3)',
              gap: '0.25rem',
              ...busy,
            }}
          >
            {isSubmitting ? '…' : (
              <>
                <span>▶ Resume</span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 500, opacity: 0.9 }}>
                  On break · {fmtClock(Math.floor((now - new Date(record.break_started_at!).getTime()) / 1000))}
                </span>
              </>
            )}
          </button>
        ) : (
          <button
            onClick={onCheckOut}
            disabled={isSubmitting}
            style={{
              ...circleBase,
              background: '#2563eb',
              color: '#fff',
              boxShadow: '0 8px 32px rgba(37,99,235,0.3)',
              ...busy,
            }}
          >
            {isSubmitting ? '…' : 'Check Out'}
          </button>
        )}

        <button
          onClick={onBreak ? onCheckOut : onPause}
          disabled={isSubmitting}
          style={{
            marginTop: '1.25rem',
            padding: '0.5rem 1.25rem',
            borderRadius: 99,
            border: `1px solid ${onBreak ? '#bfdbfe' : '#fcd34d'}`,
            background: onBreak ? '#eff6ff' : '#fffbeb',
            color: onBreak ? '#1d4ed8' : '#b45309',
            fontWeight: 600,
            fontSize: '0.875rem',
            ...busy,
          }}
        >
          {onBreak ? 'End break & check out' : '⏸ Pause for a break'}
        </button>
      </div>
    )
  }

  return (
    <div style={{
      ...circleBase,
      background: '#f0fdf4',
      border: '3px solid #16a34a',
      color: '#16a34a',
      cursor: 'default',
      gap: '0.25rem',
    }}>
      <span style={{ fontSize: '2rem', lineHeight: 1 }}>✓</span>
      <span style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Done for today</span>
      <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
        {fmtTime(record.check_in_time)} – {fmtTime(record.check_out_time)}
      </span>
      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
        Break {fmtDuration(totalBreakSeconds(record))}
      </span>
    </div>
  )
}
