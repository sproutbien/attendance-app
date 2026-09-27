import type { CSSProperties } from 'react'
import type { AttendanceRecord } from '../types'
import { STATUS_COLORS, STATUS_LABELS } from '../types'

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(isoDate: string) {
  return new Date(isoDate + 'T00:00:00').toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

export default function MonthlyHistory({ records }: { records: AttendanceRecord[] }) {
  const now = new Date()
  const recordMap = new Map(records.map(r => [r.date, r]))

  const rows: string[] = []
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1)
  while (cursor <= now) {
    rows.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
  }
  rows.reverse()

  if (rows.length === 0) {
    return <p style={{ color: '#94a3b8', textAlign: 'center', margin: 0 }}>No records this month.</p>
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
            {['Date', 'Status', 'In', 'Out'].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(date => {
            const rec = recordMap.get(date)
            const status = (rec?.status ?? 'absent') as AttendanceRecord['status']
            const colors = STATUS_COLORS[status]
            return (
              <tr key={date} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={tdStyle}>{fmtDate(date)}</td>
                <td style={tdStyle}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 10px',
                    borderRadius: 99,
                    background: colors.bg,
                    color: colors.text,
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                  }}>
                    {STATUS_LABELS[status]}
                  </span>
                </td>
                <td style={tdStyle}>{fmtTime(rec?.check_in_time)}</td>
                <td style={tdStyle}>{fmtTime(rec?.check_out_time)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  fontWeight: 600,
  color: '#64748b',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const tdStyle: CSSProperties = {
  padding: '0.625rem 0.75rem',
  color: '#374151',
}
