import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useLeaveQueue } from '../../hooks/useLeaveQueue'
import type { LeaveRequestWithEmployee } from '../../hooks/useLeaveQueue'

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function dayCount(start: string, end: string) {
  const n = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1
  return `${n} day${n !== 1 ? 's' : ''}`
}

const REVIEWED_STATUS_STYLES = {
  approved: { bg: '#dcfce7', text: '#166534', label: 'Approved' },
  rejected: { bg: '#fee2e2', text: '#991b1b', label: 'Rejected' },
  pending:  { bg: '#fef9c3', text: '#854d0e', label: 'Pending'  },
}

export default function AdminLeavePage() {
  const { pending, reviewed, loading, actioning, approve, reject } = useLeaveQueue()
  const [showReviewed, setShowReviewed] = useState(false)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
          Leave Requests
        </h1>
        {!loading && pending.length > 0 && (
          <span style={{
            background: '#fef9c3',
            color: '#854d0e',
            fontWeight: 700,
            fontSize: '0.8125rem',
            padding: '2px 10px',
            borderRadius: 99,
          }}>
            {pending.length} pending
          </span>
        )}
      </div>

      {/* Pending section */}
      <div style={{ ...card, marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
          Pending Approval
        </h2>

        {loading ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p>
        ) : pending.length === 0 ? (
          <div style={{ padding: '2rem 0', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✓</div>
            <p style={{ color: '#64748b', margin: 0, fontWeight: 500 }}>All caught up — no pending requests.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pending.map(r => (
              <PendingCard
                key={r.id}
                request={r}
                isActioning={actioning.has(r.id)}
                onApprove={() => approve(r.id)}
                onReject={() => reject(r.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Reviewed section */}
      {!loading && reviewed.length > 0 && (
        <div style={card}>
          <button
            onClick={() => setShowReviewed(v => !v)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
              Reviewed ({reviewed.length})
            </h2>
            <span style={{ color: '#64748b', fontSize: '0.875rem' }}>{showReviewed ? '▲ Hide' : '▼ Show'}</span>
          </button>

          {showReviewed && (
            <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {reviewed.map(r => <ReviewedRow key={r.id} request={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PendingCard({
  request: r,
  isActioning,
  onApprove,
  onReject,
}: {
  request: LeaveRequestWithEmployee
  isActioning: boolean
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div style={{
      border: '1px solid #e2e8f0',
      borderRadius: 12,
      padding: '1.25rem',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: '1.5rem',
      flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>{r.employee.full_name}</span>
          {r.employee.department && (
            <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{r.employee.department}</span>
          )}
        </div>
        <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: '#374151', marginBottom: '0.25rem' }}>
          {fmtDate(r.start_date)}
          {r.start_date !== r.end_date && <> – {fmtDate(r.end_date)}</>}
          <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.8125rem', marginLeft: 8 }}>
            {dayCount(r.start_date, r.end_date)}
          </span>
        </div>
        <div style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '0.25rem' }}>{r.reason}</div>
        <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
          Submitted {fmtDate(r.requested_at.slice(0, 10))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, alignItems: 'center' }}>
        <button
          onClick={onReject}
          disabled={isActioning}
          style={{
            padding: '0.5rem 1.125rem',
            borderRadius: 8,
            border: '1px solid #fecaca',
            background: '#fff',
            color: '#dc2626',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: isActioning ? 'not-allowed' : 'pointer',
            opacity: isActioning ? 0.5 : 1,
          }}
        >
          Reject
        </button>
        <button
          onClick={onApprove}
          disabled={isActioning}
          style={{
            padding: '0.5rem 1.125rem',
            borderRadius: 8,
            border: 'none',
            background: isActioning ? '#86efac' : '#16a34a',
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: isActioning ? 'not-allowed' : 'pointer',
          }}
        >
          {isActioning ? '…' : 'Approve'}
        </button>
      </div>
    </div>
  )
}

function ReviewedRow({ request: r }: { request: LeaveRequestWithEmployee }) {
  const s = REVIEWED_STATUS_STYLES[r.status as keyof typeof REVIEWED_STATUS_STYLES]
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0.75rem 0',
      borderBottom: '1px solid #f1f5f9',
      gap: '1rem',
      flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, color: '#1e293b' }}>{r.employee.full_name}</span>
        <span style={{ color: '#94a3b8', fontSize: '0.8125rem', marginLeft: 8 }}>
          {fmtDate(r.start_date)}{r.start_date !== r.end_date ? ` – ${fmtDate(r.end_date)}` : ''}
          {' · '}{dayCount(r.start_date, r.end_date)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
        {r.reviewed_at && (
          <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
            {fmtDate(r.reviewed_at.slice(0, 10))}
          </span>
        )}
        <span style={{
          padding: '2px 10px',
          borderRadius: 99,
          background: s.bg,
          color: s.text,
          fontWeight: 600,
          fontSize: '0.8125rem',
        }}>
          {s.label}
        </span>
      </div>
    </div>
  )
}

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: '1.5rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}
