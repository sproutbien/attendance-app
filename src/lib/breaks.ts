import type { AttendanceRecord, Shift } from '../types'
import { minutesOf } from './shifts'

type TimedRecord = Pick<AttendanceRecord, 'check_in_time' | 'check_out_time' | 'break_started_at' | 'break_seconds' | 'half_day_session'>
export type BreakRule = Pick<Shift, 'start_time' | 'end_time' | 'min_break_minutes'>

/** Total break time for the day, including a break that is still running. */
export function totalBreakSeconds(rec: TimedRecord | null | undefined, now = Date.now()) {
  if (!rec) return 0
  const running = rec.break_started_at
    ? Math.max(0, Math.floor((now - new Date(rec.break_started_at).getTime()) / 1000))
    : 0
  return (rec.break_seconds ?? 0) + running
}

/** Seconds from check-in to check-out (or now). */
export function spanSeconds(rec: TimedRecord | null | undefined, now = Date.now()) {
  if (!rec?.check_in_time) return 0
  const end = rec.check_out_time ? new Date(rec.check_out_time).getTime() : now
  return Math.max(0, Math.floor((end - new Date(rec.check_in_time).getTime()) / 1000))
}

/** Length of the shift in seconds. */
export function shiftSeconds(shift: Pick<Shift, 'start_time' | 'end_time'>) {
  return (minutesOf(shift.end_time) - minutesOf(shift.start_time)) * 60
}

/**
 * Extra break deducted because they paused for less than the shift's minimum.
 * Full days only, once checked out, and only if they stayed at least half the shift.
 */
export function minBreakTopUp(rec: TimedRecord | null | undefined, shift: BreakRule | null | undefined) {
  if (!shift || !rec?.check_in_time || !rec.check_out_time || rec.half_day_session) return 0
  const min = (shift.min_break_minutes ?? 0) * 60
  if (min <= 0 || spanSeconds(rec) < shiftSeconds(shift) / 2) return 0
  return Math.max(0, min - totalBreakSeconds(rec))
}

/** Time between check-in and check-out (or now), minus breaks — at least the shift's minimum break when given. */
export function workedSeconds(rec: TimedRecord | null | undefined, now = Date.now(), shift?: BreakRule | null) {
  if (!rec?.check_in_time) return 0
  return Math.max(0, spanSeconds(rec, now) - totalBreakSeconds(rec, now) - minBreakTopUp(rec, shift))
}

/** 3725 → "1h 02m", 1500 → "25m", 0 → "—" */
export function fmtDuration(seconds: number) {
  if (seconds < 60) return seconds > 0 ? '<1m' : '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/** 16320 → "04h 32m", 0 → "00h 00m" */
export function fmtHM(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`
}

/** 754 → "12:34", 3725 → "1:02:05" — for a live ticking timer */
export function fmtClock(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mmss = `${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}
