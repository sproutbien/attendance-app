import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

export type EmployeeSummary = {
  employee: Pick<Employee, 'id' | 'full_name' | 'email' | 'department'>
  totalDays: number
  present: number
  late: number
  on_leave: number
  absent: number
}

function monthDateRange(yearMonth: string): { start: string; end: string; totalDays: number } {
  const [year, month] = yearMonth.split('-').map(Number)
  const start = `${yearMonth}-01`
  const now = new Date()
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
  const lastDay = isCurrentMonth ? now.getDate() : new Date(year, month, 0).getDate()
  const end = `${yearMonth}-${String(lastDay).padStart(2, '0')}`
  return { start, end, totalDays: lastDay }
}

export function useMonthlyReport(yearMonth: string) {
  const [summaries, setSummaries] = useState<EmployeeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetch() {
      setLoading(true)
      setError(null)

      const { start, end, totalDays } = monthDateRange(yearMonth)

      const [{ data: employees, error: empErr }, { data: records, error: recErr }] = await Promise.all([
        supabase
          .from('employees')
          .select('id, full_name, email, department')
          .eq('status', 'active')
          .order('full_name'),
        supabase
          .from('attendance_records')
          .select('employee_id, status')
          .gte('date', start)
          .lte('date', end),
      ])

      if (cancelled) return

      if (empErr || recErr) {
        setError((empErr ?? recErr)!.message)
        setLoading(false)
        return
      }

      // Tally per employee
      const tally = new Map<string, { present: number; late: number; on_leave: number }>()
      for (const r of records ?? []) {
        if (!tally.has(r.employee_id)) tally.set(r.employee_id, { present: 0, late: 0, on_leave: 0 })
        const t = tally.get(r.employee_id)!
        if (r.status === 'present')  t.present++
        if (r.status === 'late')     t.late++
        if (r.status === 'on_leave') t.on_leave++
      }

      const result: EmployeeSummary[] = (employees ?? []).map(emp => {
        const t = tally.get(emp.id) ?? { present: 0, late: 0, on_leave: 0 }
        const absent = totalDays - t.present - t.late - t.on_leave
        return { employee: emp, totalDays, present: t.present, late: t.late, on_leave: t.on_leave, absent }
      })

      setSummaries(result)
      setLoading(false)
    }

    fetch()
    return () => { cancelled = true }
  }, [yearMonth])

  return { summaries, loading, error }
}
