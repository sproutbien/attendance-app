import type { HalfDaySession, Shift } from '../types'

// Shift time helpers. Times are "HH:MM[:SS]" strings in local (IST) time.

/** The original fixed rules — used only until the employee's real shift has loaded. */
export const FALLBACK_SHIFT: Shift = {
  id: '', name: 'General', is_default: true,
  start_time: '09:30:00', end_time: '17:30:00', late_after: '09:40:00', half_day_after: '11:30:00', split_time: '13:30:00', min_break_minutes: 40,
}

/** Minutes since midnight. */
export function minutesOf(time: string) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** That time on a local calendar date ("YYYY-MM-DD"). */
export function at(date: string, time: string) {
  const d = new Date(date + 'T00:00:00')
  d.setHours(0, minutesOf(time), 0, 0)
  return d
}

/** "13:30:00" → "1:30 PM" */
export function fmtClock(time: string) {
  const m = minutesOf(time)
  const h = Math.floor(m / 60)
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "9:30 AM – 5:30 PM" */
export function shiftHours(s: Shift) {
  return `${fmtClock(s.start_time)} – ${fmtClock(s.end_time)}`
}

/** "Morning (9:30 AM – 1:30 PM)" */
export function sessionLabel(s: Shift, session: HalfDaySession) {
  return session === 'morning'
    ? `Morning (${fmtClock(s.start_time)} – ${fmtClock(s.split_time)})`
    : `Afternoon (${fmtClock(s.split_time)} – ${fmtClock(s.end_time)})`
}

/** "HH:MM" for <input type="time"> */
export function toInput(time: string) {
  return time.slice(0, 5)
}
