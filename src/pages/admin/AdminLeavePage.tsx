import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useLeaveQueue } from '../../hooks/useLeaveQueue'
import type { LeaveRequestWithEmployee } from '../../hooks/useLeaveQueue'
import { leaveLength } from '../../lib/halfDay'
import { LEAVE_TYPE_LABELS, daysLabel, fmtDays } from '../../lib/leave'
import { useLeaveBalances } from '../../hooks/useLeaveBalances'
import AdminLeaveBalances from '../../components/AdminLeaveBalances'
import LeaveTypeSettings from '../../components/LeaveTypeSettings'
import MonthlyLeaveCaps from '../../components/MonthlyLeaveCaps'
import { supabase } from '../../lib/supabase'
import { VoiceNotePlayer } from '../../components/VoiceNote'
import { LeaveDocsPanel } from '../../components/LeaveDocuments'
import { useLeaveDocuments } from '../../hooks/useLeaveDocuments'
import { takesDocuments } from '../../lib/leaveDocs'
import type { LeaveDocument } from '../../types'

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const STATUS_STYLES = {
  approved:  { bg: '#dcfce7', text: '#166534', label: 'Approved'  },
  rejected:  { bg: '#fee2e2', text: '#991b1b', label: 'Rejected'  },
  cancelled: { bg: '#f1f5f9', text: '#475569', label: 'Cancelled' },
  pending:   { bg: '#fef9c3', text: '#854d0e', label: 'Pending'   },
}

type HistoryFilter = 'all' | 'approved' | 'rejected' | 'cancelled'
const FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function AdminLeavePage() {
  const { pending, history, newCancellations, loading, actioning, approve, reject, markCancellationsSeen } = useLeaveQueue()
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'requests' | 'balances' | 'types'>('requests')
  const docs = useLeaveDocuments()

  const q = search.trim().toLowerCase()
  const shown = history.filter(r =>
    (filter === 'all' || r.status === filter) &&
    (!q || r.employee.full_name.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q)),
  )

  const tabs = (
    <div role="tablist" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '1px solid #e2e8f0' }}>
      {([['requests', 'Requests'], ['balances', 'Balances'], ['types', 'Leave types']] as const).map(([value, label]) => (
        <button
          key={value}
          role="tab"
          aria-selected={tab === value}
          onClick={() => setTab(value)}
          style={{
            padding: '0.5rem 1rem', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: '0.9375rem', fontWeight: tab === value ? 700 : 500,
            color: tab === value ? '#166534' : '#64748b',
            borderBottom: tab === value ? '2px solid #16a34a' : '2px solid transparent', marginBottom: -1,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )

  if (tab !== 'requests') {
    return (
      <div>
        <h1 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>Leave</h1>
        {tabs}
        {tab === 'balances' ? <AdminLeaveBalances /> : <><LeaveTypeSettings /><MonthlyLeaveCaps /></>}
      </div>
    )
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>Leave</h1>
      {tabs}
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 700, color: '#1e293b' }}>
          Leave Requests
        </h2>
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

      {/* Cancellation alerts — stay until an admin marks them seen */}
      {!loading && newCancellations.length > 0 && (
        <div style={{ ...card, marginBottom: '1.5rem', border: '1px solid #fecaca', background: '#fffafa' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#991b1b' }}>
              Cancelled by employees ({newCancellations.length})
            </h2>
            <button onClick={() => markCancellationsSeen(newCancellations.map(r => r.id))} style={smallBtn}>
              Mark all as seen
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {newCancellations.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '0.75rem 0', borderTop: '1px solid #fee2e2' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, color: '#1e293b' }}>
                    {r.employee.full_name}
                    <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 8, fontSize: '0.875rem' }}>
                      {fmtDate(r.start_date)}{r.start_date !== r.end_date ? ` – ${fmtDate(r.end_date)}` : ''} · {leaveLength(r)}
                    </span>
                  </div>
                  <div style={{ color: '#64748b', fontSize: '0.875rem', margin: '0.2rem 0' }}>{r.reason}</div>
                  {r.voice_note_path && <VoiceNotePlayer path={r.voice_note_path} seconds={r.voice_note_seconds} />}
                  <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                    {r.cancelled_after_approval ? 'Was approved' : 'Was pending'}
                    {r.cancelled_at && <> · cancelled {fmtDateTime(r.cancelled_at)}</>}
                  </div>
                </div>
                <button onClick={() => markCancellationsSeen([r.id])} style={smallBtn}>Seen</button>
              </div>
            ))}
          </div>
        </div>
      )}

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
                docs={docs.byLeave.get(r.id) ?? []}
                onDocsChanged={docs.reload}
                isActioning={actioning.has(r.id)}
                onApprove={() => approve(r.id)}
                onReject={() => reject(r.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* History: every decided or cancelled application, with its reason */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
            Past applications {!loading && `(${history.length})`}
          </h2>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or reason"
            style={{ padding: '0.4375rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', minWidth: 200 }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {FILTERS.map(f => {
            const active = filter === f.value
            const count = f.value === 'all' ? history.length : history.filter(r => r.status === f.value).length
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                aria-pressed={active}
                style={{
                  padding: '0.3125rem 0.875rem',
                  borderRadius: 99,
                  border: active ? '1px solid #16a34a' : '1px solid #e2e8f0',
                  background: active ? '#dcfce7' : '#fff',
                  color: active ? '#166534' : '#475569',
                  fontWeight: active ? 600 : 500,
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                }}
              >
                {f.label} ({count})
              </button>
            )
          })}
        </div>

        {loading ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p>
        ) : shown.length === 0 ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>No applications match.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {shown.map(r => <HistoryRow key={r.id} request={r} docs={docs.byLeave.get(r.id) ?? []} onDocsChanged={docs.reload} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function PendingCard({
  request: r,
  docs,
  onDocsChanged,
  isActioning,
  onApprove,
  onReject,
}: {
  request: LeaveRequestWithEmployee
  docs: LeaveDocument[]
  onDocsChanged: () => void
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
            {leaveLength(r)}
          </span>
        </div>
        <PendingBalanceLine request={r} />
        <div style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '0.25rem' }}>{r.reason}</div>
        {r.voice_note_path && <div style={{ marginBottom: '0.25rem' }}><VoiceNotePlayer path={r.voice_note_path} seconds={r.voice_note_seconds} /></div>}
        {takesDocuments(r) && <div style={{ marginBottom: '0.375rem' }}><LeaveDocsPanel leave={r} docs={docs} admin onChanged={onDocsChanged} /></div>}
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

/** Type, working days and the employee's balance for it, with a warning if part will be LOP. */
function PendingBalanceLine({ request: r }: { request: LeaveRequestWithEmployee }) {
  const { balances, loading } = useLeaveBalances(r.employee_id, r.start_date)
  // What approving now would pay: balance and the monthly Casual / Earned limits (migration 026)
  const [preview, setPreview] = useState<{ paid: number; capPaid: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    supabase.rpc('leave_approval_preview', { p_request: r.id }).then(({ data }) => {
      if (!cancelled && data) setPreview({ paid: Number(data.paid), capPaid: Number(data.cap_paid) })
    })
    return () => { cancelled = true }
  }, [r.id, r.days])
  const b = balances.find(x => x.leave_type === r.leave_type)
  const days = r.days ?? 0
  const available = b?.available ?? 0
  const lop = r.leave_type === 'lop' ? days
    : preview ? days - preview.paid
    : Math.max(0, days - Math.max(0, Math.floor(available * 2) / 2))
  const overMonthLimit = preview != null && preview.capPaid < days && preview.capPaid <= Math.floor(available * 2) / 2
  return (
    <div style={{ fontSize: '0.8125rem', color: '#475569', marginBottom: '0.25rem' }}>
      <b>{LEAVE_TYPE_LABELS[r.leave_type]}</b> · {daysLabel(days)}
      {r.leave_type !== 'lop' && !loading && b && <> · balance {fmtDays(b.available)}</>}
      {!loading && lop > 0 && r.leave_type !== 'lop' && (
        <span style={{ color: '#b91c1c', fontWeight: 600 }}>
          {' · '}{fmtDays(lop)} will be Loss of Pay
          {overMonthLimit ? ' (over the monthly limit)' : r.split_with_lop && ' (employee agreed)'}
        </span>
      )}
    </div>
  )
}

function HistoryRow({ request: r, docs, onDocsChanged }: { request: LeaveRequestWithEmployee; docs: LeaveDocument[]; onDocsChanged: () => void }) {
  const s = STATUS_STYLES[r.status]
  const decided = r.status === 'approved' || r.cancelled_after_approval ? 'Approved' : 'Rejected'
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      padding: '0.875rem 0',
      borderTop: '1px solid #f1f5f9',
      gap: '1rem',
      flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div>
          <span style={{ fontWeight: 600, color: '#1e293b' }}>{r.employee.full_name}</span>
          {r.employee.department && <span style={{ color: '#94a3b8', fontSize: '0.8125rem', marginLeft: 6 }}>{r.employee.department}</span>}
        </div>
        <div style={{ color: '#374151', fontSize: '0.875rem', fontWeight: 500, margin: '0.125rem 0' }}>
          {fmtDate(r.start_date)}{r.start_date !== r.end_date ? ` – ${fmtDate(r.end_date)}` : ''}
          <span style={{ color: '#94a3b8', fontWeight: 400 }}>{' · '}{LEAVE_TYPE_LABELS[r.leave_type]} · {leaveLength(r)}</span>
          {r.status === 'approved' && r.paid_days != null && (
            <span style={{ color: r.lop_days ? '#b91c1c' : '#94a3b8', fontWeight: 400 }}>
              {' · '}{fmtDays(r.paid_days)} paid{r.lop_days ? `, ${fmtDays(r.lop_days)} LOP` : ''}
            </span>
          )}
        </div>
        <div style={{ color: '#64748b', fontSize: '0.875rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          <span style={{ color: '#94a3b8' }}>Reason: </span>{r.reason || (r.voice_note_path ? '(voice note)' : '')}
        </div>
        {r.voice_note_path && <VoiceNotePlayer path={r.voice_note_path} seconds={r.voice_note_seconds} />}
        {takesDocuments(r) && <LeaveDocsPanel leave={r} docs={docs} admin onChanged={onDocsChanged} />}
        <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.25rem' }}>
          Submitted {fmtDate(r.requested_at.slice(0, 10))}
          {r.reviewed_at && <> · {decided} {fmtDate(r.reviewed_at.slice(0, 10))}</>}
          {r.cancelled_at && <> · Cancelled by employee {fmtDateTime(r.cancelled_at)}</>}
        </div>
      </div>
      <span style={{
        flexShrink: 0,
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
  )
}

const smallBtn: CSSProperties = {
  padding: '0.3125rem 0.75rem',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#374151',
  fontWeight: 600,
  fontSize: '0.8125rem',
  cursor: 'pointer',
  flexShrink: 0,
}

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: '1.5rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}
