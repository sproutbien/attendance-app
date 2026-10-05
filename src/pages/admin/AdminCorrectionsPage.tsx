import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useCorrectionQueue } from '../../hooks/useCorrectionQueue'
import type { CorrectionWithEmployee } from '../../hooks/useCorrectionQueue'
import { fmtClockTime, fromTimeInput, toTimeInput } from '../../lib/corrections'

function fmtDay(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_STYLES = {
  pending:  { bg: '#fef9c3', text: '#854d0e', label: 'Pending'  },
  approved: { bg: '#dcfce7', text: '#166534', label: 'Approved' },
  rejected: { bg: '#fee2e2', text: '#991b1b', label: 'Rejected' },
}

export default function AdminCorrectionsPage() {
  const { pending, history, loading, actioning, approve, reject } = useCorrectionQueue()
  const [filter, setFilter] = useState<'all' | 'approved' | 'rejected'>('all')
  const shown = history.filter(r => filter === 'all' || r.status === filter)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>Attendance Corrections</h1>
        {!loading && pending.length > 0 && (
          <span style={{ background: '#fef9c3', color: '#854d0e', fontWeight: 700, fontSize: '0.8125rem', padding: '2px 10px', borderRadius: 99 }}>
            {pending.length} pending
          </span>
        )}
      </div>

      <div style={{ ...card, marginBottom: '1.5rem' }}>
        <h2 style={sectionTitle}>Pending Approval</h2>
        {loading ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p>
        ) : pending.length === 0 ? (
          <p style={{ color: '#64748b', margin: 0, padding: '1rem 0', textAlign: 'center', fontWeight: 500 }}>
            All caught up — no pending corrections.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pending.map(r => (
              <PendingCorrection
                key={r.id}
                request={r}
                busy={actioning.has(r.id)}
                onApprove={approve}
                onReject={reject}
              />
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <h2 style={{ ...sectionTitle, margin: 0 }}>Past corrections {!loading && `(${history.length})`}</h2>
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            {(['all', 'approved', 'rejected'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} style={pill(filter === f)}>
                {f === 'all' ? 'All' : STATUS_STYLES[f].label}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p>
        ) : shown.length === 0 ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>Nothing here yet.</p>
        ) : (
          shown.map(r => <HistoryRow key={r.id} request={r} />)
        )}
      </div>
    </div>
  )
}

function PendingCorrection({ request: r, busy, onApprove, onReject }: {
  request: CorrectionWithEmployee
  busy: boolean
  onApprove: (id: string, checkIn: string | null, checkOut: string | null, note: string) => Promise<string | null>
  onReject: (id: string, note: string) => Promise<string | null>
}) {
  // Pre-filled with what the employee asked for; the admin may adjust before approving
  const [checkIn, setCheckIn] = useState(toTimeInput(r.requested_check_in ?? r.original_check_in))
  const [checkOut, setCheckOut] = useState(toTimeInput(r.requested_check_out ?? r.original_check_out))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleApprove() {
    setError(null)
    if (!checkIn) return setError('A check-in time is needed.')
    if (checkOut && checkOut <= checkIn) return setError('Check-out must be after check-in.')
    const err = await onApprove(r.id, fromTimeInput(r.date, checkIn), fromTimeInput(r.date, checkOut), note)
    if (err) setError(err)
  }

  async function handleReject() {
    setError(null)
    const err = await onReject(r.id, note)
    if (err) setError(err)
  }

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
        <span style={{ fontWeight: 700, color: '#1e293b' }}>{r.employee.full_name}</span>
        {r.employee.department && <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{r.employee.department}</span>}
        <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 600, marginLeft: 'auto' }}>{fmtDay(r.date)}</span>
      </div>
      <div style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '0.75rem', overflowWrap: 'anywhere' }}>
        <span style={{ color: '#94a3b8' }}>Reason: </span>{r.reason}
      </div>

      <table style={{ borderCollapse: 'collapse', fontSize: '0.875rem', marginBottom: '0.875rem', width: '100%', maxWidth: 420, tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
            <th style={cellHead}></th><th style={cellHead}>Check-in</th><th style={cellHead}>Check-out</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cellLabel}>Recorded</td>
            <td style={cell}>{fmtClockTime(r.original_check_in)}</td>
            <td style={cell}>{fmtClockTime(r.original_check_out)}</td>
          </tr>
          <tr>
            <td style={cellLabel}>Requested</td>
            <td style={{ ...cell, fontWeight: r.requested_check_in ? 600 : 400 }}>{r.requested_check_in ? fmtClockTime(r.requested_check_in) : 'no change'}</td>
            <td style={{ ...cell, fontWeight: r.requested_check_out ? 600 : 400 }}>{r.requested_check_out ? fmtClockTime(r.requested_check_out) : 'no change'}</td>
          </tr>
          <tr>
            <td style={cellLabel}>Approve as</td>
            <td style={cell}><input type="time" value={checkIn} onChange={e => setCheckIn(e.target.value)} style={timeInput} aria-label="Approved check-in" /></td>
            <td style={cell}><input type="time" value={checkOut} onChange={e => setCheckOut(e.target.value)} style={timeInput} aria-label="Approved check-out" /></td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Note to employee (optional)"
          style={{ flex: 1, minWidth: 200, padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit' }}
        />
        <button onClick={handleReject} disabled={busy} style={{ ...actionBtn, border: '1px solid #fecaca', background: '#fff', color: '#dc2626' }}>
          Reject
        </button>
        <button onClick={handleApprove} disabled={busy} style={{ ...actionBtn, border: 'none', background: busy ? '#86efac' : '#16a34a', color: '#fff' }}>
          {busy ? '…' : 'Approve'}
        </button>
      </div>
      {error && <p style={{ margin: '0.625rem 0 0', color: '#dc2626', fontSize: '0.875rem' }}>{error}</p>}
    </div>
  )
}

function HistoryRow({ request: r }: { request: CorrectionWithEmployee }) {
  const s = STATUS_STYLES[r.status]
  const adjusted = r.status === 'approved' && (
    (r.requested_check_in != null && r.requested_check_in !== r.approved_check_in) ||
    (r.requested_check_out != null && r.requested_check_out !== r.approved_check_out)
  )
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', padding: '0.875rem 0', borderTop: '1px solid #f1f5f9' }}>
      <div style={{ flex: 1, minWidth: 220, fontSize: '0.875rem' }}>
        <div>
          <span style={{ fontWeight: 600, color: '#1e293b' }}>{r.employee.full_name}</span>
          <span style={{ color: '#374151', marginLeft: 8 }}>{fmtDay(r.date)}</span>
        </div>
        <div style={{ color: '#64748b', margin: '0.125rem 0' }}>
          {fmtClockTime(r.original_check_in)} – {fmtClockTime(r.original_check_out)}
          {' → '}
          {r.status === 'approved'
            ? <b style={{ color: '#1e293b' }}>{fmtClockTime(r.approved_check_in)} – {fmtClockTime(r.approved_check_out)}</b>
            : <>{fmtClockTime(r.requested_check_in ?? r.original_check_in)} – {fmtClockTime(r.requested_check_out ?? r.original_check_out)} (requested)</>}
          {adjusted && <span style={{ color: '#b45309' }}> · adjusted</span>}
        </div>
        <div style={{ color: '#64748b', overflowWrap: 'anywhere' }}><span style={{ color: '#94a3b8' }}>Reason: </span>{r.reason}</div>
        {r.admin_note && <div style={{ color: '#374151', fontStyle: 'italic' }}>Note: {r.admin_note}</div>}
        <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.25rem' }}>
          Requested {new Date(r.requested_at).toLocaleDateString()}
          {r.reviewed_at && <> · {s.label} {new Date(r.reviewed_at).toLocaleDateString()}</>}
        </div>
      </div>
      <span style={{ flexShrink: 0, padding: '2px 10px', borderRadius: 99, background: s.bg, color: s.text, fontWeight: 600, fontSize: '0.8125rem' }}>
        {s.label}
      </span>
    </div>
  )
}

function pill(active: boolean): CSSProperties {
  return {
    padding: '0.3125rem 0.875rem',
    borderRadius: 99,
    border: active ? '1px solid var(--brand-600)' : '1px solid #e2e8f0',
    background: active ? 'var(--brand-100)' : '#fff',
    color: active ? 'var(--brand-800)' : '#475569',
    fontWeight: active ? 600 : 500,
    fontSize: '0.8125rem',
    cursor: 'pointer',
  }
}

const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const sectionTitle: CSSProperties = { margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }
const cellHead: CSSProperties = { padding: '0 0.75rem 0.375rem 0', fontWeight: 500, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }
const cellLabel: CSSProperties = { padding: '0.25rem 0.75rem 0.25rem 0', color: '#94a3b8' }
const cell: CSSProperties = { padding: '0.25rem 0.75rem 0.25rem 0', color: '#1e293b' }
const timeInput: CSSProperties = { width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '0.3125rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.875rem', fontFamily: 'inherit' }
const actionBtn: CSSProperties = { padding: '0.5rem 1.125rem', borderRadius: 8, fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }
