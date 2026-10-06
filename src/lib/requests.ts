import { shiftSeconds, workedSeconds } from './breaks'
import { fmtClock, minutesOf } from './shifts'
import type { AttendanceRecord, PermissionRequest, RequestStatus, Shift } from '../types'

// One-day shift changes and permissions (migration 042)

export const REQUEST_STATUS: Record<RequestStatus, { label: string; bg: string; fg: string }> = {
  pending:   { label: 'Pending',   bg: '#fef9c3', fg: '#854d0e' },
  approved:  { label: 'Approved',  bg: '#dcfce7', fg: '#166534' },
  rejected:  { label: 'Rejected',  bg: '#fee2e2', fg: '#991b1b' },
  cancelled: { label: 'Cancelled', bg: '#f1f5f9', fg: '#64748b' },
}

/** "2:00–4:00 PM" */
export function fmtPermissionTime(p: Pick<PermissionRequest, 'start_time' | 'end_time'>) {
  const a = fmtClock(p.start_time), b = fmtClock(p.end_time)
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a} – ${b}`
}

export function permissionMinutes(p: Pick<PermissionRequest, 'start_time' | 'end_time'>) {
  return minutesOf(p.end_time) - minutesOf(p.start_time)
}

/** "2h", "1h 30m", "45m" */
export function fmtMinutes(m: number) {
  const h = Math.floor(m / 60), r = m % 60
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`
}

/** "Thu 15 Oct" */
export function fmtRequestDay(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Hours the shift expects: its length minus the minimum break. */
export function requiredSeconds(shift: Pick<Shift, 'start_time' | 'end_time' | 'min_break_minutes'>) {
  return Math.max(0, shiftSeconds(shift) - (shift.min_break_minutes ?? 0) * 60)
}

export type PermissionOutcome =
  | { kind: 'upcoming' }
  | { kind: 'in_progress' }          // today, not checked out yet
  | { kind: 'no_check_in' }
  | { kind: 'made_up' }
  | { kind: 'short'; seconds: number }

/** Did they make up an approved permission's time that day? */
export function permissionOutcome(
  p: Pick<PermissionRequest, 'date'>, rec: AttendanceRecord | null | undefined, shift: Shift | null, today: string,
): PermissionOutcome {
  if (p.date > today) return { kind: 'upcoming' }
  if (!rec?.check_in_time) return p.date === today ? { kind: 'upcoming' } : { kind: 'no_check_in' }
  if (!rec.check_out_time) return p.date === today ? { kind: 'in_progress' } : { kind: 'short', seconds: shift ? requiredSeconds(shift) : 0 }
  if (!shift) return { kind: 'made_up' }
  const short = requiredSeconds(shift) - workedSeconds(rec, Date.now(), shift)
  return short <= 60 ? { kind: 'made_up' } : { kind: 'short', seconds: short }
}
