import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TRACKING_START, daysInMonth, localDate, shiftMonth } from '../lib/calendar'
import { computeMonthStats } from '../lib/stats'
import type { MonthStats, StatsInput } from '../lib/stats'
import type { Employee } from '../types'
import { holidaysFor, loadHolidays } from '../lib/holidays'

/** How many months the trend covers, ending at the selected month. */
export const TREND_MONTHS = 6

/** One employee's statistics for the selected month plus a month-by-month trend (oldest first). */
export function useEmployeeStats(employee: Pick<Employee, 'id' | 'joining_date' | 'last_working_day'> | undefined, yearMonth: string) {
  const employeeId = employee?.id
  const activeFrom = employee?.joining_date ?? null
  const activeTo = employee?.last_working_day ?? null
  const [input, setInput] = useState<StatsInput | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Months shown in the trend: never before tracking started
  const months = useMemo(() => {
    const first = TRACKING_START.slice(0, 7)
    const list: string[] = []
    for (let i = TREND_MONTHS - 1; i >= 0; i--) {
      const ym = shiftMonth(yearMonth, -i)
      if (ym >= first) list.push(ym)
    }
    return list.length ? list : [yearMonth]
  }, [yearMonth])

  useEffect(() => {
    if (!employeeId) return
    let cancelled = false
    const start = `${months[0]}-01`
    const end = `${yearMonth}-${String(daysInMonth(yearMonth)).padStart(2, '0')}`

    async function load() {
      setLoading(true)
      setError(null)
      const [rec, hol, lv, sh, asg] = await Promise.all([
        supabase.from('attendance_records').select('*').eq('employee_id', employeeId).gte('date', start).lte('date', end),
        loadHolidays(start, end),
        supabase.from('leave_requests').select('*').eq('employee_id', employeeId).eq('status', 'approved')
          .lte('start_date', end).gte('end_date', start),
        supabase.from('shifts').select('*'),
        supabase.from('employee_shifts').select('employee_id, effective_from, shift_id').eq('employee_id', employeeId).order('effective_from'),
      ])
      if (cancelled) return
      const err = (rec.error ?? lv.error ?? sh.error ?? asg.error)?.message ?? hol.error
      if (err) { setError(err); setLoading(false); return }
      setInput({
        records: rec.data ?? [],
        holidays: new Set(holidaysFor(hol.holidays, employeeId).keys()),
        leaves: lv.data ?? [],
        shifts: sh.data ?? [],
        assignments: asg.data ?? [],
        activeFrom,
        activeTo,
      })
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [employeeId, activeFrom, activeTo, months, yearMonth])

  const stats = useMemo(() => {
    if (!input) return null
    const today = localDate()
    const trend: MonthStats[] = months.map(ym => computeMonthStats(ym, input, today))
    return { month: trend[trend.length - 1], previous: trend.length > 1 ? trend[trend.length - 2] : null, trend }
  }, [input, months])

  return { stats, loading, error }
}
