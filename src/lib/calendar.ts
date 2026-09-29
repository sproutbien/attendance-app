import type { AttendanceRecord } from '../types'

// ── Date helpers (local time, "YYYY-MM" / "YYYY-MM-DD" strings) ──

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function currentYearMonth() {
  return localDate().slice(0, 7)
}

export function daysInMonth(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

export function monthDates(yearMonth: string): string[] {
  return Array.from({ length: daysInMonth(yearMonth) }, (_, i) => `${yearMonth}-${String(i + 1).padStart(2, '0')}`)
}

export function weekday(date: string) {
  return new Date(date + 'T00:00:00').getDay() // 0 = Sunday
}

export function isSunday(date: string) {
  return weekday(date) === 0
}

export function shiftMonth(yearMonth: string, delta: number) {
  const [year, month] = yearMonth.split('-').map(Number)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
}

/** Days in month minus Sundays minus holidays that don't fall on a Sunday */
export function suggestedWorkingDays(yearMonth: string, holidayDates: Iterable<string>) {
  const holidays = new Set(holidayDates)
  return monthDates(yearMonth).filter(d => !isSunday(d) && !holidays.has(d)).length
}

// ── Day marks ─────────────────────────────────────────────────

export type DayMark = 'holiday' | 'leave' | 'half_leave' | 'leave_pending' | 'present' | 'late' | 'absent' | 'sunday' | 'none'

export const MARK_STYLES: Record<DayMark, { bg: string; text: string; border?: string; code: string; label: string }> = {
  holiday:       { bg: '#2563eb', text: '#fff',    code: 'H',  label: 'Public holiday' },
  leave:         { bg: '#dc2626', text: '#fff',    code: 'LV', label: 'Leave' },
  half_leave:    { bg: '#fecaca', text: '#991b1b', code: 'HD', label: 'Half-day leave' },
  leave_pending: { bg: '#fee2e2', text: '#b91c1c', border: '1px dashed #dc2626', code: 'LV', label: 'Leave (pending)' },
  present:       { bg: '#dcfce7', text: '#166534', code: 'P',  label: 'Present' },
  late:          { bg: '#fef3c7', text: '#92400e', code: 'L',  label: 'Late' },
  absent:        { bg: '#e2e8f0', text: '#475569', code: 'A',  label: 'Absent' },
  sunday:        { bg: '#f8fafc', text: '#cbd5e1', code: 'S',  label: 'Sunday' },
  none:          { bg: 'transparent', text: '#cbd5e1', code: '', label: '' },
}

/**
 * What a single employee-day shows. Precedence:
 * holiday → approved half-day leave → approved leave → pending leave → present/late/absent record → Sunday → absent (past working days only)
 */
export function resolveMark(
  date: string,
  today: string,
  opts: {
    holiday: boolean
    attendance?: AttendanceRecord['status']
    leave?: 'approved' | 'pending'
    halfDay?: boolean   // approved half-day leave on this date
  },
): DayMark {
  if (opts.holiday) return 'holiday'
  if (opts.halfDay) return 'half_leave'
  if (opts.leave === 'approved' || opts.attendance === 'on_leave') return 'leave'
  if (opts.leave === 'pending') return 'leave_pending'
  if (opts.attendance === 'present') return 'present'
  if (opts.attendance === 'late') return 'late'
  if (opts.attendance === 'absent') return 'absent'
  if (isSunday(date)) return 'sunday'
  if (date < today) return 'absent'
  return 'none'
}
