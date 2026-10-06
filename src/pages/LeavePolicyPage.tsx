import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Clock, FileText, Repeat, Scale, ScrollText } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useAuth } from '../contexts/AuthContext'
import { useLeaveMonthCaps, useLeaveTypes } from '../hooks/useLeaveBalances'
import { useLeavePolicy } from '../hooks/useLeavePolicy'
import { useMyShift } from '../hooks/useShifts'
import { currentYearMonth, localDate, monthLabel } from '../lib/calendar'
import { fmtDays, leaveYearLabel, leaveYearOf } from '../lib/leave'
import { fmtHolidayDay } from '../lib/holidays'
import { CANCEL_CUTOFF_MS, FULL_DAY_GRACE_MIN } from '../lib/halfDay'
import { fmtClock, minutesOf, shiftHours } from '../lib/shifts'
import { MAX_LEAVE_DOCS, LEAVE_DOC_WINDOW_DAYS } from '../lib/leaveDocs'

/** "13:30" + 60 minutes → "14:30" */
function addMinutes(time: string, minutes: number) {
  const m = minutesOf(time) + minutes
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Employee: the leave policy, built from the live settings plus the admin's additional rules. */
export default function LeavePolicyPage() {
  const { employee } = useAuth()
  const year = leaveYearOf(localDate())
  const { types } = useLeaveTypes()
  const { caps } = useLeaveMonthCaps(`${currentYearMonth()}-01`)
  const { shift, loaded: shiftLoaded } = useMyShift()
  const p = useLeavePolicy(employee?.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const paid = types.filter(t => t.is_paid)
  const lop = types.find(t => !t.is_paid)
  const cancelMinutes = CANCEL_CUTOFF_MS / 60_000

  return (
    <AppLayout medium>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <ScrollText size={24} style={{ color: 'var(--green-dark, #1d5a1f)' }} />
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text-strong, #10261a)' }}>Leave policy</h1>
      </div>
      <p style={{ margin: '0 0 1.25rem', color: 'var(--text-muted, #5b6f61)', fontSize: 14 }}>
        Leave year {leaveYearLabel(year)}
        {p.policy && p.policy.version > 0 && p.policy.published_at && <> · Updated {fmtHolidayDay(p.policy.published_at.slice(0, 10))}</>}
      </p>

      {p.needsAck && (
        <div style={notice}>
          {p.readBefore ? 'This policy has been updated. ' : ''}Please read it and press <b>I’ve read it</b> at the end.
        </div>
      )}

      <Section icon={<Scale size={18} />} title="Leave types">
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Type</th><th style={th}>Per year</th><th style={th}>Credited</th>
              </tr>
            </thead>
            <tbody>
              {paid.map(t => (
                <tr key={t.code}>
                  <td style={{ ...td, fontWeight: 700 }}>{t.name}</td>
                  <td style={td}>{fmtDays(t.yearly_quota)} days</td>
                  <td style={td}>{fmtDays(t.yearly_quota / 12)} day{t.yearly_quota / 12 === 1 ? '' : 's'} on the 1st of each month</td>
                </tr>
              ))}
              {lop && (
                <tr>
                  <td style={{ ...td, fontWeight: 700 }}>{lop.name}</td>
                  <td style={td} colSpan={2}>Unpaid, taken when needed. Deducted from your salary.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {paid.length > 0 && (
        <Section icon={<Repeat size={18} />} title="Carrying leave forward">
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr><th style={th}>Type</th><th style={th}>To the next month</th><th style={th}>To the next leave year (1 April)</th></tr>
              </thead>
              <tbody>
                {paid.map(t => (
                  <tr key={t.code}>
                    <td style={{ ...td, fontWeight: 700 }}>{t.name}</td>
                    <td style={td}>Yes, every month until 31 March</td>
                    <td style={td}>
                      {t.carry_forward_cap > 0
                        ? <>Yes, up to <b>{fmtDays(t.carry_forward_cap)} days</b>. No time limit.</>
                        : <>No. Unused days <b>lapse on 31 March</b>.</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul style={{ ...list, marginTop: 12 }}>
            <li>
              <b>Within the leave year:</b> days you don’t use stay in your balance and roll into the next month, and the month after, until 31 March.
              A day credited on 1 April can still be used the following March, up to 11 months later.
            </li>
            {paid.some(t => t.carry_forward_cap > 0) && (
              <li>
                <b>Into the next leave year:</b> on 1 April, unused{' '}
                {paid.filter(t => t.carry_forward_cap > 0).map(t => `${t.name} (up to ${fmtDays(t.carry_forward_cap)} days)`).join(' and ')}{' '}
                moves to the new year. Carried days keep rolling over every year with no expiry, but the amount carried into a year is never more than the limit; anything above it lapses.
              </li>
            )}
            {paid.some(t => t.carry_forward_cap === 0) && (
              <li>
                <b>Lapses on 31 March:</b> {paid.filter(t => t.carry_forward_cap === 0).map(t => t.name).join(' and ')}. Use these within the leave year.
              </li>
            )}
          </ul>
        </Section>
      )}

      <Section icon={<FileText size={18} />} title="How leave works">
        <ul style={list}>
          <li>The leave year runs from <b>1 April to 31 March</b>. Paid leave is credited monthly, starting from the month you join.</li>
          <li>You can only use leave that has already been credited; next month’s leave can’t be taken in advance.</li>
          <li><b>Sundays and public holidays</b> inside your leave aren’t counted, and neither is your own choice holiday.</li>
          <li>A <b>half day</b> (morning or afternoon) counts as 0.5 day.</li>
          <li>If you don’t have enough of a leave type, you can take what’s left and the rest as <b>Loss of Pay</b>.</li>
          <li>Every request is approved or rejected by an admin. You can’t request leave on days you already have leave.</li>
          <li>Sick leave can carry up to {MAX_LEAVE_DOCS} medical documents (optional), added within {LEAVE_DOC_WINDOW_DAYS} days of requesting.</li>
        </ul>
      </Section>

      {caps.length > 0 && (
        <Section icon={<CalendarDays size={18} />} title="Monthly limits">
          <p style={para}>In months with many public holidays, paid Casual and Earned leave is limited. Days over the limit become Loss of Pay. Sick leave isn’t limited.</p>
          <ul style={list}>
            {caps.map(c => (
              <li key={c.month}><b>{monthLabel(c.month.slice(0, 7))}</b>: up to {fmtDays(c.max_days)} day{c.max_days === 1 ? '' : 's'}{c.note && ` (${c.note})`}</li>
            ))}
          </ul>
        </Section>
      )}

      {shiftLoaded && (
        <>
          <Section icon={<Clock size={18} />} title="Requesting and cancelling">
            <ul style={list}>
              <li>A full day’s leave for <b>today</b> can be requested until {fmtClock(addMinutes(shift.start_time, FULL_DAY_GRACE_MIN))}; after that, a half day.</li>
              <li>Once you’ve checked in, only an afternoon half day can be requested for today, until {fmtClock(shift.split_time)}.</li>
              <li>Leave can be cancelled up to {cancelMinutes} minutes before it starts. Leave for today can be cancelled any time that day, as long as you haven’t checked in.</li>
            </ul>
          </Section>

          <Section icon={<Clock size={18} />} title={`Attendance: ${shift.name} shift, ${shiftHours(shift)}`}>
            <ul style={list}>
              <li>Checking in after <b>{fmtClock(shift.late_after)}</b> is marked Late.</li>
              <li>Checking in after <b>{fmtClock(shift.half_day_after)}</b> counts as a morning half-day leave.</li>
              {shift.min_break_minutes > 0 && <li>On full days, at least {shift.min_break_minutes} minutes of break is taken off your worked hours, even if you took less.</li>}
              <li>Forgot to check in or out? Ask for a correction from your Dashboard within 7 days.</li>
            </ul>
          </Section>
        </>
      )}

      {p.policy?.additional_rules.trim() && (
        <Section icon={<ScrollText size={18} />} title="Additional rules">
          <p style={{ ...para, whiteSpace: 'pre-wrap' }}>{p.policy.additional_rules}</p>
        </Section>
      )}

      <div className="sb-card" style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {p.acknowledgedAt ? (
          <>
            <CheckCircle2 size={22} style={{ color: 'var(--green, #3d7f1f)' }} />
            <span style={{ flex: 1, fontSize: 14 }}>You read this policy on {fmtHolidayDay(p.acknowledgedAt.slice(0, 10))}.</span>
            <Link to="/dashboard" style={{ fontSize: 14, color: 'var(--green-dark, #1d5a1f)', fontWeight: 700 }}>Back to Dashboard</Link>
          </>
        ) : (
          <>
            <span style={{ flex: 1, fontSize: 14 }}>Questions? Ask HR before you press the button.</span>
            <button type="button" disabled={busy || p.loading} onClick={async () => { setBusy(true); setError(await p.acknowledge()); setBusy(false) }}
              className="sb-btn-primary" style={{ minHeight: 44 }}>
              {busy ? 'Saving…' : 'I’ve read it'}
            </button>
          </>
        )}
        {error && <span style={{ flexBasis: '100%', color: 'var(--red, #b42318)', fontSize: 13 }}>{error}</span>}
      </div>
    </AppLayout>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="sb-card" style={{ marginBottom: '1rem' }}>
      <div className="sb-card-head" style={{ marginBottom: 10 }}>{icon}<h2>{title}</h2></div>
      {children}
    </section>
  )
}

const list: CSSProperties = { margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: 6, fontSize: 14, lineHeight: 1.5, color: 'var(--text, #2c4234)' }
const para: CSSProperties = { margin: '0 0 8px', fontSize: 14, lineHeight: 1.5, color: 'var(--text, #2c4234)' }
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14, color: 'var(--text, #2c4234)' }
const th: CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted, #5b6f61)', borderBottom: '1px solid var(--border, #e2ebdf)' }
const td: CSSProperties = { padding: '10px', borderBottom: '1px solid var(--border-soft, #edf3ea)', verticalAlign: 'top' }
const notice: CSSProperties = {
  marginBottom: '1rem', padding: '12px 14px', borderRadius: 12, fontSize: 14,
  background: 'var(--amber-soft, #fbefd3)', color: 'var(--text-strong, #10261a)', border: '1px solid color-mix(in srgb, var(--amber, #c27a0e) 35%, transparent)',
}
