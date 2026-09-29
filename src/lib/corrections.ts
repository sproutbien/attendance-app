import { localDate } from './calendar'

// Must match check_attendance_correction() in migration 013
export const CORRECTION_WINDOW_DAYS = 7

/** Oldest date a correction can be requested for (today counts as day 1). */
export function oldestCorrectableDate() {
  const d = new Date()
  d.setDate(d.getDate() - (CORRECTION_WINDOW_DAYS - 1))
  return localDate(d)
}

export function isCorrectable(date: string) {
  return date >= oldestCorrectableDate() && date <= localDate()
}

/** ISO timestamp → "HH:MM" in local time, for <input type="time"> */
export function toTimeInput(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "YYYY-MM-DD" + "HH:MM" (local) → ISO timestamp, or null when the time is empty */
export function fromTimeInput(date: string, time: string) {
  return time ? new Date(`${date}T${time}:00`).toISOString() : null
}

/** "9:32 AM", or "—" */
export function fmtClockTime(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'
}
