import { useState } from 'react'
import type { CSSProperties } from 'react'
import AppLayout from '../components/AppLayout'
import { useLeaveRequests } from '../hooks/useLeaveRequests'
import type { LeaveRequest } from '../types'

const STATUS_STYLES: Record<LeaveRequest['status'], { bg: string; text: string; label: string }> = {
  pending:  { bg: '#fef9c3', text: '#854d0e', label: 'Pending' },
  approved: { bg: '#dcfce7', text: '#166534', label: 'Approved' },
  rejected: { bg: '#fee2e2', text: '#991b1b', label: 'Rejected' },
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function dayCount(start: string, end: string) {
  const n = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1
  return `${n} day${n !== 1 ? 's' : ''}`
}

export default function LeavePage() {
  const { requests, loading, submitting, error, submit } = useLeaveRequests()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [success, setSuccess] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSuccess(false)
    if (endDate < startDate) {
      setFormError('End date must be on or after start date.')
      return
    }
    const ok = await submit(startDate, endDate, reason.trim())
    if (ok) {
      setStartDate('')
      setEndDate('')
      setReason('')
      setSuccess(true)
    }
  }

  const showDayCount = startDate && endDate && endDate >= startDate

  return (
    <AppLayout>
      {/* Request form */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>
          Request Leave
        </h2>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: showDayCount ? '0.5rem' : '1rem' }}>
            <div>
              <label style={labelStyle}>Start date</label>
              <input
                type="date"
                value={startDate}
                min={today}
                onChange={e => { setStartDate(e.target.value); setSuccess(false) }}
                required
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>End date</label>
              <input
                type="date"
                value={endDate}
                min={startDate || today}
                onChange={e => { setEndDate(e.target.value); setSuccess(false) }}
                required
                style={inputStyle}
              />
            </div>
          </div>

          {showDayCount && (
            <p style={{ margin: '0 0 1rem', fontSize: '0.8125rem', color: '#64748b' }}>
              {dayCount(startDate, endDate)}
            </p>
          )}

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>Reason</label>
            <textarea
              value={reason}
              onChange={e => { setReason(e.target.value); setSuccess(false) }}
              required
              rows={3}
              placeholder="Brief description of reason for leave"
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
            />
          </div>

          {(formError || error) && (
            <div style={alertStyle('#fef2f2', '#fecaca', '#dc2626')}>
              {formError ?? error}
            </div>
          )}

          {success && (
            <div style={alertStyle('#f0fdf4', '#bbf7d0', '#166534')}>
              Leave request submitted — your manager will review it shortly.
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '0.625rem 1.5rem',
              background: submitting ? '#86efac' : '#16a34a',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: '0.9375rem',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      </div>

      {/* Request history */}
      <div style={{ ...card, marginTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
          My Requests
        </h3>
        {loading ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p>
        ) : requests.length === 0 ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>No leave requests yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {requests.map(r => <RequestRow key={r.id} r={r} />)}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function RequestRow({ r }: { r: LeaveRequest }) {
  const s = STATUS_STYLES[r.status]
  return (
    <div style={{
      border: '1px solid #e2e8f0',
      borderRadius: 12,
      padding: '0.875rem 1rem',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: '1rem',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: '#1e293b', marginBottom: '0.2rem' }}>
          {fmtDate(r.start_date)}
          {r.start_date !== r.end_date && <> – {fmtDate(r.end_date)}</>}
          <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.8125rem', marginLeft: 8 }}>
            {dayCount(r.start_date, r.end_date)}
          </span>
        </div>
        <div style={{
          color: '#64748b',
          fontSize: '0.875rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {r.reason}
        </div>
        <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.25rem' }}>
          Submitted {new Date(r.requested_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
      <span style={{
        flexShrink: 0,
        padding: '3px 12px',
        borderRadius: 99,
        background: s.bg,
        color: s.text,
        fontWeight: 600,
        fontSize: '0.8125rem',
        marginTop: 2,
      }}>
        {s.label}
      </span>
    </div>
  )
}

function alertStyle(bg: string, border: string, color: string): CSSProperties {
  return {
    marginBottom: '1rem',
    padding: '0.75rem',
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 8,
    color,
    fontSize: '0.875rem',
  }
}

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: '1.5rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.875rem',
  fontWeight: 500,
  marginBottom: '0.375rem',
  color: '#374151',
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: '0.9375rem',
  outline: 'none',
  boxSizing: 'border-box',
  color: '#1e293b',
  fontFamily: 'inherit',
}
