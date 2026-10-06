import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { CSSProperties } from 'react'
import AppLayout from '../components/AppLayout'
import { useLeaveRequests } from '../hooks/useLeaveRequests'
import type { HalfDaySession, LeaveRequest, LeaveTypeCode } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { useHolidayDates, useLeaveBalances, useLeaveCapPreview } from '../hooks/useLeaveBalances'
import LeaveBalanceCards from '../components/LeaveBalanceCards'
import ChoiceHolidayCard from '../components/ChoiceHolidayCard'
import OtherRequests from '../components/OtherRequests'
import { LEAVE_TYPE_LABELS, addDays, bookableAsOf, bookableDays, coversToday, daysLabel, findLeaveClash, fmtDays, fmtLeaveSpan, isMonthCapped, workingDays } from '../lib/leave'
import { localDate, monthLabel } from '../lib/calendar'
import { canCancel, cancelDeadline, leaveLength, sameDayLeaveBlock } from '../lib/halfDay'
import { fmtClock, sessionLabel } from '../lib/shifts'
import { useMyShift } from '../hooks/useShifts'
import type { Shift } from '../types'
import { VoiceNotePlayer, VoiceNoteRecorder } from '../components/VoiceNote'
import { DocumentPicker, LeaveDocsPanel } from '../components/LeaveDocuments'
import { useLeaveDocuments } from '../hooks/useLeaveDocuments'
import { leaveDocDeadline, leaveDocsOpen, takesDocuments } from '../lib/leaveDocs'
import type { LeaveDocument } from '../types'
import type { VoiceNote } from '../lib/voiceNotes'

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
  const { requests, loading, submitting, error, warning, checkedInToday, submit, cancel, cancelToday } = useLeaveRequests()
  // Arrived from the dashboard's "Cancel Leave" button: open that request's cancel options
  const [params, setParams] = useSearchParams()
  const cancelId = params.get('cancel')
  const [cancelledToday, setCancelledToday] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const { employee: me } = useAuth()
  const docs = useLeaveDocuments(me?.id)
  // Sick leave still open for documents but with none attached
  const missingDocs = requests.filter(r => leaveDocsOpen(r) && !docs.byLeave.get(r.id)?.length).slice(0, 3)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [duration, setDuration] = useState<LeaveRequest['duration']>('full')
  const [session, setSession] = useState<HalfDaySession>('morning')
  const [leaveType, setLeaveType] = useState<LeaveTypeCode>('casual')
  const { employee } = useAuth()
  const current = useLeaveBalances(employee?.id)
  const [reason, setReason] = useState('')
  const [voiceNote, setVoiceNote] = useState<VoiceNote | null>(null)
  const [recording, setRecording] = useState(false)
  const [docFiles, setDocFiles] = useState<File[]>([])
  const [splitAccepted, setSplitAccepted] = useState<string | null>(null)  // key of the request they agreed to split
  const [success, setSuccess] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const today = localDate()
  // Today's shift sets the same-day limits; the leave day's shift sets its session times
  const { shift: todayShift } = useMyShift()
  const { shift: leaveShift } = useMyShift(startDate || today)

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
    const blocked = startDate === localDate() && sameDayLeaveBlock(todayShift, duration, half ? session : null, checkedInToday)
    if (blocked) {
      setFormError(blocked)
      return
    }
    if (!reason.trim() && !voiceNote) {
      setFormError('Write a reason or record a voice note.')
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
      split_with_lop: !!split,
    }, voiceNote, leaveType === 'sick' ? docFiles : [])
    if (ok) {
      current.refresh()
      booking.refresh()
      capPreview.refresh()
      setStartDate('')
      setEndDate('')
      setReason('')
      setVoiceNote(null)
      setDocFiles([])
      setSplitAccepted(null)
      docs.reload()
      setSuccess(true)
    }
  }

  const isHalf = duration === 'half'
  const showDayCount = !isHalf && startDate && endDate && endDate >= startDate
  // Leave starting today is limited by the time and whether they've checked in
  const startsToday = startDate === today
  const sameDayBlock = startsToday ? sameDayLeaveBlock(todayShift, duration, isHalf ? session : null, checkedInToday) : null
  const sessionBlocked = (s: HalfDaySession) => startsToday && sameDayLeaveBlock(todayShift, 'half', s, checkedInToday) !== null

  // Paid leave must fit in what's credited so far, minus pending requests (the server enforces this too)
  const rangeEnd = isHalf ? startDate : endDate
  const [holidayVersion, setHolidayVersion] = useState(0)   // bumped when they choose a holiday date
  const holidays = useHolidayDates(startDate, rangeEnd, employee?.id, holidayVersion)
  const booking = useLeaveBalances(employee?.id, bookableAsOf(startDate || today, today))
  const requested = startDate && rangeEnd && rangeEnd >= startDate ? workingDays(startDate, rangeEnd, isHalf, holidays) : null
  const typeBalance = booking.balances.find(b => b.leave_type === leaveType)
  const free = typeBalance?.is_paid ? bookableDays(typeBalance) : null
  const typeName = LEAVE_TYPE_LABELS[leaveType]
  // Monthly Casual / Earned limits: paid days past a limit become Loss of Pay automatically (the server decides)
  const capPreview = useLeaveCapPreview(startDate, rangeEnd, duration, leaveType)
  const capPaid = isMonthCapped(leaveType) && capPreview.preview && requested != null ? Math.min(requested, capPreview.preview.capPaid) : requested
  const capMonths = capPreview.preview?.months ?? []
  // Asking for more than is left: offer to use what's left and take the rest as Loss of Pay
  const paidPart = free == null ? 0 : Math.floor(free * 2) / 2   // leave is taken in half days
  const balanceShort = free != null && capPaid != null && paidPart < capPaid
  const splitOffer = balanceShort && paidPart > 0
    ? { key: `${leaveType}|${startDate}|${rangeEnd}|${duration}|${requested}`, paid: paidPart, lop: requested! - paidPart }
    : null
  const split = splitOffer && splitAccepted === splitOffer.key ? splitOffer : null
  const balanceBlock = free == null || split ? null
    : paidPart === 0 && (capPaid == null || capPaid > 0)
      ? `You have no ${typeName} leave left${typeBalance!.pending > 0 ? ` (${daysLabel(typeBalance!.pending)} waiting for approval)` : ''}. Choose another leave type or Loss of Pay.`
      : splitOffer
        ? `Not enough ${typeName} leave: this request needs ${daysLabel(capPaid!)} but only ${daysLabel(free)} ${free === 1 ? 'is' : 'are'} available.`
        : null
  // Over a monthly limit (and the balance isn't the problem): shown, no consent needed
  const capSplit = !balanceShort && free != null && requested != null && capPaid != null && capPaid < requested
    ? { paid: capPaid, lop: requested - capPaid }
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
    <AppLayout medium>
      <LeaveBalanceCards balances={current.balances} loading={current.loading} error={current.error} />
      <p style={{ margin: '-0.5rem 0 1.25rem', fontSize: '0.875rem' }}>
        <Link to="/leave-policy" style={{ color: 'var(--green-dark, #1d5a1f)', fontWeight: 700 }}>Read the leave policy</Link>
        <span style={{ color: 'var(--text-muted, #5b6f61)' }}> · how leave is credited, holidays, limits and timings</span>
      </p>

      {missingDocs.length > 0 && (
        <div style={{ ...alertStyle('#fffbeb', '#fde68a', '#92400e'), marginBottom: '1.5rem' }}>
          {missingDocs.map(r => (
            <div key={r.id}>
              Your sick leave on <b>{fmtSpan(r)}</b> has no medical document. You can add one until{' '}
              {leaveDocDeadline(r).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.{' '}
              <button
                type="button"
                onClick={() => document.getElementById(`leave-${r.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                style={{ ...cancelLinkStyle, color: '#92400e', textDecoration: 'underline' }}
              >
                Add document
              </button>
            </div>
          ))}
        </div>
      )}

      {cancelledToday && (
        <div style={{ ...alertStyle('#f0fdf4', '#bbf7d0', '#166534'), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <span>Today’s leave is cancelled and your admin has been notified. You can check in now.</span>
          <span style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => { setCancelledToday(false); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
              style={keepBtnStyle}
            >
              Apply for new dates
            </button>
            <Link to="/dashboard" style={{ ...confirmBtnStyle, background: 'var(--green-btn-1, #16a34a)', textDecoration: 'none' }}>Go to Check In</Link>
          </span>
        </div>
      )}

      <ChoiceHolidayCard onChanged={() => setHolidayVersion(v => v + 1)} />

      {/* Request form */}
      <div style={{ ...card, ...requestCard }} ref={formRef}>
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
                    {sessionLabel(leaveShift, s)}
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
                  ? `Once approved, Check In opens at ${fmtClock(leaveShift.split_time)} that day.`
                  : `Once approved, you’ll be checked out automatically at ${fmtClock(leaveShift.split_time)} that day.`}
              </p>
            </div>
          ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: showDayCount ? '0.5rem' : '1rem' }}>
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
            <label style={labelStyle} htmlFor="leave-reason">Reason</label>
            <textarea
              id="leave-reason"
              value={reason}
              onChange={e => { setReason(e.target.value); setSuccess(false) }}
              required={!voiceNote}
              rows={3}
              placeholder={voiceNote ? 'Optional — your voice note will be sent' : 'Brief description of reason for leave'}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
            />
            <div style={{ marginTop: '0.625rem' }}>
              <VoiceNoteRecorder
                value={voiceNote}
                onChange={n => { setVoiceNote(n); setSuccess(false) }}
                onRecordingChange={setRecording}
              />
            </div>
          </div>

          {leaveType === 'sick' && (
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Medical documents</label>
              <DocumentPicker files={docFiles} onChange={setDocFiles} />
            </div>
          )}

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
              {formBlock === balanceBlock && (
                <div style={{ marginTop: '0.625rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {splitOffer && (
                    <button type="button" onClick={() => setSplitAccepted(splitOffer.key)} style={splitBtn}>
                      Use {daysLabel(splitOffer.paid)} {typeName} + {daysLabel(splitOffer.lop)} Loss of Pay
                    </button>
                  )}
                  <button type="button" onClick={() => { setLeaveType('lop'); setSuccess(false) }} style={{ ...splitBtn, background: 'transparent' }}>
                    Take all as Loss of Pay
                  </button>
                </div>
              )}
            </div>
          )}

          {isMonthCapped(leaveType) && capMonths.length > 0 && !formBlock && (
            <div style={alertStyle(capSplit ? '#fffbeb' : '#f8fafc', capSplit ? '#fde68a' : '#e2e8f0', capSplit ? '#92400e' : '#475569')}>
              {capMonths.map(m => (
                <div key={m.month}>
                  <b>{monthLabel(m.month.slice(0, 7))}</b> is limited to {daysLabel(m.max_days)} of Casual + Earned leave
                  {m.note && ` (${m.note})`}. You’ve used or requested {fmtDays(m.used)}.
                </div>
              ))}
              {capSplit && (
                <div style={{ marginTop: '0.375rem' }}>
                  This request: <b>{daysLabel(capSplit.paid)} {typeName}</b> + <b style={{ color: '#b91c1c' }}>{daysLabel(capSplit.lop)} Loss of Pay</b> (unpaid).
                </div>
              )}
            </div>
          )}

          {split && !formBlock && (
            <div style={alertStyle('#eff6ff', '#bfdbfe', '#1e40af')}>
              <b>{daysLabel(split.paid)} {typeName}</b> + <b style={{ color: '#b91c1c' }}>{daysLabel(split.lop)} Loss of Pay</b> (unpaid).
              {' '}
              <button type="button" onClick={() => setSplitAccepted(null)} style={{ ...cancelLinkStyle, color: '#1e40af', textDecoration: 'underline' }}>
                Undo
              </button>
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

          {success && warning && (
            <div style={alertStyle('#fffbeb', '#fde68a', '#92400e')}>{warning}</div>
          )}

          <button
            type="submit"
            disabled={submitting || recording || !!formBlock}
            style={{
              padding: '0.625rem 1.5rem',
              background: submitting || recording || formBlock ? 'var(--brand-300)' : 'var(--brand-600)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: '0.9375rem',
              cursor: submitting || recording || formBlock ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      </div>

      <OtherRequests />

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {byMonth(requests).map(([ym, list]) => (
              <section key={ym} aria-label={monthLabel(ym)}>
                <h4 style={monthHeading}>
                  {monthLabel(ym)}
                  <span style={{ fontWeight: 500, color: 'var(--text-faint, #94a3b8)' }}> · {list.length} request{list.length === 1 ? '' : 's'}</span>
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {list.map(r => (
                    <RequestRow
                      key={r.id}
                      r={r}
                      shift={todayShift}
                      today={today}
                      todayCancel={coversToday(r, today) && !checkedInToday}
                      autoOpen={r.id === cancelId}
                      docs={docs.byLeave.get(r.id) ?? []}
                      onDocsChanged={docs.reload}
                      onCancel={() => cancel(r.id)}
                      onCancelToday={async mode => {
                        const err = await cancelToday(r.id, mode)
                        if (!err) {
                          setCancelledToday(true)
                          setParams({}, { replace: true })
                          current.refresh()
                          booking.refresh()
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }
                        return err
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

/** Requests grouped by the month their leave starts in: newest month first, latest dates first within it. */
function byMonth(requests: LeaveRequest[]): [string, LeaveRequest[]][] {
  const groups = new Map<string, LeaveRequest[]>()
  for (const r of [...requests].sort((a, b) => b.start_date.localeCompare(a.start_date) || b.requested_at.localeCompare(a.requested_at))) {
    const ym = r.start_date.slice(0, 7)
    groups.set(ym, [...(groups.get(ym) ?? []), r])
  }
  return [...groups]
}

const monthHeading: CSSProperties = {
  margin: '0 0 0.625rem',
  paddingBottom: '0.375rem',
  borderBottom: '1px solid var(--border, #e2e8f0)',
  fontSize: '0.8125rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted, #64748b)',
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

/**
 * `shift` is today's; a future shift change could move the real deadline, which the server enforces.
 * `todayCancel`: full-day leave covering today, not checked in — today's part can be cancelled any time today.
 */
function RequestRow({ r, shift, today, todayCancel, autoOpen, docs, onDocsChanged, onCancel, onCancelToday }: {
  r: LeaveRequest
  shift: Shift
  today: string
  todayCancel: boolean
  autoOpen: boolean
  docs: LeaveDocument[]
  onDocsChanged: () => void
  onCancel: () => Promise<string | null>
  onCancelToday: (mode: 'today' | 'onward') => Promise<string | null>
}) {
  const s = STATUS_STYLES[r.status]
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [mode, setMode] = useState<'today' | 'onward'>('today')
  const rowRef = useRef<HTMLDivElement>(null)
  const cancellable = todayCancel || canCancel(shift, r)

  useEffect(() => {
    if (autoOpen && todayCancel) {
      setConfirming(true)
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [autoOpen, todayCancel])

  async function handleCancel() {
    setBusy(true)
    setCancelError(null)
    const err = todayCancel ? await onCancelToday(mode) : await onCancel()
    setBusy(false)
    if (err) setCancelError(err)
    else setConfirming(false)
  }

  // Today's part of a multi-day leave: only today, or today onward
  const before = r.start_date < today ? fmtLeaveSpan(r.start_date, addDays(today, -1)) : null
  const after = r.end_date > today ? fmtLeaveSpan(addDays(today, 1), r.end_date) : null
  const todayOptions = todayCancel && after ? [
    { mode: 'today' as const, label: `Only today (${fmtLeaveSpan(today, today)})`,
      detail: `${[before, after].filter(Boolean).join(' and ')} stay${before ? '' : 's'} as leave` },
    { mode: 'onward' as const, label: before ? `Today onward (${fmtLeaveSpan(today, r.end_date)})` : `The whole leave (${fmtLeaveSpan(r.start_date, r.end_date)})`,
      detail: before ? `${before} stays as leave` : 'Nothing stays as leave' },
  ] : null

  return (
    <div ref={rowRef} id={`leave-${r.id}`} style={{
      border: autoOpen && todayCancel ? '2px solid #dc2626' : '1px solid var(--border, #e2e8f0)',
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
              {r.status === 'pending' && r.planned_paid_days != null && r.days != null && (
                <span style={{ color: 'var(--red, #b91c1c)' }}> · {fmtDays(r.planned_paid_days)} {LEAVE_TYPE_LABELS[r.leave_type]}, {fmtDays(r.days - r.planned_paid_days)} LOP</span>
              )}
              {r.status === 'approved' && r.lop_days != null && r.lop_days > 0 && (
                <span style={{ color: 'var(--red, #b91c1c)' }}> · {fmtDays(r.paid_days)} paid, {fmtDays(r.lop_days)} LOP</span>
              )}
            </span>
          </div>
          <div style={{
            color: 'var(--text-muted, #64748b)',
            fontSize: '0.875rem',
            overflowWrap: 'anywhere',
          }}>
            {r.reason}
          </div>
          {r.voice_note_path && <VoiceNotePlayer path={r.voice_note_path} seconds={r.voice_note_seconds} />}
          {takesDocuments(r) && <LeaveDocsPanel leave={r} docs={docs} onChanged={onDocsChanged} />}
          <div style={{ color: 'var(--text-faint, #94a3b8)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Submitted {new Date(r.requested_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
            {r.cancelled_at && <> · Cancelled {new Date(r.cancelled_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</>}
            {todayCancel
              ? <> · Today’s leave can be cancelled until you check in</>
              : cancellable && <> · Can be cancelled until {fmtDeadline(cancelDeadline(shift, r))}</>}
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
          {todayOptions ? (
            <div role="radiogroup" aria-label="What to cancel" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--red, #b91c1c)', fontWeight: 600 }}>
                What would you like to cancel? Your admin will be notified.
              </span>
              {todayOptions.map(o => (
                <label key={o.mode} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.875rem', color: 'var(--text-strong, #1e293b)', cursor: 'pointer' }}>
                  <input type="radio" name={`cancel-${r.id}`} checked={mode === o.mode} onChange={() => setMode(o.mode)} style={{ marginTop: 3 }} />
                  <span>
                    <b>{o.label}</b>
                    <span style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted, #64748b)' }}>{o.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: '0.875rem', color: 'var(--red, #b91c1c)' }}>
              {todayCancel
                ? <>Cancel today’s leave ({fmtLeaveSpan(today, today)})?{before && <> {before} stays as leave.</>} Your admin will be notified.</>
                : <>Cancel this {r.status === 'approved' ? 'approved ' : ''}leave? Your admin will be notified.</>}
            </span>
          )}
          <span style={{ display: 'flex', gap: '0.5rem', marginLeft: todayOptions ? 'auto' : undefined }}>
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

const splitBtn: CSSProperties = {
  padding: '0.375rem 0.75rem',
  borderRadius: 8,
  border: '1px solid #d97706',
  background: '#fff',
  color: '#92400e',
  fontWeight: 600,
  fontSize: '0.8125rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
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
    border: active ? '2px solid var(--brand-600)' : '1px solid var(--border, #d1d5db)',
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

// Soft brand-green tint so the form stands out from the other cards
const requestCard: CSSProperties = {
  background: 'var(--green-soft, #e6f2e1)',
  border: '1px solid color-mix(in srgb, var(--green, #3d7f1f) 22%, transparent)',
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
  minWidth: 0,
  padding: '0.625rem 0.75rem',
  border: '1px solid var(--border, #d1d5db)',
  borderRadius: 8,
  fontSize: '0.9375rem',
  outline: 'none',
  boxSizing: 'border-box',
  color: 'var(--text-strong, #1e293b)',
  background: 'var(--surface, #fff)',
  fontFamily: 'inherit',
}
