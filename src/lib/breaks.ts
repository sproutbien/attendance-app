import type { AttendanceRecord } from '../types'

type TimedRecord = Pick<AttendanceRecord, 'check_in_time' | 'check_out_time' | 'break_started_at' | 'break_seconds'>

/** Total break time for the day, including a break that is still running. */
export function totalBreakSeconds(rec: TimedRecord | null | undefined, now = Date.now()) {
  if (!rec) return 0
  const running = rec.break_started_at
    ? Math.max(0, Math.floor((now - new Date(rec.break_started_at).getTime()) / 1000))
    : 0
  return (rec.break_seconds ?? 0) + running
}

/** Time between check-in and check-out (or now), minus breaks. */
export function workedSeconds(rec: TimedRecord | null | undefined, now = Date.now()) {
  if (!rec?.check_in_time) return 0
  const end = rec.check_out_time ? new Date(rec.check_out_time).getTime() : now
  const span = Math.floor((end - new Date(rec.check_in_time).getTime()) / 1000)
  return Math.max(0, span - totalBreakSeconds(rec, now))
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
