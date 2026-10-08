import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/calendar'
import { addDays } from '../lib/leave'
import { loadHolidays } from '../lib/holidays'
import type { HolidayCalendar } from '../lib/holidays'
import type { AttendanceRecord, LeaveRequest } from '../types'

/** How far ahead "this week" looks, today included. */
export const WEEK_DAYS = 7

export type WeekLeave = Pick<LeaveRequest, 'id' | 'employee_id' | 'start_date' | 'end_date' | 'duration' | 'half_day_session' | 'leave_type' | 'status'>

export type PendingCounts = { leave: number; cancelled: number; corrections: number; shiftChanges: number; permissions: number }

export type TeamNow = {
  today: string
  leaves: WeekLeave[]                 // approved + pending, overlapping today … +6 days
  holidays: HolidayCalendar
  checkedIn: Map<string, Pick<AttendanceRecord, 'check_in_time' | 'status'>>   // today, by employee
  pending: PendingCounts
}

/**
 * Admin Team Stats: what's happening now, independent of the month being viewed —
 * who's in or out today, leave and holidays this week, and approvals waiting.
 * Pending counts use the same rules as the sidebar badges (AdminLayout).
 */
export function useTeamNow() {
  const [data, setData] = useState<TeamNow | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const today = localDate()
    const end = addDays(today, WEEK_DAYS - 1)
    const count = { count: 'exact', head: true } as const

    Promise.all([
      supabase.from('leave_requests')
        .select('id, employee_id, start_date, end_date, duration, half_day_session, leave_type, status')
        .in('status', ['approved', 'pending']).lte('start_date', end).gte('end_date', today).order('start_date'),
      loadHolidays(today, end),
      supabase.from('attendance_records').select('employee_id, check_in_time, status').eq('date', today).not('check_in_time', 'is', null),
      supabase.from('leave_requests').select('id', count).eq('status', 'pending'),
      supabase.from('leave_requests').select('id', count).eq('status', 'cancelled').is('cancel_seen_at', null),
      supabase.from('attendance_corrections').select('id', count).eq('status', 'pending'),
      supabase.from('shift_changes').select('id', count).eq('status', 'pending'),
      supabase.from('permission_requests').select('id', count).eq('status', 'pending'),
    ]).then(([lv, hol, att, leave, cancelledLeave, corr, shift, perm]) => {
      if (cancelled) return
      const err = (lv.error ?? att.error ?? leave.error)?.message ?? hol.error
      if (err) { setError(err); return }
      setData({
        today,
        leaves: (lv.data ?? []) as WeekLeave[],
        holidays: hol.holidays,
        checkedIn: new Map((att.data ?? []).map(r => [r.employee_id, r])),
        pending: {
          leave: leave.count ?? 0, cancelled: cancelledLeave.count ?? 0, corrections: corr.count ?? 0,
          shiftChanges: shift.count ?? 0, permissions: perm.count ?? 0,
        },
      })
    })
    return () => { cancelled = true }
  }, [])

  return { now: data, error }
}
