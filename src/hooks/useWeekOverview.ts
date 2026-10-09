import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TRACKED_STATUSES } from '../lib/employees'
import { localDate, isSunday } from '../lib/calendar'
import { addDays } from '../lib/leave'
import { loadHolidays } from '../lib/holidays'
import type { AttendanceRecord, Employee } from '../types'

/** How far back the trend and late streaks look, today included. */
export const TREND_DAYS = 7
/** How far ahead holidays and anniversaries are listed. */
export const UPCOMING_DAYS = 30
/** Late this many times within TREND_DAYS puts someone on the nudge list. */
export const LATE_STREAK_MIN = 3

export type OverviewPerson = Pick<Employee, 'id' | 'full_name' | 'photo_path' | 'joining_date'>

export type TrendDay = {
  date: string
  off: string | null                 // 'Sunday' or the holiday name: no one due in
  on_time: number
  late: number
  leave: number
  absent: number
}

export type LateStreak = { person: OverviewPerson; dates: string[] }

export type Upcoming = { date: string; kind: 'holiday' | 'anniversary' | 'birthday'; label: string; person?: OverviewPerson }

/** The next yearly repeat of `date` (YYYY-MM-DD) from today up to `until`; 29 Feb falls on 28 Feb in other years. */
function nextRepeat(date: string, today: string, until: string): string | null {
  const year = Number(today.slice(0, 4))
  for (const y of [year, year + 1]) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    const md = date.slice(5) === '02-29' && !leap ? '02-28' : date.slice(5)
    const d = `${y}-${md}`
    if (d >= today && d <= until) return d
  }
  return null
}

export type WeekOverview = {
  today: string
  days: TrendDay[]                   // oldest first, today last
  lateStreaks: LateStreak[]
  upcoming: Upcoming[]               // soonest first
}

/**
 * Admin home: the last week's attendance, who keeps arriving late,
 * and what's coming up (public holidays, work anniversaries).
 * Day status follows useAdminAttendance: no record = absent, unless on long leave.
 */
export function useWeekOverview() {
  const [data, setData] = useState<WeekOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const today = localDate()
    const from = addDays(today, -(TREND_DAYS - 1))
    const until = addDays(today, UPCOMING_DAYS)

    Promise.all([
      supabase.from('employees')
        .select('id, full_name, photo_path, joining_date, status')
        .in('status', TRACKED_STATUSES).order('full_name'),
      supabase.from('attendance_records')
        .select('employee_id, date, status')
        .gte('date', from).lte('date', today),
      loadHolidays(from, until),
      // Separate so the rest still works before migration 045 has been run
      supabase.from('employees').select('id, date_of_birth').in('status', TRACKED_STATUSES).not('date_of_birth', 'is', null),
    ]).then(([emp, att, hol, dob]) => {
      if (cancelled) return
      const err = (emp.error ?? att.error)?.message ?? hol.error
      if (err) { setError(err); return }

      const people = (emp.data ?? []) as (OverviewPerson & { status: Employee['status'] })[]
      const records = new Map<string, AttendanceRecord['status']>()
      for (const r of (att.data ?? []) as { employee_id: string; date: string; status: AttendanceRecord['status'] }[]) {
        records.set(`${r.employee_id}|${r.date}`, r.status)
      }

      // Trend + late dates per person
      const lateDates = new Map<string, string[]>()
      const days: TrendDay[] = Array.from({ length: TREND_DAYS }, (_, i) => addDays(from, i)).map(date => {
        const off = isSunday(date) ? 'Sunday' : hol.holidays.common.get(date) ?? null
        const day: TrendDay = { date, off, on_time: 0, late: 0, leave: 0, absent: 0 }
        if (off) return day
        for (const p of people) {
          if (p.joining_date && p.joining_date > date) continue
          const status = records.get(`${p.id}|${date}`) ?? (p.status === 'on_long_leave' ? 'on_leave' : 'absent')
          if (status === 'present') day.on_time++
          else if (status === 'late') { day.late++; lateDates.set(p.id, [...(lateDates.get(p.id) ?? []), date]) }
          else if (status === 'on_leave') day.leave++
          else day.absent++
        }
        return day
      })

      const lateStreaks = people
        .filter(p => (lateDates.get(p.id)?.length ?? 0) >= LATE_STREAK_MIN)
        .map(p => ({ person: p, dates: lateDates.get(p.id)! }))
        .sort((a, b) => b.dates.length - a.dates.length || a.person.full_name.localeCompare(b.person.full_name))

      // Upcoming: public holidays, birthdays, work anniversaries (1 year or more), within UPCOMING_DAYS
      const upcoming: Upcoming[] = [...hol.holidays.common]
        .filter(([date]) => date >= today && date <= until)
        .map(([date, name]) => ({ date, kind: 'holiday' as const, label: name }))
      const byId = new Map(people.map(p => [p.id, p]))
      for (const r of (dob.data ?? []) as { id: string; date_of_birth: string }[]) {
        const date = nextRepeat(r.date_of_birth, today, until)
        if (date && byId.has(r.id)) upcoming.push({ date, kind: 'birthday', label: 'Birthday', person: byId.get(r.id) })
      }
      for (const p of people) {
        const date = p.joining_date && nextRepeat(p.joining_date, today, until)
        const years = date ? Number(date.slice(0, 4)) - Number(p.joining_date!.slice(0, 4)) : 0
        if (date && years >= 1) upcoming.push({ date, kind: 'anniversary', label: `${years} year${years === 1 ? '' : 's'} with the team`, person: p })
      }
      upcoming.sort((a, b) => a.date.localeCompare(b.date))

      setData({ today, days, lateStreaks, upcoming })
    })
    return () => { cancelled = true }
  }, [])

  return { overview: data, error }
}
