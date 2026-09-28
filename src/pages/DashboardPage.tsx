import { useEffect, useMemo, useState } from 'react'
import {
  BriefcaseBusiness, CalendarDays, ChevronLeft, ChevronRight, CircleArrowRight,
  CircleCheck, Clock, Coffee, Leaf, LogOut, Pause, Play,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useAttendance } from '../hooks/useAttendance'
import { useMonthCalendar } from '../hooks/useMonthCalendar'
import AppLayout from '../components/AppLayout'
import { HeroLeaves, CornerLeaves } from '../components/Leaves'
import { currentYearMonth, isSunday, localDate, monthDates, monthLabel, resolveMark, shiftMonth } from '../lib/calendar'
import type { DayMark } from '../lib/calendar'
import { fmtClock, fmtHM, totalBreakSeconds, workedSeconds } from '../lib/breaks'
import type { AttendanceRecord } from '../types'

type DayState = 'loading' | 'idle' | 'working' | 'break' | 'done'

const MARK_LABELS: Record<DayMark, string> = {
  present: 'Present', late: 'Late', absent: 'Absent', leave: 'On Leave', leave_pending: 'Leave pending',
  holiday: 'Holiday', sunday: 'Weekly off', none: 'Not checked in',
}

const CHIP: Record<DayState, { label: string; cls: string }> = {
  loading: { label: 'Loading…',          cls: '' },
  idle:    { label: 'Not started',       cls: '' },
  working: { label: 'Currently Working', cls: 'is-working' },
  break:   { label: 'On Break',          cls: 'is-break' },
  done:    { label: 'Day complete',      cls: 'is-done' },
}

const SUBTITLE: Record<DayState, string> = {
  loading: 'Let’s make today count.',
  idle:    'Let’s make today count.',
  working: 'Keep going! You’re doing great.',
  break:   'Enjoy your break — you’ve earned it.',
  done:    'Great work today. See you tomorrow!',
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

/** "2025-06-23" → "23 Jun, Mon" */
function fmtRowDate(date: string) {
  const d = new Date(date + 'T00:00:00')
  return `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}, ${d.toLocaleDateString('en-US', { weekday: 'short' })}`
}

/** Re-renders every second while `active`, so live timers tick */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

export default function DashboardPage() {
  const { employee } = useAuth()
  const thisMonth = currentYearMonth()
  const [yearMonth, setYearMonth] = useState(thisMonth)
  const { todayRecord, monthRecords, isSubmitting, error, checkIn, checkOut, pauseBreak, resumeBreak } = useAttendance(yearMonth)
  const calendar = useMonthCalendar(yearMonth, employee?.id)

  const state: DayState =
    todayRecord === undefined ? 'loading'
    : !todayRecord?.check_in_time ? 'idle'
    : todayRecord.check_out_time ? 'done'
    : todayRecord.break_started_at ? 'break'
    : 'working'
  const now = useNow(state === 'working' || state === 'break')

  const firstName = employee?.full_name.split(' ')[0] ?? ''
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <AppLayout wide>
      <section className="sb-hero">
        <div className="sb-hero-inner">
          <p className="sb-hero-date"><CalendarDays size={26} strokeWidth={2} />{todayLabel}</p>
          <h1>Good {greeting()}, <em>{firstName}</em></h1>
          <p className="sb-hero-sub">{SUBTITLE[state]} <Leaf size={26} strokeWidth={2} /></p>
          <p className="sb-quote" aria-hidden="true">
            Better<br />People<br />Build<br />Better<br />Tomorrows
            <svg width="110" height="14" viewBox="0 0 110 14"><path d="M2 11 Q 48 1 108 4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
          </p>
        </div>
        <HeroLeaves className="sb-hero-leaves" />
      </section>

      <div className="sb-container">
        {error && <p className="sb-error">{error}</p>}

        <section className="sb-today">
          <CheckInPanel
            state={state}
            record={todayRecord ?? null}
            isSubmitting={isSubmitting}
            onCheckIn={checkIn}
            onCheckOut={checkOut}
          />
          <TodayTime
            state={state}
            record={todayRecord ?? null}
            now={now}
            isSubmitting={isSubmitting}
            onPause={pauseBreak}
            onResume={resumeBreak}
          />
        </section>

        <MonthLog
          yearMonth={yearMonth}
          onMonthChange={setYearMonth}
          maxMonth={thisMonth}
          records={monthRecords}
          calendar={calendar}
          employeeId={employee?.id}
          now={now}
        />
      </div>
    </AppLayout>
  )
}

// ── Check-in panel (left) ─────────────────────────────────────

function CheckInPanel({ state, record, isSubmitting, onCheckIn, onCheckOut }: {
  state: DayState
  record: AttendanceRecord | null
  isSubmitting: boolean
  onCheckIn: () => void
  onCheckOut: () => void
}) {
  let head: React.ReactNode = 'Ready to get started?'
  let body: React.ReactNode
  let hint: string | null = 'Tap to start your workday'

  if (state === 'done') {
    head = 'Great work today!'
    hint = null
    body = (
      <div className="sb-done">
        <CircleCheck size={44} strokeWidth={2} color="var(--green-dark)" />
        <strong>Done for today</strong>
        <span>{fmtTime(record?.check_in_time)} – {fmtTime(record?.check_out_time)}</span>
      </div>
    )
  } else if (state === 'working' || state === 'break') {
    head = (
      <>
        Checked in at {fmtTime(record?.check_in_time)}
        {record?.status === 'late' && <span className="sb-late-tag">Late</span>}
      </>
    )
    hint = state === 'break' ? 'Checking out will also end your break' : 'Tap to end your workday'
    body = (
      <button className="sb-bigbtn is-out" onClick={onCheckOut} disabled={isSubmitting}>
        <LogOut size={54} strokeWidth={2.2} />
        {isSubmitting ? '…' : 'Check Out'}
      </button>
    )
  } else {
    if (record?.status === 'on_leave') {
      head = 'You’re on leave today'
      hint = 'Check in only if you’re working today'
    }
    body = (
      <button className="sb-bigbtn" onClick={onCheckIn} disabled={isSubmitting || state === 'loading'}>
        <CircleArrowRight size={62} strokeWidth={2.2} />
        {isSubmitting ? '…' : 'Check In'}
      </button>
    )
  }

  return (
    <div className="sb-checkin">
      <CornerLeaves className="sb-checkin-leaves" />
      <p className="sb-panel-head"><Clock size={44} strokeWidth={2} />{head}</p>
      {body}
      {hint && <p className="sb-hint">{hint}</p>}
    </div>
  )
}

// ── Today's Time panel (right) ────────────────────────────────

function TodayTime({ state, record, now, isSubmitting, onPause, onResume }: {
  state: DayState
  record: AttendanceRecord | null
  now: number
  isSubmitting: boolean
  onPause: () => void
  onResume: () => void
}) {
  const chip = CHIP[state]
  const active = state === 'working' || state === 'break'

  let barTitle = 'Pause / Resume'
  let barSub = state === 'done' ? 'Your day is complete' : 'Available after check-in'
  if (state === 'working') { barTitle = 'Pause for a break'; barSub = 'Stops your work timer' }
  if (state === 'break') {
    barTitle = 'Resume work'
    barSub = `On break · ${fmtClock(Math.floor((now - new Date(record!.break_started_at!).getTime()) / 1000))}`
  }

  return (
    <div className="sb-time">
      <div className="sb-time-head">
        <Clock size={36} strokeWidth={2.2} />
        <h2>Today’s Time</h2>
        <span className={`sb-chip ${chip.cls}`}><i />{chip.label}</span>
      </div>

      <div className="sb-stats">
        <div className="sb-stat">
          <span className="sb-stat-icon"><BriefcaseBusiness size={34} strokeWidth={2} /></span>
          <div>
            <div className="sb-stat-label">Work Time</div>
            <div className="sb-stat-value">{fmtHM(workedSeconds(record, now))}</div>
          </div>
        </div>
        <span className="sb-stats-divider" />
        <div className="sb-stat">
          <span className="sb-stat-icon is-break"><Coffee size={34} strokeWidth={2} /></span>
          <div>
            <div className="sb-stat-label">Break Time</div>
            <div className="sb-stat-value">{fmtHM(totalBreakSeconds(record, now))}</div>
          </div>
        </div>
      </div>

      <button
        className={`sb-pausebar ${state === 'break' ? 'is-break' : ''}`}
        onClick={state === 'break' ? onResume : onPause}
        disabled={!active || isSubmitting}
      >
        <span className="sb-pause-dot">
          {state === 'break'
            ? <Play size={24} strokeWidth={2.5} fill="currentColor" />
            : <Pause size={24} strokeWidth={2.5} fill="currentColor" />}
        </span>
        <span className="sb-pause-text">
          {barTitle}
          <small>{barSub}</small>
        </span>
      </button>
    </div>
  )
}

// ── This Month's Log ──────────────────────────────────────────

type LogRow = {
  date: string
  mark: DayMark
  note?: string
  rec?: AttendanceRecord
  worked: number | null   // null → no complete work span to show
  brk: number
}

function MonthLog({ yearMonth, onMonthChange, maxMonth, records, calendar, employeeId, now }: {
  yearMonth: string
  onMonthChange: (ym: string) => void
  maxMonth: string
  records: AttendanceRecord[]
  calendar: ReturnType<typeof useMonthCalendar>
  employeeId: string | undefined
  now: number
}) {
  const today = localDate()
  const isThisMonth = yearMonth === maxMonth

  const { rows, presentDays, workingDays } = useMemo(() => {
    const recMap = new Map(records.map(r => [r.date, r]))
    const leave = employeeId ? calendar.leave.get(employeeId) : undefined
    const rows: LogRow[] = monthDates(yearMonth)
      .filter(d => d <= today)
      .reverse()
      .map(date => {
        const rec = recMap.get(date)
        const holiday = calendar.holidays.has(date)
        // A real check-in wins over leave/holiday: they came in
        const mark: DayMark = rec?.check_in_time
          ? (rec.status === 'late' ? 'late' : 'present')
          : resolveMark(date, today, { holiday, attendance: rec?.status, leave: leave?.get(date) })
        const complete = !!rec?.check_in_time && (!!rec.check_out_time || date === today)
        return {
          date, mark, rec,
          note: calendar.holidays.get(date),
          worked: complete ? workedSeconds(rec, now) : null,
          brk: totalBreakSeconds(rec, now),
        }
      })

    const presentDays = rows.filter(r => r.mark === 'present' || r.mark === 'late').length
    // Days they were expected in: not Sunday / holiday / approved leave, and today only once checked in
    const workingDays = rows.filter(r =>
      !isSunday(r.date) && !calendar.holidays.has(r.date) && r.mark !== 'leave' &&
      (r.date < today || r.mark === 'present' || r.mark === 'late'),
    ).length
    return { rows, presentDays, workingDays }
  }, [records, calendar.holidays, calendar.leave, employeeId, yearMonth, today, now])

  const status = (r: LogRow) => (
    <span className={`sb-status s-${r.mark}`} title={r.note}>
      <i />{r.mark === 'holiday' && r.note ? r.note : MARK_LABELS[r.mark]}
    </span>
  )

  return (
    <section className="sb-log">
      <div className="sb-log-head">
        <CalendarDays size={32} strokeWidth={2} />
        <h2>{isThisMonth ? 'This Month’s Log' : 'Monthly Log'}</h2>
        <div className="sb-monthnav">
          <button onClick={() => onMonthChange(shiftMonth(yearMonth, -1))} aria-label="Previous month">
            <ChevronLeft size={22} strokeWidth={2.4} />
          </button>
          <span>{monthLabel(yearMonth)}</span>
          <button onClick={() => onMonthChange(shiftMonth(yearMonth, 1))} disabled={isThisMonth} aria-label="Next month">
            <ChevronRight size={22} strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {calendar.error ? (
        <p className="sb-empty">{calendar.error}</p>
      ) : calendar.loading ? (
        <p className="sb-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="sb-empty">No days to show for this month yet.</p>
      ) : (
        <>
          <div className="sb-table-wrap">
            <table className="sb-table">
              <thead>
                <tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Break</th><th>Total Work Hours</th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.date} className={r.date === today ? 'is-today' : r.mark === 'sunday' ? 'is-off' : undefined}>
                    <td>{fmtRowDate(r.date)}</td>
                    <td>{status(r)}</td>
                    <td>{fmtTime(r.rec?.check_in_time)}</td>
                    <td>{fmtTime(r.rec?.check_out_time)}</td>
                    <td>{r.brk > 0 ? fmtHM(r.brk) : '—'}</td>
                    <td>{r.worked != null ? fmtHM(r.worked) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="sb-loglist">
            {rows.map(r => (
              <li key={r.date} className={r.date === today ? 'is-today' : undefined}>
                <div className="sb-li-top">
                  <span className="sb-li-date">{fmtRowDate(r.date)}</span>
                  {status(r)}
                </div>
                {r.rec?.check_in_time && (
                  <dl>
                    <div><dt>In</dt><dd>{fmtTime(r.rec.check_in_time)}</dd></div>
                    <div><dt>Out</dt><dd>{fmtTime(r.rec.check_out_time)}</dd></div>
                    <div><dt>Break</dt><dd>{r.brk > 0 ? fmtHM(r.brk) : '—'}</dd></div>
                    <div><dt>Worked</dt><dd>{r.worked != null ? fmtHM(r.worked) : '—'}</dd></div>
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="sb-log-foot">
        <span><CalendarDays size={22} strokeWidth={2} />Present days {isThisMonth ? 'this month' : 'in ' + monthLabel(yearMonth)}: <b>{presentDays} / {workingDays}</b></span>
        <em>Consistency builds success <Leaf size={18} strokeWidth={2} style={{ verticalAlign: '-3px' }} /></em>
      </div>
    </section>
  )
}
