import type { AttendanceRecord, EmployeeShift, LeaveRequest, LeaveTypeCode, Shift } from '../types'
import { TRACKING_START, isSunday, monthDates } from './calendar'
import { minBreakTopUp, shiftSeconds, spanSeconds, totalBreakSeconds, workedSeconds } from './breaks'
import { FALLBACK_SHIFT, minutesOf } from './shifts'

// Month statistics for one employee — powers the Reports screen.
// Day rules match the dashboard's This Month card (DashboardPage useMonthLog):
// a half-day leave counts half leave + half whatever happened in the other half,
// a check-in wins over a holiday / Sunday, today only counts once checked in.

export type DayKind = 'on_time' | 'late' | 'leave' | 'absent'

export type DayStat = {
  date: string
  worked: number              // seconds, completed days (and today so far)
  expected: number            // shift seconds for the part of the day they were due in
  breaks: number              // seconds actually paused
  topUp: number               // seconds added to reach the shift's minimum break (full days)
  noBreak: boolean            // full day checked out with no break recorded at all
  longDay: boolean            // checked in for 2+ hours longer than the shift (timer left running?)
  checkIn: number | null      // minutes since midnight (full / afternoon-leave days only)
  checkOut: number | null     // minutes since midnight (full / morning-leave days only)
  lateAfter: number           // the shift's late threshold, minutes
  kind: DayKind | null        // main status of the day (null = not a working day)
  half: boolean               // half-day leave
}

export type MonthStats = {
  yearMonth: string
  days: DayStat[]             // every date up to today that has something to show
  workingDays: number         // days they were due: on time + late + leave + absent
  onTime: number
  late: number
  leave: number
  absent: number
  present: number             // on time + late
  attendanceRate: number | null   // present / (working days − leave)
  onTimeRate: number | null       // on time / present
  worked: number              // seconds
  avgWorked: number           // seconds per present day
  expected: number            // shift seconds on days they came in
  breaks: number
  avgBreak: number            // per present day
  topUpDays: number           // full days where the minimum break was applied
  topUp: number               // seconds deducted beyond recorded breaks
  noBreakDays: number
  longDays: number
  avgCheckIn: number | null   // minutes since midnight
  avgCheckOut: number | null
  leaveByType: Record<LeaveTypeCode, number>
}

export type StatsInput = {
  records: AttendanceRecord[]
  holidays: Set<string>
  leaves: LeaveRequest[]       // approved
  shifts: Shift[]
  assignments: EmployeeShift[] // sorted by effective_from
  activeFrom?: string | null   // joining date: earlier days aren't counted
  activeTo?: string | null     // last working day: later days aren't counted
}

export function shiftOnDate(input: Pick<StatsInput, 'shifts' | 'assignments'>, date: string): Shift {
  let id: string | null = null
  for (const a of input.assignments) if (a.effective_from <= date) id = a.shift_id
  return input.shifts.find(s => s.id === id) ?? input.shifts.find(s => s.is_default) ?? FALLBACK_SHIFT
}

/** Checked in this much longer than the shift → flagged as a possible timer left running. */
export const LONG_DAY_EXTRA = 2 * 3600

const localMinutes = (iso: string) => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

export function computeMonthStats(yearMonth: string, input: StatsInput, today: string, now = Date.now()): MonthStats {
  const recs = new Map(input.records.map(r => [r.date, r]))
  const leaveOn = (d: string) => input.leaves.find(l => l.start_date <= d && l.end_date >= d)

  const s: MonthStats = {
    yearMonth, days: [], workingDays: 0, onTime: 0, late: 0, leave: 0, absent: 0, present: 0,
    attendanceRate: null, onTimeRate: null, worked: 0, avgWorked: 0, expected: 0, breaks: 0, avgBreak: 0,
    topUpDays: 0, topUp: 0, noBreakDays: 0, longDays: 0,
    avgCheckIn: null, avgCheckOut: null, leaveByType: { casual: 0, sick: 0, earned: 0, lop: 0 },
  }
  const ins: number[] = []
  const outs: number[] = []

  for (const date of monthDates(yearMonth)) {
    if (date > today) break
    const rec = recs.get(date)
    if (date < TRACKING_START && !rec) continue
    if (!rec && ((input.activeFrom && date < input.activeFrom) || (input.activeTo && date > input.activeTo))) continue

    const shift = shiftOnDate(input, date)
    const start = minutesOf(shift.start_time), split = minutesOf(shift.split_time), end = minutesOf(shift.end_time)
    const req = leaveOn(date)
    const cameIn = !!rec?.check_in_time
    const session = rec?.half_day_session ?? (req?.duration === 'half' ? req.half_day_session : null)
    const fullLeave = !session && (req?.duration === 'full' || rec?.status === 'on_leave')
    const offDay = isSunday(date) || input.holidays.has(date)

    const day: DayStat = {
      date, worked: 0, expected: 0, breaks: totalBreakSeconds(rec, now), topUp: 0, noBreak: false, longDay: false, checkIn: null, checkOut: null,
      lateAfter: minutesOf(shift.late_after), kind: null, half: !!session,
    }

    // What the day counts as
    const weight = session ? 0.5 : 1
    if (session) {
      s.leave += 0.5
      addLeave(s, req, rec, 0.5)
    }
    if (cameIn) {
      day.kind = rec!.status === 'late' ? 'late' : 'on_time'
      if (day.kind === 'late') s.late += weight
      else s.onTime += weight
    } else if (fullLeave && !offDay) {
      day.kind = 'leave'
      s.leave += 1
      addLeave(s, req, rec, 1)
    } else if (!offDay && date < today && date >= TRACKING_START) {
      day.kind = 'absent'
      s.absent += weight
    } else if (session) {
      day.kind = 'leave'   // today, other half not started yet
    }

    // Hours
    if (cameIn) {
      const complete = !!rec!.check_out_time || date === today
      if (complete) day.worked = workedSeconds(rec, now, shift)
      day.topUp = minBreakTopUp(rec, shift)
      day.noBreak = day.topUp > 0 && day.breaks === 0
      day.longDay = !!rec!.check_out_time && spanSeconds(rec) >= shiftSeconds(shift) + LONG_DAY_EXTRA
      if (day.topUp > 0) { s.topUpDays++; s.topUp += day.topUp }
      if (day.noBreak) s.noBreakDays++
      if (day.longDay) s.longDays++
      day.expected = 60 * (session === 'morning' ? end - split : session === 'afternoon' ? split - start : end - start)
      if (session !== 'morning') { day.checkIn = localMinutes(rec!.check_in_time!); ins.push(day.checkIn) }
      if (session !== 'afternoon' && rec!.check_out_time) { day.checkOut = localMinutes(rec!.check_out_time); outs.push(day.checkOut) }
      if (complete) s.expected += day.expected
    }
    s.worked += day.worked
    s.breaks += day.breaks

    if (day.kind || cameIn) s.days.push(day)
  }

  s.present = s.onTime + s.late
  s.workingDays = s.present + s.leave + s.absent
  const due = s.workingDays - s.leave
  s.attendanceRate = due > 0 ? s.present / due : null
  s.onTimeRate = s.present > 0 ? s.onTime / s.present : null
  s.avgWorked = s.present > 0 ? s.worked / s.present : 0
  s.avgBreak = s.present > 0 ? s.breaks / s.present : 0
  s.avgCheckIn = ins.length ? Math.round(ins.reduce((a, b) => a + b, 0) / ins.length) : null
  s.avgCheckOut = outs.length ? Math.round(outs.reduce((a, b) => a + b, 0) / outs.length) : null
  return s
}

/** Splits a leave day into its type; whatever paid leave didn't cover is Loss of Pay. */
function addLeave(s: MonthStats, req: LeaveRequest | undefined, rec: AttendanceRecord | undefined, weight: number) {
  const type: LeaveTypeCode = req?.leave_type ?? 'lop'
  if (type === 'lop') { s.leaveByType.lop += weight; return }
  const paid = rec ? Math.min(weight, Number(rec.paid_leave ?? 0)) : weight
  s.leaveByType[type] += paid
  s.leaveByType.lop += weight - paid
}

/** Thresholds for the admin's "Worth a look" list. */
const FLAG_NO_BREAK_DAYS = 3
const FLAG_TOP_UP_DAYS = 5

/** Break / timer patterns an admin may want to ask about (empty when nothing stands out). */
export function breakFlags(m: Pick<MonthStats, 'noBreakDays' | 'topUpDays' | 'longDays'>): string[] {
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
  const flags: string[] = []
  if (m.noBreakDays >= FLAG_NO_BREAK_DAYS) flags.push(`No break recorded on ${days(m.noBreakDays)}`)
  else if (m.topUpDays >= FLAG_TOP_UP_DAYS) flags.push(`Paused less than the minimum break on ${days(m.topUpDays)}`)
  if (m.longDays > 0) flags.push(`${days(m.longDays)} 2+ hours longer than the shift (timer left running?)`)
  return flags
}

/** 570 → "9:30 AM" */
export function fmtMinutes(m: number) {
  const h = Math.floor(m / 60)
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** 1.5 → "1.5", 2 → "2" */
export function fmtDays(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function fmtPct(r: number | null) {
  return r == null ? '—' : `${Math.round(r * 100)}%`
}

export type TeamTotals = Pick<MonthStats,
  'onTime' | 'late' | 'leave' | 'absent' | 'present' | 'workingDays' | 'worked' | 'expected' | 'breaks'
  | 'attendanceRate' | 'onTimeRate' | 'avgWorked' | 'topUpDays' | 'noBreakDays' | 'longDays'
> & { people: number }

/** Adds up several people's month stats; rates are worked out from the sums, not averaged. */
export function teamTotals(list: MonthStats[]): TeamTotals {
  const sum = (k: 'onTime' | 'late' | 'leave' | 'absent' | 'present' | 'workingDays' | 'worked' | 'expected' | 'breaks'
    | 'topUpDays' | 'noBreakDays' | 'longDays') =>
    list.reduce((n, m) => n + m[k], 0)
  const t = {
    onTime: sum('onTime'), late: sum('late'), leave: sum('leave'), absent: sum('absent'), present: sum('present'),
    workingDays: sum('workingDays'), worked: sum('worked'), expected: sum('expected'), breaks: sum('breaks'),
    topUpDays: sum('topUpDays'), noBreakDays: sum('noBreakDays'), longDays: sum('longDays'),
    people: list.filter(m => m.workingDays > 0).length,
  }
  const due = t.workingDays - t.leave
  return {
    ...t,
    attendanceRate: due > 0 ? t.present / due : null,
    onTimeRate: t.present > 0 ? t.onTime / t.present : null,
    avgWorked: t.present > 0 ? t.worked / t.present : 0,
  }
}
