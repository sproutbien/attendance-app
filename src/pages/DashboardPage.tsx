import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useAttendance } from '../hooks/useAttendance'
import { useCorrections } from '../hooks/useCorrections'
import CorrectionDialog from '../components/CorrectionDialog'
import MyCorrections from '../components/MyCorrections'
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
import { TRACKING_START, currentYearMonth, isSunday, localDate, monthDates, resolveMark } from '../lib/calendar'
import type { DayMark } from '../lib/calendar'
import { minBreakTopUp, totalBreakSeconds, workedSeconds } from '../lib/breaks'
import { halfDaySplit } from '../lib/halfDay'
import { shiftHours } from '../lib/shifts'
import { useMyShift, useShiftHistory } from '../hooks/useShifts'
import { useEmployeeStats } from '../hooks/useEmployeeStats'
import MonthCalendarLog from '../components/dashboard/MonthCalendarLog'
import type { LogRow } from '../components/dashboard/MonthCalendarLog'
import { CheckInBar, MonthCard, RecentDaysCard, ScoreCard, ShiftCard } from '../components/dashboard/TodayPanel'
import type { DayState } from '../components/dashboard/TodayPanel'
import { supabase } from '../lib/supabase'
import { LEAVE_TYPE_LABELS, fmtLeaveSpan } from '../lib/leave'
import type { LeaveRequest } from '../types'
import type { AttendanceRecord, Shift } from '../types'

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
  // The cards always show the current month, whatever month the log below is on
  const { stats, loading: statsLoading } = useEmployeeStats(employee ?? undefined, thisMonth, todayRecord)
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

        <CheckInBar
          state={state}
          record={todayRecord ?? null}
          now={now}
          shift={shift}
          isSubmitting={isSubmitting || preparing !== ''}
          halfDay={halfDay}
          pastSplit={pastSplit}
          leave={todaysLeave}
          startsOn={startsOn}
          onCheckIn={startCheckIn}
          onCheckOut={() => setConfirmingOut(true)}
          onPause={pauseBreak}
          onResume={resumeBreak}
          onCancelLeave={() => todaysLeave && navigate(`/leave?cancel=${todaysLeave.id}`)}
        />

        <section className="sb-dcards">
          <ShiftCard
            shift={shift}
            highlight={state === 'idle' && !todaysLeave && !halfDay && !startsOn && todayRecord?.status !== 'on_leave'}
          />
          <RecentDaysCard
            trend={stats?.trend ?? null}
            today={todayRecord ?? null}
            now={now}
            shift={shift}
            onLeave={!!todaysLeave || todayRecord?.status === 'on_leave'}
            loading={statsLoading}
          />
          <MonthCard month={stats?.month ?? null} loading={statsLoading} />
          <ScoreCard month={stats?.month ?? null} previous={stats?.previous ?? null} loading={statsLoading} />
        </section>

        <ChoiceHolidayCard />

        <MonthCalendarLog
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

// ── This Month's Log ──────────────────────────────────────────

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
