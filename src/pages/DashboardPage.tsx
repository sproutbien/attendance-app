import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BriefcaseBusiness, CalendarCheck, CalendarClock, CalendarDays, ChartColumn, ChevronLeft, ChevronRight,
  CircleArrowRight, Clock, Coffee, DoorOpen, LogOut, Pause, Play, Timer,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useAttendance } from '../hooks/useAttendance'
import { useCorrections } from '../hooks/useCorrections'
import CorrectionDialog from '../components/CorrectionDialog'
import MyCorrections from '../components/MyCorrections'
import { isCorrectable } from '../lib/corrections'
import { useMonthCalendar } from '../hooks/useMonthCalendar'
import ChoiceHolidayCard from '../components/ChoiceHolidayCard'
import GettingStartedCard from '../components/GettingStartedCard'
import TodayRequestNote from '../components/TodayRequestNote'
import PolicyUpdateNotice from '../components/PolicyUpdateNotice'
import SelfieCheckIn from '../components/SelfieCheckIn'
import { selfieRequired } from '../lib/selfies'
import { geofenceArea, readLocation } from '../lib/geofence'
import type { LocationFields } from '../lib/geofence'
import { notStartedYet } from '../lib/onboarding'
import { fmtHolidayDay } from '../lib/holidays'
import AppLayout from '../components/AppLayout'
import { TRACKING_START, currentYearMonth, isSunday, localDate, monthDates, monthLabel, resolveMark, shiftMonth } from '../lib/calendar'
import type { DayMark } from '../lib/calendar'
import { fmtClock, fmtHM, minBreakTopUp, totalBreakSeconds, workedSeconds } from '../lib/breaks'
import { halfDaySplit } from '../lib/halfDay'
import { fmtClock as clock, minutesOf, shiftHours } from '../lib/shifts'
import { useMyShift, useShiftHistory } from '../hooks/useShifts'
import { supabase } from '../lib/supabase'
import { LEAVE_TYPE_LABELS, fmtLeaveSpan } from '../lib/leave'
import type { LeaveRequest } from '../types'
import type { AttendanceRecord, HalfDaySession, Shift } from '../types'

type DayState = 'loading' | 'idle' | 'working' | 'break' | 'done'

const MARK_LABELS: Record<DayMark, string> = {
  present: 'Present', late: 'Late', absent: 'Absent', leave: 'On Leave', half_leave: 'Half-day leave', leave_pending: 'Leave pending',
  holiday: 'Holiday', choice_holiday: 'Choice holiday', sunday: 'Weekly off', none: 'Not checked in',
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

/** True once `time` has passed; re-renders at that moment. */
function usePassed(time: number | null) {
  const [, rerender] = useState(0)
  const passed = time != null && Date.now() >= time
  useEffect(() => {
    if (time == null || passed) return
    const id = setTimeout(() => rerender(n => n + 1), time - Date.now() + 50)
    return () => clearTimeout(id)
  }, [time, passed])
  return passed
}

export default function DashboardPage() {
  const { employee } = useAuth()
  const thisMonth = currentYearMonth()
  const [yearMonth, setYearMonth] = useState(thisMonth)
  const { todayRecord, monthRecords, isSubmitting, error, checkIn, checkOut, pauseBreak, resumeBreak } = useAttendance(yearMonth)
  const calendar = useMonthCalendar(yearMonth, employee?.id)
  const corrections = useCorrections()
  const [correcting, setCorrecting] = useState<{ date: string; rec?: AttendanceRecord } | null>(null)
  const [confirmingOut, setConfirmingOut] = useState(false)
  const { shift, loaded: shiftLoaded } = useMyShift()
  const todaysLeave = useTodaysLeave(employee?.id)
  const [leavePopup, setLeavePopup] = useState(false)
  const [selfieOpen, setSelfieOpen] = useState(false)
  const [preparing, setPreparing] = useState<'' | 'checking' | 'locating'>('')
  // Location reading waiting to go with the check-in (and whether a selfie comes next)
  const [pending, setPending] = useState<{ location: LocationFields | null; selfie: boolean } | null>(null)
  const [locationProblem, setLocationProblem] = useState<{ note: string; strict: boolean } | null>(null)
  const navigate = useNavigate()

  // Asks the server each time, so switching the selfie or location check on applies straight away
  async function startCheckIn() {
    if (todaysLeave) { setLeavePopup(true); return }
    if (!employee) return
    setLocationProblem(null)
    setPreparing('checking')
    const [needSelfie, area] = await Promise.all([selfieRequired(employee.id), geofenceArea(employee.id)])
    let location: LocationFields | null = null
    if (area) {
      setPreparing('locating')
      location = await readLocation()
    }
    setPreparing('')
    setPending({ location, selfie: needSelfie })
    if (location && 'geofence_note' in location) {
      setLocationProblem({ note: location.geofence_note, strict: area!.is_strict })
      return
    }
    finishCheckIn(location, needSelfie)
  }

  async function finishCheckIn(location: LocationFields | null, needSelfie: boolean) {
    setLocationProblem(null)
    if (needSelfie) { setSelfieOpen(true); return }
    const { error } = await checkIn(location ?? undefined)
    if (error === 'A selfie is needed to check in.') setSelfieOpen(true)
  }

  const state: DayState =
    todayRecord === undefined ? 'loading'
    : !todayRecord?.check_in_time ? 'idle'
    : todayRecord.check_out_time ? 'done'
    : todayRecord.break_started_at ? 'break'
    : 'working'
  const now = useNow(state === 'working' || state === 'break')

  // Approved half-day leave today: morning → check-in opens at the shift's split,
  // afternoon → auto check-out at the split (the server job does this too if the app is closed)
  const halfDay = todayRecord?.half_day_session ?? null
  const split = halfDay && shiftLoaded ? halfDaySplit(shift, localDate()).getTime() : null
  const pastSplit = usePassed(split)
  const clockedIn = state === 'working' || state === 'break'
  useEffect(() => {
    if (halfDay === 'afternoon' && clockedIn && pastSplit && !isSubmitting) checkOut(new Date(split!))
  }, [halfDay, clockedIn, pastSplit])  // eslint-disable-line react-hooks/exhaustive-deps

  const shiftOn = useShiftHistory(employee?.id)
  const log = useMonthLog(yearMonth, monthRecords, calendar, employee?.id, now, shiftOn, employee?.joining_date ?? null)
  // Before the joining date: can log in (onboarding), can't check in
  const startsOn = notStartedYet(employee) ? employee!.joining_date! : null

  const firstName = employee?.full_name.split(' ')[0] ?? ''
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <AppLayout wide>
      <section className="sb-hero">
        <p className="sb-hero-date">
          <CalendarDays size={16} strokeWidth={2} />{todayLabel}
          {shiftLoaded && <> · {shift.name} shift {shiftHours(shift)}</>}
        </p>
        <h1>Good {greeting()}, <em>{firstName}</em></h1>
        <p className="sb-hero-sub">{startsOn ? `You start on ${fmtHolidayDay(startsOn)}. We’re glad to have you.` : SUBTITLE[state]}</p>
      </section>

      <div className="sb-container">
        {error && <p className="sb-error">{error}</p>}

        <PolicyUpdateNotice />
        <GettingStartedCard />
        <TodayRequestNote />

        <section className="sb-today">
          <CheckInPanel
            state={state}
            record={todayRecord ?? null}
            isSubmitting={isSubmitting || preparing !== ''}
            halfDay={halfDay}
            pastSplit={pastSplit}
            shift={shift}
            onLeave={!!todaysLeave}
            startsOn={startsOn}
            onCheckIn={startCheckIn}
            onCheckOut={() => setConfirmingOut(true)}
          />
          <TodayTime
            state={state}
            record={todayRecord ?? null}
            now={now}
            shift={shiftLoaded ? shift : null}
            isSubmitting={isSubmitting}
            onPause={pauseBreak}
            onResume={resumeBreak}
          />
          <MonthSummary
            title={yearMonth === thisMonth ? 'This Month' : monthLabel(yearMonth)}
            yearMonth={yearMonth}
            loading={calendar.loading}
            log={log}
          />
        </section>

        <ChoiceHolidayCard />

        <MonthLog
          yearMonth={yearMonth}
          onMonthChange={setYearMonth}
          maxMonth={thisMonth}
          rows={log.rows}
          calendar={calendar}
          pendingCorrections={corrections.pendingDates}
          onCorrect={(date, rec) => setCorrecting({ date, rec })}
        />

        <MyCorrections corrections={corrections.corrections} onWithdraw={corrections.withdraw} />
      </div>

      {correcting && (
        <CorrectionDialog
          date={correcting.date}
          record={correcting.rec}
          onSubmit={corrections.submit}
          onClose={() => setCorrecting(null)}
        />
      )}

      {selfieOpen && employee && (
        <SelfieCheckIn
          employeeId={employee.id}
          onCheckIn={selfie => checkIn({ ...(pending?.location ?? {}), ...selfie })}
          onClose={() => setSelfieOpen(false)}
        />
      )}

      {preparing === 'locating' && (
        <div className="sb-modal-backdrop">
          <div className="sb-modal" role="dialog" aria-modal="true" aria-labelledby="locating-title">
            <div className="sb-modal-head"><h2 id="locating-title">Checking your location…</h2></div>
            <p className="sb-modal-sub" style={{ marginBottom: 0 }}>
              If your browser asks, allow it to use your location. It’s only read when you check in.
            </p>
          </div>
        </div>
      )}

      {locationProblem && pending && (
        <div className="sb-modal-backdrop" onClick={() => setLocationProblem(null)}>
          <div className="sb-modal" role="dialog" aria-modal="true" aria-labelledby="noloc-title" onClick={e => e.stopPropagation()}>
            <div className="sb-modal-head"><h2 id="noloc-title">We couldn’t get your location</h2></div>
            <p className="sb-modal-sub">
              <b>{locationProblem.note}.</b>{' '}
              {locationProblem.strict
                ? 'Your company needs your location to check in. Allow location access for this site in your browser or phone settings, then try again.'
                : 'You can still check in. Your admin will see that today’s check-in has no location.'}
            </p>
            <div className="sb-modal-actions">
              {locationProblem.strict
                ? <button type="button" className="sb-btn-ghost" onClick={() => setLocationProblem(null)}>Cancel</button>
                : <button type="button" className="sb-btn-ghost" onClick={() => finishCheckIn(pending.location, pending.selfie)}>Check in anyway</button>}
              <button type="button" className="sb-btn-primary" onClick={startCheckIn}>Try again</button>
            </div>
          </div>
        </div>
      )}

      {leavePopup && todaysLeave && (
        <div className="sb-modal-backdrop" onClick={() => setLeavePopup(false)}>
          <div className="sb-modal" role="dialog" aria-modal="true" aria-labelledby="onleave-title" onClick={e => e.stopPropagation()}>
            <div className="sb-modal-head">
              <h2 id="onleave-title">You’re on leave today</h2>
            </div>
            <p className="sb-modal-sub">
              You have {todaysLeave.status === 'approved' ? 'approved' : 'a pending request for'} {LEAVE_TYPE_LABELS[todaysLeave.leave_type]} leave
              {' '}on <b>{fmtLeaveSpan(todaysLeave.start_date, todaysLeave.end_date)}</b>.
              To check in, cancel today’s leave first.
            </p>
            <div className="sb-modal-actions">
              <button type="button" className="sb-btn-ghost" onClick={() => setLeavePopup(false)}>Don’t Check-in</button>
              <button type="button" className="sb-btn-primary" onClick={() => navigate(`/leave?cancel=${todaysLeave.id}`)}>
                Cancel Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingOut && clockedIn && (
        <div className="sb-modal-backdrop" onClick={() => setConfirmingOut(false)}>
          <div className="sb-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title" onClick={e => e.stopPropagation()}>
            <div className="sb-modal-head">
              <h2 id="checkout-title">Check out now?</h2>
            </div>
            <p className="sb-modal-sub">
              {state === 'break' ? 'This will also end your break. ' : ''}You won’t be able to check in again today.
            </p>
            <div className="sb-modal-actions">
              <button type="button" className="sb-btn-ghost" onClick={() => setConfirmingOut(false)}>Cancel</button>
              <button
                type="button"
                className="sb-btn-primary"
                disabled={isSubmitting}
                onClick={async () => { await checkOut(); setConfirmingOut(false) }}
              >
                {isSubmitting ? 'Checking out…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

/** Pending or approved full-day leave covering today (null when none). */
function useTodaysLeave(employeeId: string | undefined) {
  const [leave, setLeave] = useState<LeaveRequest | null>(null)
  useEffect(() => {
    if (!employeeId) return
    const today = localDate()
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('duration', 'full')
      .in('status', ['pending', 'approved'])
      .lte('start_date', today)
      .gte('end_date', today)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLeave(data ?? null))
  }, [employeeId])
  return leave
}

// ── Check-in panel (left) ─────────────────────────────────────

function CheckInPanel({ state, record, isSubmitting, halfDay, pastSplit, shift, onLeave, startsOn, onCheckIn, onCheckOut }: {
  state: DayState
  record: AttendanceRecord | null
  isSubmitting: boolean
  halfDay: HalfDaySession | null
  pastSplit: boolean
  shift: Shift
  onLeave: boolean        // pending / approved full-day leave today: Check In opens the cancel-leave popup
  startsOn: string | null // joining date still ahead: Check In is closed until then
  onCheckIn: () => void
  onCheckOut: () => void
}) {
  let Icon = CalendarClock
  let head: React.ReactNode = 'Ready to get started?'
  let sub: string | null = null
  let action: React.ReactNode = null
  let hint: string | null = 'Tap to start your workday'

  if (state === 'done') {
    Icon = CalendarCheck
    head = 'Done for today'
    sub = `${fmtTime(record?.check_in_time)} – ${fmtTime(record?.check_out_time)}`
    hint = null
  } else if (state === 'working' || state === 'break') {
    Icon = Timer
    head = state === 'break' ? 'On a break' : 'Currently working'
    sub = `Checked in at ${fmtTime(record?.check_in_time)}`
    hint = state === 'break' ? 'Checking out will also end your break' : 'Tap to end your workday'
    if (halfDay === 'afternoon') hint = `Half-day leave this afternoon — you’ll be checked out automatically at ${clock(shift.split_time)}`
    action = (
      <button className="sb-bigbtn is-out" onClick={onCheckOut} disabled={isSubmitting}>
        <LogOut size={18} strokeWidth={2.2} />
        {isSubmitting ? '…' : 'Check Out'}
      </button>
    )
  } else {
    // Morning leave: locked until the split. Afternoon leave: locked once the split has passed.
    const locked = !!startsOn || (halfDay === 'morning' && !pastSplit) || (halfDay === 'afternoon' && pastSplit)
    if (startsOn) {
      head = 'See you soon'
      hint = `Check In opens on your first day, ${fmtHolidayDay(startsOn)}`
    } else if (halfDay === 'morning') {
      head = pastSplit ? 'Welcome back from your half day' : 'Half-day leave this morning'
      hint = pastSplit ? 'Tap to start your afternoon' : `Check In opens at ${clock(shift.split_time)}, when your leave ends`
    } else if (halfDay === 'afternoon') {
      head = pastSplit ? 'You’re on leave this afternoon' : 'Half-day leave this afternoon'
      hint = pastSplit ? 'Enjoy your afternoon off' : `You’ll be checked out automatically at ${clock(shift.split_time)}`
    } else if (onLeave || record?.status === 'on_leave') {
      head = 'You’re on leave today'
      hint = 'Working today after all? Cancel today’s leave first'
    } else {
      const d = new Date()
      const minutes = d.getHours() * 60 + d.getMinutes()
      if (minutes > minutesOf(shift.half_day_after)) hint = `Checking in after ${clock(shift.half_day_after)} counts as a morning half-day leave`
      else if (minutes > minutesOf(shift.late_after)) hint = `Checking in after ${clock(shift.late_after)} is marked Late`
    }
    action = (
      <button className="sb-bigbtn" onClick={onCheckIn} disabled={isSubmitting || state === 'loading' || locked}>
        <CircleArrowRight size={18} strokeWidth={2.2} />
        {isSubmitting ? '…' : 'Check In'}
      </button>
    )
  }

  const mark = todayMark(record)

  return (
    <div className="sb-card sb-att">
      <div className="sb-checkin">
        <div className="sb-card-head">
          <Clock size={20} strokeWidth={2} />
          <h2>Today’s Attendance</h2>
          {mark && <span className={`sb-status s-${mark}`}><i />{MARK_LABELS[mark]}</span>}
        </div>
        <div className="sb-att-body">
          <span className="sb-att-ring"><Icon size={32} strokeWidth={1.8} /></span>
          <div className="sb-att-main">
            <strong>{head}</strong>
            {sub && <span>{sub}</span>}
          </div>
        </div>
        {action}
        {hint && <p className="sb-hint">{hint}</p>}
      </div>
    </div>
  )
}

/** Today's status pill: what the day counts as so far (none until something happens) */
function todayMark(record: AttendanceRecord | null): DayMark | null {
  if (record?.half_day_session) return 'half_leave'
  if (record?.check_in_time) return record.status === 'late' ? 'late' : 'present'
  if (record?.status === 'on_leave') return 'leave'
  return null
}

// ── Today's Time panel (right) ────────────────────────────────

function TodayTime({ state, record, now, shift, isSubmitting, onPause, onResume }: {
  state: DayState
  record: AttendanceRecord | null
  now: number
  shift: Shift | null
  isSubmitting: boolean
  onPause: () => void
  onResume: () => void
}) {
  const chip = CHIP[state]
  const active = state === 'working' || state === 'break'
  const topUp = minBreakTopUp(record, shift)
  const minBreak = shift && !record?.half_day_session ? shift.min_break_minutes : 0

  let barTitle = 'Pause / Resume'
  let barSub = state === 'done' ? 'Your day is complete' : 'Available after check-in'
  if (state === 'working') { barTitle = 'Pause for a break'; barSub = 'Stops your work timer' }
  if (state === 'break') {
    barTitle = 'Resume work'
    barSub = `On break · ${fmtClock(Math.floor((now - new Date(record!.break_started_at!).getTime()) / 1000))}`
  }

  return (
    <div className="sb-card sb-time">
      <div className="sb-card-head">
        <Clock size={20} strokeWidth={2} />
        <h2>Today’s Time</h2>
        <span className={`sb-chip ${chip.cls}`}><i />{chip.label}</span>
      </div>

      <div className="sb-stats">
        <div className="sb-stat">
          <span className="sb-stat-icon"><BriefcaseBusiness size={22} strokeWidth={2} /></span>
          <div>
            <div className="sb-stat-label">Work Time</div>
            <div className="sb-stat-value">{fmtHM(workedSeconds(record, now, shift))}</div>
          </div>
        </div>
        <span className="sb-stats-divider" />
        <div className="sb-stat">
          <span className="sb-stat-icon is-break"><Coffee size={22} strokeWidth={2} /></span>
          <div>
            <div className="sb-stat-label">Break Time</div>
            <div className="sb-stat-value">{fmtHM(totalBreakSeconds(record, now) + topUp)}</div>
          </div>
        </div>
      </div>
      {topUp > 0 ? (
        <p className="sb-minbreak-note">Includes {fmtMins(topUp)} added to reach your shift’s {minBreak}-minute minimum break.</p>
      ) : minBreak > 0 && active && (
        <p className="sb-minbreak-note">A {minBreak}-minute minimum break is deducted on full days, so pause whenever you step away.</p>
      )}

      <button
        className={`sb-pausebar ${state === 'break' ? 'is-break' : ''}`}
        onClick={state === 'break' ? onResume : onPause}
        disabled={!active || isSubmitting}
      >
        <span className="sb-pause-dot">
          {state === 'break'
            ? <Play size={16} strokeWidth={2.5} fill="currentColor" />
            : <Pause size={16} strokeWidth={2.5} fill="currentColor" />}
        </span>
        <span className="sb-pause-text">
          {barTitle}
          <small>{barSub}</small>
        </span>
      </button>
    </div>
  )
}

// ── This Month card (right) ───────────────────────────────────

function MonthSummary({ title, yearMonth, loading, log }: {
  title: string
  yearMonth: string
  loading: boolean
  log: ReturnType<typeof useMonthLog>
}) {
  const { workedTotal, presentDays, workingDays, leaveDays } = log
  const items = [
    { Icon: Clock,          tone: '',         label: 'Total Work Hours', value: fmtHM(workedTotal) },
    { Icon: ChartColumn,    tone: 'is-blue',  label: 'Avg. Per Day',     value: fmtHM(presentDays ? workedTotal / presentDays : 0) },
    { Icon: CalendarDays,   tone: '',         label: 'Days Present',     value: `${presentDays} / ${workingDays}` },
    { Icon: DoorOpen,       tone: 'is-amber', label: 'Leaves',           value: `${leaveDays} ${leaveDays === 1 ? 'day' : 'days'}` },
  ]

  return (
    <div className="sb-card sb-month">
      <Link to={`/reports?month=${yearMonth}`} className="sb-card-head sb-month-head" aria-label={`${title}: see detailed statistics`}>
        <ChartColumn size={20} strokeWidth={2} />
        <h2>{title}</h2>
        <ChevronRight size={18} strokeWidth={2.2} className="sb-month-go" />
      </Link>
      <ul className="sb-month-list">
        {items.map(({ Icon, tone, label, value }) => (
          <li key={label}>
            <span className={`sb-month-icon ${tone}`}><Icon size={15} strokeWidth={2.2} /></span>
            <span className="sb-month-label">{label}</span>
            <b>{loading ? '—' : value}</b>
          </li>
        ))}
      </ul>
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
  topUp: number           // added to reach the shift's minimum break
}

/** The month's rows (newest first, up to today) plus the totals the This Month card shows */
function useMonthLog(
  yearMonth: string,
  records: AttendanceRecord[],
  calendar: ReturnType<typeof useMonthCalendar>,
  employeeId: string | undefined,
  now: number,
  shiftOn: (date: string) => Shift | null,
  joiningDate: string | null,
) {
  const today = localDate()

  return useMemo(() => {
    const recMap = new Map(records.map(r => [r.date, r]))
    const leave = employeeId ? calendar.leave.get(employeeId) : undefined
    const halfDay = employeeId ? calendar.halfDay.get(employeeId) : undefined
    const rows: LogRow[] = monthDates(yearMonth)
      // Days before tracking started or before they joined only show if there's a record
      .filter(d => d <= today && ((d >= TRACKING_START && (!joiningDate || d >= joiningDate)) || recMap.has(d)))
      .reverse()
      .map(date => {
        const rec = recMap.get(date)
        const holiday = calendar.holidays.has(date)
        // A real check-in wins over full-day leave/holiday: they came in. Half days stay tagged.
        const isHalf = !!rec?.half_day_session || !!halfDay?.has(date)
        const mark: DayMark = isHalf ? 'half_leave'
          : rec?.check_in_time
          ? (rec.status === 'late' ? 'late' : 'present')
          : resolveMark(date, today, { holiday, choice: holiday && calendar.isChoiceHoliday(date), attendance: rec?.status, leave: leave?.get(date) })
        const complete = !!rec?.check_in_time && (!!rec.check_out_time || date === today)
        const shift = rec?.check_in_time ? shiftOn(date) : null
        return {
          date, mark, rec,
          note: calendar.holidays.get(date),
          worked: complete ? workedSeconds(rec, now, shift) : null,
          brk: totalBreakSeconds(rec, now),
          topUp: minBreakTopUp(rec, shift),
        }
      })

    // A half-day leave counts as half a day, both worked (if they checked in) and expected
    const weight = (r: LogRow) => r.mark === 'half_leave' ? 0.5 : 1
    const cameIn = (r: LogRow) => r.mark === 'present' || r.mark === 'late' || (r.mark === 'half_leave' && !!r.rec?.check_in_time)
    const presentDays = rows.filter(cameIn).reduce((n, r) => n + weight(r), 0)
    // Days they were expected in: not Sunday / holiday / approved leave, tracked past days,
    // and today (or an untracked day) only once checked in
    const workingDays = rows.filter(r =>
      !isSunday(r.date) && !calendar.holidays.has(r.date) && r.mark !== 'leave' &&
      ((r.date < today && r.date >= TRACKING_START && (!joiningDate || r.date >= joiningDate)) || cameIn(r)),
    ).reduce((n, r) => n + weight(r), 0)

    const workedTotal = rows.reduce((n, r) => n + (r.worked ?? 0), 0)
    const leaveDays = rows.reduce((n, r) => n + (r.mark === 'leave' ? 1 : r.mark === 'half_leave' ? 0.5 : 0), 0)
    return { rows, presentDays, workingDays, workedTotal, leaveDays }
  }, [records, calendar.holidays, calendar.leave, calendar.halfDay, employeeId, yearMonth, today, now, shiftOn, joiningDate])
}

/** Break for the day; marks days where the shift's minimum break was applied. */
function BreakCell({ r }: { r: LogRow }) {
  if (r.brk + r.topUp <= 0) return <>—</>
  if (!r.topUp) return <>{fmtHM(r.brk)}</>
  return (
    <span title={`You paused for ${r.brk ? fmtMins(r.brk) : 'no time'}; the minimum break was applied`}>
      {fmtHM(r.brk + r.topUp)} <small className="sb-minbreak-tag">min</small>
    </span>
  )
}

/** 1680 → "28 min" */
function fmtMins(seconds: number) {
  return `${Math.round(seconds / 60)} min`
}

function MonthLog({ yearMonth, onMonthChange, maxMonth, rows, calendar, pendingCorrections, onCorrect }: {
  yearMonth: string
  onMonthChange: (ym: string) => void
  maxMonth: string
  rows: LogRow[]
  calendar: ReturnType<typeof useMonthCalendar>
  pendingCorrections: Set<string>
  onCorrect: (date: string, rec?: AttendanceRecord) => void
}) {
  const today = localDate()
  const isThisMonth = yearMonth === maxMonth

  // Last 7 days: "Correct" button, or a marker while a request is open
  const fix = (r: LogRow) => !isCorrectable(r.date) ? null
    : pendingCorrections.has(r.date)
      ? <span className="sb-fix-pending">Correction pending</span>
      : <button type="button" className="sb-fix-btn" onClick={() => onCorrect(r.date, r.rec)}>Correct</button>

  const status = (r: LogRow) => (
    <span className={`sb-status s-${r.mark}`} title={r.note}>
      <i />{(r.mark === 'holiday' || r.mark === 'choice_holiday') && r.note ? r.note : MARK_LABELS[r.mark]}
    </span>
  )

  return (
    <section className="sb-log">
      <div className="sb-log-head">
        <CalendarDays size={20} strokeWidth={2} />
        <h2>{isThisMonth ? 'This Month’s Log' : 'Monthly Log'}</h2>
        <div className="sb-monthnav">
          <button onClick={() => onMonthChange(shiftMonth(yearMonth, -1))} disabled={yearMonth <= TRACKING_START.slice(0, 7)} aria-label="Previous month">
            <ChevronLeft size={18} strokeWidth={2.4} />
          </button>
          <span>{monthLabel(yearMonth)}</span>
          <button onClick={() => onMonthChange(shiftMonth(yearMonth, 1))} disabled={isThisMonth} aria-label="Next month">
            <ChevronRight size={18} strokeWidth={2.4} />
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
                <tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Break</th><th>Total Work Hours</th><th className="sb-fix-cell">Action</th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.date} className={r.date === today ? 'is-today' : r.mark === 'sunday' ? 'is-off' : undefined}>
                    <td>{fmtRowDate(r.date)}</td>
                    <td>{status(r)}</td>
                    <td>{fmtTime(r.rec?.check_in_time)}</td>
                    <td>{fmtTime(r.rec?.check_out_time)}</td>
                    <td><BreakCell r={r} /></td>
                    <td>{r.worked != null ? fmtHM(r.worked) : '—'}</td>
                    <td className="sb-fix-cell">{fix(r)}</td>
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
                    <div><dt>Break</dt><dd><BreakCell r={r} /></dd></div>
                    <div><dt>Worked</dt><dd>{r.worked != null ? fmtHM(r.worked) : '—'}</dd></div>
                  </dl>
                )}
                {fix(r) && <div className="sb-li-fix">{fix(r)}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
