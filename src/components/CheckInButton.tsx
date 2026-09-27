import type { AttendanceRecord } from '../types'

type Props = {
  record: AttendanceRecord | null | undefined
  isSubmitting: boolean
  onCheckIn: () => void
  onCheckOut: () => void
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

export default function CheckInButton({ record, isSubmitting, onCheckIn, onCheckOut }: Props) {
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
    return (
      <div>
        <p style={{ textAlign: 'center', color: '#16a34a', fontWeight: 500, fontSize: '0.875rem', marginBottom: '1rem' }}>
          Checked in at {fmtTime(record.check_in_time)}
          {record.status === 'late' && <span style={{ marginLeft: 8, color: '#d97706' }}>(Late)</span>}
        </p>
        <button
          onClick={onCheckOut}
          disabled={isSubmitting}
          style={{
            ...circleBase,
            background: '#2563eb',
            color: '#fff',
            boxShadow: '0 8px 32px rgba(37,99,235,0.3)',
            opacity: isSubmitting ? 0.6 : 1,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
          }}
        >
          {isSubmitting ? '…' : 'Check Out'}
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
    </div>
  )
}
