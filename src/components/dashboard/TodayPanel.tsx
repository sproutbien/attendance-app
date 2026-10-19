import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, CalendarHeart, Check, CircleCheckBig, LogIn, Moon, Pause, Play } from 'lucide-react'
import { fmtClock as fmtElapsed, fmtHM, minBreakTopUp, totalBreakSeconds, workedSeconds } from '../../lib/breaks'
import { fmtClock as clock, minutesOf } from '../../lib/shifts'
import { fmtHolidayDay } from '../../lib/holidays'
import { LEAVE_TYPE_LABELS } from '../../lib/leave'
import { localDate } from '../../lib/calendar'
import { fmtDays, onTimeStreak, productivityScore } from '../../lib/stats'
import type { MonthStats } from '../../lib/stats'
import type { AttendanceRecord, HalfDaySession, LeaveRequest, Shift } from '../../types'

export type DayState = 'loading' | 'idle' | 'working' | 'break' | 'done'

/** Minutes since midnight, refreshed every 20 seconds (drives the button colour and the clock). */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** "2026-10-16" → "Fri" */
function dayName(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })
}

/** "2026-10" → "October" */
function monthName(yearMonth: string) {
  return new Date(yearMonth + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long' })
}

/** 26940 → "7.5h" (fits above a narrow bar) */
function fmtShortH(seconds: number) {
  const h = Math.round(seconds / 360) / 10
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

/**
 * Where "now" falls in the shift's check-in rules: 0 before the start, 1 on time,
 * 2 late window, 3 half-day window. Colours the button; no wording changes with it.
 */
function ruleIndex(shift: Shift, minutes: number) {
  if (minutes < minutesOf(shift.start_time)) return 0
  if (minutes <= minutesOf(shift.late_after)) return 1
  if (minutes <= minutesOf(shift.half_day_after)) return 2
  return 3
}
const TONE = ['', '', 'is-late', 'is-half'] as const

// ── The Check In bar ──────────────────────────────────────────

export function CheckInBar({
  state, record, now, shift, isSubmitting, halfDay, pastSplit, leave, startsOn,
  onCheckIn, onCheckOut, onPause, onResume, onCancelLeave,
}: {
  state: DayState
  record: AttendanceRecord | null
  now: number
  shift: Shift
  isSubmitting: boolean
  halfDay: HalfDaySession | null
  pastSplit: boolean
  leave: LeaveRequest | null          // pending / approved full-day leave today
  startsOn: string | null             // joining date still ahead
  onCheckIn: () => void
  onCheckOut: () => void
  onPause: () => void
  onResume: () => void
  onCancelLeave: () => void
}) {
  const wall = useMinuteClock()
  const time = wall.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  if (state === 'loading') {
    return (
      <div className="sb-cibar is-muted" aria-busy="true">
        <span className="sb-cibar-icon"><CalendarClock size={34} strokeWidth={2} /></span>
        <span className="sb-cibar-main"><strong>Loading…</strong></span>
      </div>
    )
  }

  if (state === 'working' || state === 'break') {
    const onBreak = state === 'break'
    const sub = halfDay === 'afternoon'
      ? `Half-day leave this afternoon · you’ll be checked out at ${clock(shift.split_time)}`
      : onBreak
        ? `On a break · ${fmtElapsed(Math.floor((now - new Date(record!.break_started_at!).getTime()) / 1000))}`
        : `Shift ends at ${clock(shift.end_time)}`
    return (
      <div className="sb-cibar is-dark">
        <span className="sb-cibar-icon is-check"><Check size={36} strokeWidth={3} /></span>
        <span className="sb-cibar-main">
          <strong>Checked in at {fmtTime(record?.check_in_time)}</strong>
          <span>{sub}</span>
        </span>
        <span className="sb-cibar-side is-split">
          <b>{fmtHM(workedSeconds(record, now, shift))}</b>
          <small>worked so far</small>
        </span>
        <span className="sb-cibar-actions">
          <button type="button" className={`sb-cibar-pill ${onBreak ? 'is-resume' : 'is-break'}`} onClick={onBreak ? onResume : onPause} disabled={isSubmitting}>
            {onBreak ? <Play size={16} strokeWidth={2.5} fill="currentColor" /> : <Pause size={16} strokeWidth={2.5} fill="currentColor" />}
            {onBreak ? 'Resume work' : 'Take a break'}
          </button>
          <button type="button" className="sb-cibar-pill is-out" onClick={onCheckOut} disabled={isSubmitting}>Check Out</button>
        </span>
      </div>
    )
  }

  if (state === 'done') {
    const topUp = minBreakTopUp(record, shift)
    return (
      <div className="sb-cibar is-dark">
        <span className="sb-cibar-icon is-check"><CircleCheckBig size={34} strokeWidth={2.4} /></span>
        <span className="sb-cibar-main">
          <strong>Done for today</strong>
          <span>{fmtTime(record?.check_in_time)} – {fmtTime(record?.check_out_time)}</span>
        </span>
        <span className="sb-cibar-side is-split">
          <b>{fmtHM(workedSeconds(record, now, shift))}</b>
          <small>worked</small>
        </span>
        <span className="sb-cibar-side" title={topUp > 0 ? `Includes ${Math.round(topUp / 60)} min added to reach the ${shift.min_break_minutes}-minute minimum break` : undefined}>
          <b>{fmtHM(totalBreakSeconds(record, now) + topUp)}</b>
          <small>break{topUp > 0 ? ' · min applied' : ''}</small>
        </span>
      </div>
    )
  }

  // Not checked in yet
  if (startsOn || (halfDay === 'morning' && !pastSplit) || (halfDay === 'afternoon' && pastSplit)) {
    const [head, sub] = startsOn
      ? ['See you soon', `Check In opens on your first day, ${fmtHolidayDay(startsOn)}`]
      : halfDay === 'morning'
        ? ['Half-day leave this morning', `Check In opens at ${clock(shift.split_time)}, when your leave ends`]
        : ['You’re on leave this afternoon', 'Enjoy your afternoon off']
    return (
      <div className="sb-cibar is-muted">
        <span className="sb-cibar-icon"><CalendarClock size={34} strokeWidth={2} /></span>
        <span className="sb-cibar-main"><strong>{head}</strong><span>{sub}</span></span>
        <span className="sb-cibar-side"><b>{time}</b><small>{shift.name} shift</small></span>
      </div>
    )
  }

  if (leave || record?.status === 'on_leave') {
    return (
      <div className="sb-cibar is-leave">
        <span className="sb-cibar-icon"><Moon size={34} strokeWidth={2.2} /></span>
        <span className="sb-cibar-main">
          <strong>You’re on leave today</strong>
          <span>{leave ? `${leave.status === 'approved' ? 'Approved' : 'Pending'} ${LEAVE_TYPE_LABELS[leave.leave_type].toLowerCase()} leave · no check-in needed` : 'No check-in needed'}</span>
        </span>
        {leave && <button type="button" className="sb-cibar-pill is-light" onClick={onCancelLeave}>Cancel leave &amp; work</button>}
      </div>
    )
  }

  const tone = halfDay ? '' : TONE[ruleIndex(shift, wall.getHours() * 60 + wall.getMinutes())]
  const sub = halfDay === 'morning' ? 'Welcome back · tap to start your afternoon'
    : halfDay === 'afternoon' ? `Half-day leave this afternoon · you’ll be checked out at ${clock(shift.split_time)}`
    : 'Tap to start your day'
  return (
    <button type="button" className={`sb-cibar sb-cibar-go ${tone}`} onClick={onCheckIn} disabled={isSubmitting}>
      <span className="sb-cibar-icon"><LogIn size={36} strokeWidth={2.3} /></span>
      <span className="sb-cibar-main">
        <strong>{isSubmitting ? 'Checking in…' : 'Check In'}</strong>
        <span>{sub}</span>
      </span>
      <span className="sb-cibar-side is-split">
        <b>{time}</b>
        <small>{shift.name} shift · {clock(shift.start_time)} – {clock(shift.end_time)}</small>
      </span>
    </button>
  )
}

// ── The four cards under it ───────────────────────────────────

export function ShiftCard({ shift, highlight }: { shift: Shift; highlight: boolean }) {
  const wall = useMinuteClock()
  const at = highlight ? ruleIndex(shift, wall.getHours() * 60 + wall.getMinutes()) : -1
  const rows: [string, string][] = [
    ['Shift starts', clock(shift.start_time)],
    ['On time until', clock(shift.late_after)],
    ['Late until', clock(shift.half_day_after)],
    ['Half day after', clock(shift.half_day_after)],
  ]
  return (
    <section className="sb-card sb-dcard">
      <h2 className="sb-dcard-title">Today’s shift</h2>
      <ul className="sb-rules">
        {rows.map(([label, value], i) => (
          <li key={label} className={i === at ? `is-now ${TONE[i as 0 | 1 | 2 | 3]}` : undefined}><span>{label}</span><b>{value}</b></li>
        ))}
        {shift.min_break_minutes > 0 && <li><span>Minimum break</span><b>{shift.min_break_minutes} min</b></li>}
      </ul>
    </section>
  )
}

type Bar = { date: string; label: string; value: string; height: number; tone: string }

export function RecentDaysCard({ trend, today: todayRec, now, shift, onLeave, loading }: {
  trend: MonthStats[] | null
  today: AttendanceRecord | null
  now: number
  shift: Shift
  onLeave: boolean
  loading: boolean
}) {
  const today = localDate()
  const shiftLen = Math.max(1, (minutesOf(shift.end_time) - minutesOf(shift.start_time)) * 60)
  const past = (trend ?? []).flatMap(m => m.days).filter(d => d.date < today && d.kind).slice(-5)
  const bars: Bar[] = past.map(d => {
    const tone = d.kind === 'leave' ? 'is-leave' : d.kind === 'absent' ? 'is-absent' : d.half ? 'is-half' : d.kind === 'late' ? 'is-late' : ''
    const value = d.kind === 'leave' ? 'Leave' : d.kind === 'absent' ? 'Absent' : d.worked ? fmtShortH(d.worked) : '—'
    const height = d.kind === 'leave' ? 22 : d.kind === 'absent' ? 6 : Math.max(6, Math.min(100, (d.worked / shiftLen) * 100))
    return { date: d.date, label: dayName(d.date), value, height, tone }
  })
  const worked = todayRec?.check_in_time ? workedSeconds(todayRec, now, shift) : 0
  bars.push({
    date: today,
    label: 'Today',
    value: todayRec?.check_in_time ? fmtShortH(worked) : onLeave ? 'Leave' : '—',
    height: todayRec?.check_in_time ? Math.max(6, Math.min(100, (worked / shiftLen) * 100)) : onLeave ? 22 : 8,
    tone: todayRec?.check_in_time
      ? (todayRec.half_day_session ? 'is-half' : todayRec.status === 'late' ? 'is-late' : '')
      : onLeave ? 'is-leave' : 'is-empty',
  })

  return (
    <section className="sb-card sb-dcard">
      <h2 className="sb-dcard-title">Last {loading ? 6 : bars.length} days</h2>
      {loading ? <p className="sb-dcard-empty">Loading…</p> : (
        <div className="sb-bars" role="img" aria-label={bars.map(b => `${b.label}: ${b.value}`).join(', ')}>
          {bars.map(b => (
            <div key={b.date} className="sb-bar">
              <small>{b.value}</small>
              <span className={b.tone} style={{ height: `${Math.round(b.height * 0.84)}px` }} />
              <em>{b.label}</em>
            </div>
          ))}
        </div>
      )}
      <p className="sb-legend">
        <span><i />Present</span><span><i className="is-late" />Late</span><span><i className="is-half" />Half day</span><span><i className="is-leave" />Leave</span>
      </p>
    </section>
  )
}

export function MonthCard({ month, loading }: { month: MonthStats | null; loading: boolean }) {
  const today = localDate()
  const due = month ? month.workingDays - month.leave : 0
  const rate = month?.attendanceRate ?? null
  const R = 32, C = 2 * Math.PI * R
  return (
    <section className="sb-card sb-dcard">
      <div className="sb-dcard-head">
        <h2 className="sb-dcard-title">{month ? `${monthName(month.yearMonth)} so far` : 'This month'}</h2>
        <Link to={`/reports?month=${month?.yearMonth ?? ''}`}>Stats</Link>
      </div>
      <div className="sb-month-ring">
        <span className="sb-ring">
          <svg width="78" height="78" viewBox="0 0 78 78" aria-hidden="true">
            <circle cx="39" cy="39" r={R} className="sb-ring-track" />
            <circle cx="39" cy="39" r={R} className="sb-ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - (rate ?? 0))} />
          </svg>
          <b>{loading || rate == null ? '—' : `${Math.round(rate * 100)}%`}</b>
        </span>
        <p>
          <b>{loading || !month ? '—' : `${fmtDays(month.present)} of ${fmtDays(due)}`}</b> days present
          <br /><span>{!month || loading ? '' : month.leave ? `${fmtDays(month.leave)} ${month.leave === 1 ? 'day' : 'days'} on leave` : 'No leave taken'}</span>
        </p>
      </div>
      <div className="sb-minis">
        <div className="is-amber"><small>Late days</small><b>{loading || !month ? '—' : fmtDays(month.late)}</b></div>
        <div><small>On-time streak</small><b>{loading || !month ? '—' : `${onTimeStreak(month.days, today)} days`}</b></div>
      </div>
    </section>
  )
}

const PART_TONE = { attendance: '', punctuality: 'is-blue', hours: 'is-purple' } as const

export function ScoreCard({ month, previous, loading }: { month: MonthStats | null; previous: MonthStats | null; loading: boolean }) {
  const today = localDate()
  const p = month ? productivityScore(month, today) : null
  const before = previous ? productivityScore(previous, today) : null
  const delta = p && before ? p.score - before.score : null
  const best = p ? [...p.parts].sort((a, b) => b.rate - a.rate)[0] : null
  const R = 40, C = 2 * Math.PI * R
  return (
    <section className="sb-card sb-dcard" title="The average of your attendance, punctuality and hours worked against your shift this month">
      <div className="sb-dcard-head">
        <h2 className="sb-dcard-title">Productivity score</h2>
        {delta != null && previous && (
          <span className={`sb-delta ${delta < 0 ? 'is-down' : ''}`}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {Math.abs(delta)} vs {monthName(previous.yearMonth)}
          </span>
        )}
      </div>
      {loading ? <p className="sb-dcard-empty">Loading…</p> : !p ? (
        <p className="sb-dcard-empty"><CalendarHeart size={18} /> Your score appears after your first day.</p>
      ) : (
        <>
          <div className="sb-score">
            <span className="sb-ring is-big">
              <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
                <circle cx="46" cy="46" r={R} className="sb-ring-track" />
                <circle cx="46" cy="46" r={R} className="sb-ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - p.score / 100)} />
              </svg>
              <b>{p.score}<small>out of 100</small></b>
            </span>
            <p>
              <b>{p.score >= 85 ? 'Great month.' : p.score >= 70 ? 'Good going.' : 'Every day counts.'}</b>
              <br />{best && `Your ${best.label.toLowerCase()} is your strongest area.`}
            </p>
          </div>
          <ul className="sb-parts">
            {p.parts.map(part => (
              <li key={part.key}>
                <span><span>{part.label}</span><b>{Math.round(part.rate * 100)}%</b></span>
                <i className={PART_TONE[part.key]}><i style={{ width: `${Math.round(part.rate * 100)}%` }} /></i>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
