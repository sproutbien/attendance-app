import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AttendanceRecord } from '../types'
import { daysInMonth, localDate, monthDates, resolveMark } from '../lib/calendar'
import type { DayMark } from '../lib/calendar'

type MonthData = {
  holidays: Map<string, string>                                        // date → name
  attendance: Map<string, Map<string, AttendanceRecord['status']>>    // employee → date → status
  leave: Map<string, Map<string, 'approved' | 'pending'>>             // employee → date → status
}

const EMPTY: MonthData = { holidays: new Map(), attendance: new Map(), leave: new Map() }

/**
 * Holidays, attendance and leave for one month.
 * Pass employeeId to limit to one employee; omit it (admin) for everyone RLS allows.
 */
export function useMonthCalendar(yearMonth: string, employeeId?: string) {
  const [data, setData] = useState<MonthData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const start = `${yearMonth}-01`
      const end = `${yearMonth}-${String(daysInMonth(yearMonth)).padStart(2, '0')}`

      let attendanceQuery = supabase
        .from('attendance_records')
        .select('employee_id, date, status')
        .gte('date', start)
        .lte('date', end)
      let leaveQuery = supabase
        .from('leave_requests')
        .select('employee_id, start_date, end_date, status')
        .in('status', ['approved', 'pending'])
        .lte('start_date', end)
        .gte('end_date', start)
      if (employeeId) {
        attendanceQuery = attendanceQuery.eq('employee_id', employeeId)
        leaveQuery = leaveQuery.eq('employee_id', employeeId)
      }

      const [
        { data: holidays, error: holErr },
        { data: records, error: recErr },
        { data: leaves, error: leaveErr },
      ] = await Promise.all([
        supabase.from('public_holidays').select('date, name').gte('date', start).lte('date', end),
        attendanceQuery,
        leaveQuery,
      ])

      if (cancelled) return
      if (holErr || recErr || leaveErr) {
        setError((holErr ?? recErr ?? leaveErr)!.message)
        setLoading(false)
        return
      }

      const attendance: MonthData['attendance'] = new Map()
      for (const r of records ?? []) {
        if (!attendance.has(r.employee_id)) attendance.set(r.employee_id, new Map())
        attendance.get(r.employee_id)!.set(r.date, r.status)
      }

      const leave: MonthData['leave'] = new Map()
      const dates = monthDates(yearMonth)
      for (const l of leaves ?? []) {
        if (!leave.has(l.employee_id)) leave.set(l.employee_id, new Map())
        const byDate = leave.get(l.employee_id)!
        for (const d of dates) {
          if (d < l.start_date || d > l.end_date) continue
          // Approved wins if an approved and a pending request overlap
          if (byDate.get(d) !== 'approved') byDate.set(d, l.status as 'approved' | 'pending')
        }
      }

      setData({
        holidays: new Map((holidays ?? []).map(h => [h.date, h.name])),
        attendance,
        leave,
      })
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [yearMonth, employeeId])

  const markFor = useCallback((empId: string, date: string): DayMark => resolveMark(date, localDate(), {
    holiday: data.holidays.has(date),
    attendance: data.attendance.get(empId)?.get(date),
    leave: data.leave.get(empId)?.get(date),
  }), [data])

  return { holidays: data.holidays, leave: data.leave, markFor, loading, error }
}
