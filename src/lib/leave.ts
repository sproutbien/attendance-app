import type { LeaveTypeCode } from '../types'

export const LEAVE_TYPE_LABELS: Record<LeaveTypeCode, string> = {
  casual: 'Casual',
  sick:   'Sick',
  earned: 'Earned',
  lop:    'Loss of Pay',
}

/** Leave year containing a date: Apr 2026 – Mar 2027 → 2026. Mirrors leave_year_of() in migration 014. */
export function leaveYearOf(date: string) {
  const [y, m] = date.split('-').map(Number)
  return m >= 4 ? y : y - 1
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
