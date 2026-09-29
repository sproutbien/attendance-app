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

/** "Half day · Morning", "1 day", "3 days" */
export function leaveLength(r: Pick<LeaveRequest, 'start_date' | 'end_date' | 'duration' | 'half_day_session'>) {
  if (r.duration === 'half' && r.half_day_session) return `Half day · ${SESSION_SHORT[r.half_day_session]}`
  const n = Math.round((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / 86400000) + 1
  return `${n} day${n !== 1 ? 's' : ''}`
}
