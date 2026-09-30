import { useState } from 'react'
import type { CSSProperties } from 'react'
import AppLayout from '../components/AppLayout'
import { useLeaveRequests } from '../hooks/useLeaveRequests'
import type { HalfDaySession, LeaveRequest, LeaveTypeCode } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { useHolidayDates, useLeaveBalances } from '../hooks/useLeaveBalances'
import LeaveBalanceCards from '../components/LeaveBalanceCards'
import { LEAVE_TYPE_LABELS, bookableAsOf, bookableDays, daysLabel, findLeaveClash, fmtDays, workingDays } from '../lib/leave'
import { localDate } from '../lib/calendar'
import { SESSION_LABELS, canCancel, cancelDeadline, leaveLength, sameDayLeaveBlock } from '../lib/halfDay'

const STATUS_STYLES: Record<LeaveRequest['status'], { bg: string; text: string; label: string }> = {
  pending:  { bg: '#fef9c3', text: '#854d0e', label: 'Pending' },
  approved: { bg: '#dcfce7', text: '#166534', label: 'Approved' },
  rejected: { bg: '#fee2e2', text: '#991b1b', label: 'Rejected' },
  cancelled: { bg: '#f1f5f9', text: '#475569', label: 'Cancelled' },
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function LeavePage() {
  const { requests, loading, submitting, error, checkedInToday, submit, cancel } = useLeaveRequests()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [duration, setDuration] = useState<LeaveRequest['duration']>('full')
  const [session, setSession] = useState<HalfDaySession>('morning')
  const [leaveType, setLeaveType] = useState<LeaveTypeCode>('casual')
  const { employee } = useAuth()
  const current = useLeaveBalances(employee?.id)
  const [reason, setReason] = useState('')
  const [success, setSuccess] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const today = localDate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSuccess(false)
    const half = duration === 'half'
    if (!half && endDate < startDate) {
      setFormError('End date must be on or after start date.')
      return
    }
    // Re-check at submit time — the page may have been open since before a cut-off
    const blocked = startDate === localDate() && sameDayLeaveBlock(duration, half ? session : null, checkedInToday)
    if (blocked) {
      setFormError(blocked)
      return
    }
    if (clashMessage ?? balanceBlock) {
      setFormError(clashMessage ?? balanceBlock)
      return
    }
    const ok = await submit({
      start_date: startDate,
      end_date: half ? startDate : endDate,
      duration,
      half_day_session: half ? session : null,
      leave_type: leaveType,
      reason: reason.trim(),
    })
    if (ok) {
      current.refresh()
      booking.refresh()
      setStartDate('')
      setEndDate('')
      setReason('')
      setSuccess(true)
    }
  }

  const isHalf = duration === 'half'
  const showDayCount = !isHalf && startDate && endDate && endDate >= startDate
  // Leave starting today is limited by the time and whether they've checked in
  const startsToday = startDate === today
  const sameDayBlock = startsToday ? sameDayLeaveBlock(duration, isHalf ? session : null, checkedInToday) : null
  const sessionBlocked = (s: HalfDaySession) => startsToday && sameDayLeaveBlock('half', s, checkedInToday) !== null

  // Paid leave must fit in what's credited so far, minus pending requests (the server enforces this too)
  const rangeEnd = isHalf ? startDate : endDate
  const holidays = useHolidayDates(startDate, rangeEnd)
  const booking = useLeaveBalances(employee?.id, bookableAsOf(startDate || today, today))
  const requested = startDate && rangeEnd && rangeEnd >= startDate ? workingDays(startDate, rangeEnd, isHalf, holidays) : null
  const typeBalance = booking.balances.find(b => b.leave_type === leaveType)
  const free = typeBalance?.is_paid ? bookableDays(typeBalance) : null
  const typeName = LEAVE_TYPE_LABELS[leaveType]
  const balanceBlock = free == null ? null
    : free === 0
      ? `You have no ${typeName} leave left${typeBalance!.pending > 0 ? ` (${daysLabel(typeBalance!.pending)} waiting for approval)` : ''}. Choose another leave type or Loss of Pay.`
      : requested != null && requested > free
        ? `Not enough ${typeName} leave: this request needs ${daysLabel(requested)} but only ${daysLabel(free)} ${free === 1 ? 'is' : 'are'} available. Pick fewer days or choose Loss of Pay.`
        : null

  // Days that already have pending or approved leave can't be requested again
  const clash = startDate && rangeEnd && rangeEnd >= startDate
    ? findLeaveClash(requests, { start_date: startDate, end_date: rangeEnd, duration, half_day_session: isHalf ? session : null })
    : undefined
  const clashMessage = clash
    ? `You already have ${clash.status} leave for ${fmtSpan(clash)}. Cancel it first if you want to change it.`
    : null
  const formBlock = clashMessage ?? sameDayBlock ?? balanceBlock
  // Upcoming booked days, so they know what to avoid
  const booked = requests
    .filter(r => (r.status === 'pending' || r.status === 'approved') && r.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 6)

  return (
    <AppLayout>
      <LeaveBalanceCards balances={current.balances} loading={current.loading} error={current.error} />

      {/* Request form */}
      <div style={card}>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-strong, #1e293b)' }}>
          Request Leave
        </h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle} htmlFor="leave-type">Leave type</label>
            <select
              id="leave-type"
              value={leaveType}
              onChange={e => { setLeaveType(e.target.value as LeaveTypeCode); setSuccess(false) }}
              style={{ ...inputStyle, maxWidth: 320 }}
            >
              {booking.balances.length === 0
                ? (Object.keys(LEAVE_TYPE_LABELS) as LeaveTypeCode[]).map(c => <option key={c} value={c}>{LEAVE_TYPE_LABELS[c]}</option>)
                : booking.balances.map(b => {
                  const left = bookableDays(b)
                  return (
                    <option key={b.leave_type} value={b.leave_type} disabled={b.is_paid && left === 0}>
                      {b.name}{!b.is_paid ? ' (unpaid)' : left === 0 ? ' (none left)' : ` (${fmtDays(left)} available)`}
                    </option>
                  )
                })}
            </select>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Duration</label>
            <div role="radiogroup" aria-label="Duration" style={segmentWrap}>
              {(['full', 'half'] as const).map(d => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={duration === d}
                  onClick={() => { setDuration(d); setSuccess(false) }}
                  style={segmentBtn(duration === d)}
                >
                  {d === 'full' ? 'Full day' : 'Half day'}
                </button>
              ))}
            </div>
          </div>

          {isHalf ? (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Date</label>
                <input
                  type="date"
                  value={startDate}
                  min={today}
                  onChange={e => { setStartDate(e.target.value); setSuccess(false) }}
                  required
                  style={inputStyle}
                />
              </div>
              <label style={labelStyle}>Session</label>
              <div role="radiogroup" aria-label="Session" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.625rem' }}>
                {(['morning', 'afternoon'] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={session === s}
                    onClick={() => { setSession(s); setSuccess(false) }}
                    style={{ ...sessionCard(session === s), ...(sessionBlocked(s) ? { opacity: 0.5 } : null) }}
                  >
                    {SESSION_LABELS[s]}
                    {sessionBlocked(s) && (
                      <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>
                        Not available today
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: 'var(--text-muted, #64748b)' }}>
                {session === 'morning'
                  ? 'Once approved, Check In opens at 1:30 PM that day.'
                  : 'Once approved, you’ll be checked out automatically at 1:30 PM that day.'}
              </p>
            </div>
          ) : (
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
          )}

          {requested != null && (
            <p style={{ margin: '0 0 1rem', fontSize: '0.8125rem', color: 'var(--text-muted, #64748b)' }}>
              {requested === 0
                ? 'These dates are all Sundays or holidays — no leave needed.'
                : <>
                    <b style={{ color: 'var(--text-strong, #1e293b)' }}>{daysLabel(requested)}</b>
                    {!isHalf && showDayCount && ' (Sundays and holidays not counted)'}
                    {leaveType === 'lop'
                      ? ' · unpaid'
                      : <> · from {typeName} ({fmtDays(free)} available)</>}
                  </>}
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

          {booked.length > 0 && (
            <p style={{ margin: '0 0 1rem', fontSize: '0.8125rem', color: 'var(--text-muted, #64748b)' }}>
              Already booked: {booked.map((r, i) => (
                <span key={r.id}>{i > 0 && ', '}{fmtSpan(r)} ({r.status})</span>
              ))}
            </p>
          )}

          {formBlock && !formError && (
            <div style={alertStyle('#fffbeb', '#fde68a', '#92400e')}>
              {formBlock}
            </div>
          )}

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
            disabled={submitting || !!formBlock}
            style={{
              padding: '0.625rem 1.5rem',
              background: submitting || formBlock ? '#86efac' : '#16a34a',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: '0.9375rem',
              cursor: submitting || formBlock ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      </div>

      {/* Request history */}
      <div style={{ ...card, marginTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: 'var(--text-strong, #1e293b)' }}>
          My Requests
        </h3>
        {loading ? (
          <p style={{ color: 'var(--text-faint, #94a3b8)', margin: 0 }}>Loading…</p>
        ) : requests.length === 0 ? (
          <p style={{ color: 'var(--text-faint, #94a3b8)', margin: 0 }}>No leave requests yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {requests.map(r => <RequestRow key={r.id} r={r} onCancel={() => cancel(r.id)} />)}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

/** "3 Oct" / "3 Oct (morning half)" / "10 Oct – 12 Oct" */
function fmtSpan(r: Pick<LeaveRequest, 'start_date' | 'end_date' | 'duration' | 'half_day_session'>) {
  const day = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  if (r.start_date !== r.end_date) return `${day(r.start_date)} – ${day(r.end_date)}`
  return r.duration === 'half' && r.half_day_session ? `${day(r.start_date)} (${r.half_day_session} half)` : day(r.start_date)
}

function fmtDeadline(d: Date) {
  return `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}, ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

function RequestRow({ r, onCancel }: { r: LeaveRequest; onCancel: () => Promise<string | null> }) {
  const s = STATUS_STYLES[r.status]
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const cancellable = canCancel(r)

  async function handleCancel() {
    setBusy(true)
    setCancelError(null)
    const err = await onCancel()
    setBusy(false)
    if (err) setCancelError(err)
    else setConfirming(false)
  }

  return (
    <div style={{
      border: '1px solid var(--border, #e2e8f0)',
      borderRadius: 12,
      padding: '0.875rem 1rem',
      opacity: r.status === 'cancelled' ? 0.75 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-strong, #1e293b)', marginBottom: '0.2rem' }}>
            {fmtDate(r.start_date)}
            {r.start_date !== r.end_date && <> – {fmtDate(r.end_date)}</>}
            <span style={{ fontWeight: 400, color: 'var(--text-faint, #94a3b8)', fontSize: '0.8125rem', marginLeft: 8 }}>
              {LEAVE_TYPE_LABELS[r.leave_type]} · {leaveLength(r)}
              {r.status === 'approved' && r.lop_days != null && r.lop_days > 0 && (
                <span style={{ color: 'var(--red, #b91c1c)' }}> · {fmtDays(r.paid_days)} paid, {fmtDays(r.lop_days)} LOP</span>
              )}
            </span>
          </div>
          <div style={{
            color: 'var(--text-muted, #64748b)',
            fontSize: '0.875rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {r.reason}
          </div>
          <div style={{ color: 'var(--text-faint, #94a3b8)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Submitted {new Date(r.requested_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
            {r.cancelled_at && <> · Cancelled {new Date(r.cancelled_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</>}
            {cancellable && <> · Can be cancelled until {fmtDeadline(cancelDeadline(r))}</>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem', flexShrink: 0 }}>
          <span style={{
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
          {cancellable && !confirming && (
            <button type="button" onClick={() => setConfirming(true)} style={cancelLinkStyle}>
              Cancel leave
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div style={{
          marginTop: '0.75rem',
          padding: '0.75rem',
          borderRadius: 10,
          background: 'var(--red-soft, #fef2f2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--red, #b91c1c)' }}>
            Cancel this {r.status === 'approved' ? 'approved ' : ''}leave? Your admin will be notified.
          </span>
          <span style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" onClick={() => { setConfirming(false); setCancelError(null) }} disabled={busy} style={keepBtnStyle}>
              Keep it
            </button>
            <button type="button" onClick={handleCancel} disabled={busy} style={confirmBtnStyle}>
              {busy ? 'Cancelling…' : 'Yes, cancel'}
            </button>
          </span>
          {cancelError && <span style={{ width: '100%', fontSize: '0.8125rem', color: 'var(--red, #b91c1c)' }}>{cancelError}</span>}
        </div>
      )}
    </div>
  )
}

const cancelLinkStyle: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'var(--red, #b91c1c)',
  fontSize: '0.8125rem',
  fontWeight: 600,
  cursor: 'pointer',
}

const keepBtnStyle: CSSProperties = {
  padding: '0.375rem 0.875rem',
  borderRadius: 8,
  border: '1px solid var(--border, #d1d5db)',
  background: 'var(--surface, #fff)',
  color: 'var(--text, #374151)',
  fontWeight: 600,
  fontSize: '0.8125rem',
  cursor: 'pointer',
}

const confirmBtnStyle: CSSProperties = {
  padding: '0.375rem 0.875rem',
  borderRadius: 8,
  border: 'none',
  background: '#dc2626',
  color: '#fff',
  fontWeight: 600,
  fontSize: '0.8125rem',
  cursor: 'pointer',
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

const segmentWrap: CSSProperties = {
  display: 'inline-flex',
  padding: 3,
  borderRadius: 10,
  background: 'var(--surface-soft, #f1f5f9)',
  border: '1px solid var(--border, #e2e8f0)',
}

function segmentBtn(active: boolean): CSSProperties {
  return {
    padding: '0.5rem 1.25rem',
    border: 'none',
    borderRadius: 8,
    background: active ? 'var(--surface, #fff)' : 'transparent',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
    color: active ? 'var(--green-dark, #166534)' : 'var(--text-muted, #64748b)',
    fontWeight: active ? 700 : 500,
    fontSize: '0.9rem',
    cursor: 'pointer',
  }
}

function sessionCard(active: boolean): CSSProperties {
  return {
    padding: '0.75rem 0.875rem',
    textAlign: 'left',
    borderRadius: 10,
    border: active ? '2px solid #16a34a' : '1px solid var(--border, #d1d5db)',
    background: active ? 'var(--green-soft, #f0fdf4)' : 'var(--surface, #fff)',
    color: 'var(--text-strong, #1e293b)',
    fontWeight: active ? 600 : 500,
    fontSize: '0.9rem',
    cursor: 'pointer',
  }
}

const card: CSSProperties = {
  background: 'var(--surface, #fff)',
  borderRadius: 16,
  padding: '1.5rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.875rem',
  fontWeight: 500,
  marginBottom: '0.375rem',
  color: 'var(--text, #374151)',
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.75rem',
  border: '1px solid var(--border, #d1d5db)',
  borderRadius: 8,
  fontSize: '0.9375rem',
  outline: 'none',
  boxSizing: 'border-box',
  color: 'var(--text-strong, #1e293b)',
  fontFamily: 'inherit',
}
