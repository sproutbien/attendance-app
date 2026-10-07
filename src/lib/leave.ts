import type { LeaveBalance, LeaveRequest, LeaveTypeCode } from '../types'

export const LEAVE_TYPE_LABELS: Record<LeaveTypeCode, string> = {
  casual: 'Casual',
  sick:   'Sick',
  earned: 'Earned',
  lop:    'Loss of Pay',
}

/** Types the admin's monthly limits apply to. Mirrors leave_type_month_capped() in migration 026. */
export function isMonthCapped(type: LeaveTypeCode) {
  return type === 'casual' || type === 'earned'
}

/** Leave year containing a date: Apr 2026 – Mar 2027 → 2026. Mirrors leave_year_of() in migration 014. */
export function leaveYearOf(date: string) {
  const [y, m] = date.split('-').map(Number)
  return m >= 4 ? y : y - 1
}

/**
 * Date whose balance a leave starting on `start` is checked against. Mirrors leave_bookable_as_of() in migration 016:
 * today for this leave year, 1 April for a later one, 31 March for an earlier one.
 */
export function bookableAsOf(start: string, today: string) {
  const y = leaveYearOf(start)
  const current = leaveYearOf(today)
  if (y === current) return today
  return y > current ? `${y}-04-01` : `${y + 1}-03-31`
}

/** Paid days still free to request: credited balance minus pending requests (never below 0) */
export function bookableDays(b: Pick<LeaveBalance, 'available' | 'pending'>) {
  return Math.max(0, (b.available ?? 0) - b.pending)
}

export function leaveYearLabel(year: number) {
  return `Apr ${year} – Mar ${year + 1}`
}

/** 2 → "2", 1.5 → "1.5", 0.25 → "0.25" */
export function fmtDays(n: number | null | undefined) {
  if (n == null) return '—'
  return String(Math.round(n * 100) / 100)
}

export function daysLabel(n: number) {
  return `${fmtDays(n)} day${n === 1 ? '' : 's'}`
}

/** Working days in a leave (Sundays and holidays skipped; half day = 0.5). Mirrors leave_working_days(). */
export function workingDays(start: string, end: string, half: boolean, holidays: Set<string>) {
  let n = 0
  const d = new Date(start + 'T00:00:00')
  const last = new Date(end + 'T00:00:00')
  while (d <= last) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (d.getDay() !== 0 && !holidays.has(iso)) n++
    d.setDate(d.getDate() + 1)
  }
  return half ? n * 0.5 : n
}

/** Leave can start up to this many days back (e.g. Sick leave for yesterday). Mirrors leave_backdate_days() in migration 043. */
export const LEAVE_BACKDATE_DAYS = 7

/** Earliest start date a new leave request can have. */
export function earliestLeaveDate(today: string) {
  return addDays(today, -LEAVE_BACKDATE_DAYS)
}

/** Pending or approved full-day leave that covers `today`: check-in is blocked until today's part is cancelled. */
export function coversToday(r: Pick<LeaveRequest, 'status' | 'duration' | 'start_date' | 'end_date'>, today: string) {
  return (r.status === 'pending' || r.status === 'approved') && r.duration === 'full' && r.start_date <= today && r.end_date >= today
}

/** "Wed 3 Oct" */
export function fmtLeaveDay(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "Wed 3 Oct" or "Wed 3 Oct – Fri 5 Oct" */
export function fmtLeaveSpan(start: string, end: string) {
  return start === end ? fmtLeaveDay(start) : `${fmtLeaveDay(start)} – ${fmtLeaveDay(end)}`
}

/** The day before / after an ISO date. */
export function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Span = Pick<LeaveRequest, 'start_date' | 'end_date' | 'duration' | 'half_day_session'>

/**
 * A pending or approved request that already covers any of these dates, or undefined.
 * The other half of a half day is allowed. Mirrors check_leave_overlap() in migration 015.
 */
export function findLeaveClash(existing: (Span & Pick<LeaveRequest, 'status'>)[], wanted: Span) {
  return existing.find(r =>
    (r.status === 'pending' || r.status === 'approved') &&
    r.start_date <= wanted.end_date &&
    r.end_date >= wanted.start_date &&
    !(r.duration === 'half' && wanted.duration === 'half' && r.half_day_session !== wanted.half_day_session),
  )
}
