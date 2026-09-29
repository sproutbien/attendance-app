import type { HalfDaySession, LeaveRequest } from '../types'

// Morning half-day 9:30 AM – 1:30 PM, afternoon 1:30 PM – 5:30 PM (local time).
// The 1:30 PM split must match auto_checkout_afternoon_half_days() in migration 009.
export const HALF_DAY_SPLIT = { hour: 13, minute: 30 }

export const SESSION_LABELS: Record<HalfDaySession, string> = {
  morning:   'Morning (9:30 AM – 1:30 PM)',
  afternoon: 'Afternoon (1:30 PM – 5:30 PM)',
}

export const SESSION_SHORT: Record<HalfDaySession, string> = {
  morning:   'Morning',
  afternoon: 'Afternoon',
}

/** 1:30 PM on the given local calendar date ("YYYY-MM-DD"). */
export function halfDaySplit(date: string) {
  const d = new Date(date + 'T00:00:00')
  d.setHours(HALF_DAY_SPLIT.hour, HALF_DAY_SPLIT.minute, 0, 0)
  return d
}

/** When the leave begins: 9:30 AM, or 1:30 PM for an afternoon half day (local time). */
export function leaveStartsAt(r: Pick<LeaveRequest, 'start_date' | 'half_day_session'>) {
  if (r.half_day_session === 'afternoon') return halfDaySplit(r.start_date)
  const d = new Date(r.start_date + 'T00:00:00')
  d.setHours(9, 30, 0, 0)
  return d
}

// Must match cancel_leave_request() in migration 010
const CANCEL_CUTOFF_MS = 10 * 60_000

/** Last moment the employee can cancel: 10 minutes before the leave starts. */
export function cancelDeadline(r: Pick<LeaveRequest, 'start_date' | 'half_day_session'>) {
  return new Date(leaveStartsAt(r).getTime() - CANCEL_CUTOFF_MS)
}

export function canCancel(r: Pick<LeaveRequest, 'status' | 'start_date' | 'half_day_session'>, now = Date.now()) {
  return (r.status === 'pending' || r.status === 'approved') && now < cancelDeadline(r).getTime()
}

/** "Half day · Morning", "1 day", "3 days" */
export function leaveLength(r: Pick<LeaveRequest, 'start_date' | 'end_date' | 'duration' | 'half_day_session'>) {
  if (r.duration === 'half' && r.half_day_session) return `Half day · ${SESSION_SHORT[r.half_day_session]}`
  const n = Math.round((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000) + 1
  return `${n} day${n !== 1 ? 's' : ''}`
}
