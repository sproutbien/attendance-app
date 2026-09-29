import type { CSSProperties } from 'react'
import type { LeaveBalance, LeaveTypeCode } from '../types'
import { fmtDays, leaveYearLabel, leaveYearOf } from '../lib/leave'
import { localDate } from '../lib/calendar'

const ACCENT: Record<LeaveTypeCode, string> = {
  casual: '#16a34a',
  sick:   '#0284c7',
  earned: '#7c3aed',
  lop:    '#dc2626',
}

/** One card per leave type: available balance plus how it was worked out. */
export default function LeaveBalanceCards({ balances, loading, error, compact }: {
  balances: LeaveBalance[]
  loading: boolean
  error: string | null
  compact?: boolean   // admin dialogs: no heading, tighter cards
}) {
  if (error) return <p style={{ color: 'var(--red, #b91c1c)', margin: '0 0 1rem' }}>{error}</p>

  return (
    <div style={{ marginBottom: compact ? '1rem' : '1.5rem' }}>
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-strong, #1e293b)' }}>My Leave Balance</h2>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted, #64748b)' }}>Leave year {leaveYearLabel(leaveYearOf(localDate()))}</span>
        </div>
      )}
      {loading ? (
        <p style={{ margin: 0, color: 'var(--text-faint, #94a3b8)' }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
          {balances.map(b => (
            <div key={b.leave_type} style={{ ...cardStyle, borderTop: `3px solid ${ACCENT[b.leave_type]}`, padding: compact ? '0.75rem' : '1rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-muted, #64748b)' }}>{b.name}</div>
              {b.is_paid ? (
                <>
                  <div style={{ fontSize: compact ? '1.375rem' : '1.75rem', fontWeight: 800, color: ACCENT[b.leave_type], lineHeight: 1.2 }}>
                    {fmtDays(b.available)}
                    <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-faint, #94a3b8)' }}> available</span>
                  </div>
                  <div style={detailStyle}>
                    {fmtDays(b.accrued)} credited
                    {b.carried > 0 && <> · {fmtDays(b.carried)} carried</>}
                    {b.adjusted !== 0 && <> · {b.adjusted > 0 ? '+' : ''}{fmtDays(b.adjusted)} adjusted</>}
                    {' · '}{fmtDays(b.used)} used
                  </div>
                  {b.pending > 0 && <div style={{ ...detailStyle, color: '#b45309' }}>{fmtDays(b.pending)} pending approval</div>}
                </>
              ) : (
                <>
                  <div style={{ fontSize: compact ? '1.375rem' : '1.75rem', fontWeight: 800, color: ACCENT.lop, lineHeight: 1.2 }}>
                    {fmtDays(b.used)}
                    <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-faint, #94a3b8)' }}> taken</span>
                  </div>
                  <div style={detailStyle}>Unpaid days this year</div>
                  {b.pending > 0 && <div style={{ ...detailStyle, color: '#b45309' }}>{fmtDays(b.pending)} pending approval</div>}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const cardStyle: CSSProperties = {
  background: 'var(--surface, #fff)',
  borderRadius: 12,
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  border: '1px solid var(--border, #e2e8f0)',
}

const detailStyle: CSSProperties = {
  marginTop: '0.25rem',
  fontSize: '0.75rem',
  color: 'var(--text-faint, #94a3b8)',
}
