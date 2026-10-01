import type { HalfDaySession, LeaveRequest, Shift } from '../types'
import { at, fmtClock, minutesOf } from './shifts'

// Half days follow the employee's shift: the morning half runs from the shift
// start to its split time, the afternoon half from the split to the end.
// Must match migration 020 (auto check-out, leave_starts_at, check_leave_request_timing).

export const SESSION_SHORT: Record<HalfDaySession, string> = {
  morning:   'Morning',
  afternoon: 'Afternoon',
}

/** The shift's split time on the given local calendar date ("YYYY-MM-DD"). */
export function halfDaySplit(shift: Shift, date: string) {
  return at(date, shift.split_time)
}

/** When the leave begins: shift start, or the split for an afternoon half day. */
export function leaveStartsAt(shift: Shift, r: Pick<LeaveRequest, 'start_date' | 'half_day_session'>) {
  return at(r.start_date, r.half_day_session === 'afternoon' ? shift.split_time : shift.start_time)
}

// Must match cancel_leave_request() in migration 020
const CANCEL_CUTOFF_MS = 10 * 60_000

/** Last moment the employee can cancel: 10 minutes before the leave starts. */
export function cancelDeadline(shift: Shift, r: Pick<LeaveRequest, 'start_date' | 'half_day_session'>) {
  return new Date(leaveStartsAt(shift, r).getTime() - CANCEL_CUTOFF_MS)
}

export function canCancel(shift: Shift, r: Pick<LeaveRequest, 'status' | 'start_date' | 'half_day_session'>, now = Date.now()) {
  return (r.status === 'pending' || r.status === 'approved') && now < cancelDeadline(shift, r).getTime()
}

/** "Half day · Morning", "1 day", "3 days" */
export function leaveLength(r: Pick<LeaveRequest, 'start_date' | 'end_date' | 'duration' | 'half_day_session'>) {
  if (r.duration === 'half' && r.half_day_session) return `Half day · ${SESSION_SHORT[r.half_day_session]}`
  const n = Math.round((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000) + 1
  return `${n} day${n !== 1 ? 's' : ''}`
}

/** Full-day leave for today can be requested until an hour after the shift starts. */
const FULL_DAY_GRACE_MIN = 60

/**
 * Why a leave starting today can't be requested right now, or null if it can.
 * Must match check_leave_request_timing() in migration 020.
 *   Not checked in: full day until shift start + 1 hour; half days any time.
 *   Checked in:     afternoon half day until the split only.
 */
export function sameDayLeaveBlock(
  shift: Shift,
  duration: LeaveRequest['duration'],
  session: HalfDaySession | null,
  checkedIn: boolean,
  now = new Date(),
): string | null {
  const minutes = now.getHours() * 60 + now.getMinutes()
  if (checkedIn) {
    if (duration === 'full') return 'You’ve already checked in today, so you can’t take a full day’s leave for today.'
    if (session === 'morning') return 'You’ve already checked in today, so you can’t take the morning off.'
    if (minutes > minutesOf(shift.split_time)) return `Afternoon half-day leave for today can only be requested until ${fmtClock(shift.split_time)}.`
    return null
  }
  const fullUntil = minutesOf(shift.start_time) + FULL_DAY_GRACE_MIN
  if (duration === 'full' && minutes > fullUntil) {
    const t = `${String(Math.floor(fullUntil / 60)).padStart(2, '0')}:${String(fullUntil % 60).padStart(2, '0')}`
    return `Full-day leave for today can only be requested until ${fmtClock(t)}. You can still request a half day.`
  }
  return null
}
