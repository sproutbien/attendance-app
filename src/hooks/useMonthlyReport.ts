import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

export type EmployeeSummary = {
  employee: Pick<Employee, 'id' | 'full_name' | 'email' | 'department' | 'monthly_salary'>
  totalDays: number
  present: number
  late: number
  on_leave: number
  absent: number
  paidDays: number | null
  deductedDays: number | null
  deduction: number | null
  netPay: number | null
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

function computePayroll(present: number, late: number, salary: number | null, wd: number | null) {
  if (wd == null || salary == null) {
    return { paidDays: null, deductedDays: null, deduction: null, netPay: null }
  }
  const paidDays = Math.min(present + late, wd)
  const deductedDays = wd - paidDays
  const dailyRate = salary / wd
  const deduction = dailyRate * deductedDays
  const netPay = salary - deduction
  return { paidDays, deductedDays, deduction, netPay }
}

export function useMonthlyReport(yearMonth: string) {
  const [summaries, setSummaries] = useState<EmployeeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workingDays, setWorkingDays] = useState<number | null>(null)
  const [savingWorkingDays, setSavingWorkingDays] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const { start, end, totalDays } = monthDateRange(yearMonth)

      const [
        { data: employees, error: empErr },
        { data: records, error: recErr },
        { data: settings, error: setErr },
      ] = await Promise.all([
        supabase
          .from('employees')
          .select('id, full_name, email, department, monthly_salary')
          .eq('status', 'active')
          .order('full_name'),
        supabase
          .from('attendance_records')
          .select('employee_id, status, half_day_session')
          .gte('date', start)
          .lte('date', end),
        supabase
          .from('payroll_settings')
          .select('working_days')
          .eq('year_month', yearMonth)
          .maybeSingle(),
      ])

      if (cancelled) return
      if (empErr || recErr || setErr) {
        setError((empErr ?? recErr ?? setErr)!.message)
        setLoading(false)
        return
      }

      const wd = settings?.working_days ?? null
      setWorkingDays(wd)

      const tally = new Map<string, { present: number; late: number; on_leave: number }>()
      for (const r of records ?? []) {
        if (!tally.has(r.employee_id)) tally.set(r.employee_id, { present: 0, late: 0, on_leave: 0 })
        const t = tally.get(r.employee_id)!
        // Half-day leave: 0.5 leave + 0.5 of whatever they did with the other half
        // (present/late if they checked in; otherwise it falls through to absent)
        const w = r.half_day_session ? 0.5 : 1
        if (r.half_day_session)      t.on_leave += 0.5
        if (r.status === 'present')  t.present += w
        if (r.status === 'late')     t.late += w
        if (r.status === 'on_leave') t.on_leave += r.half_day_session ? 0 : 1
      }

      const result: EmployeeSummary[] = (employees ?? []).map(emp => {
        const t = tally.get(emp.id) ?? { present: 0, late: 0, on_leave: 0 }
        const absent = totalDays - t.present - t.late - t.on_leave
        const salary = (emp.monthly_salary as number | null) ?? null
        return {
          employee: { id: emp.id, full_name: emp.full_name, email: emp.email, department: emp.department, monthly_salary: salary },
          totalDays,
          present: t.present,
          late: t.late,
          on_leave: t.on_leave,
          absent,
          ...computePayroll(t.present, t.late, salary, wd),
        }
      })

      setSummaries(result)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [yearMonth])

  const saveWorkingDays = useCallback(async (days: number): Promise<string | null> => {
    setSavingWorkingDays(true)
    const { error } = await supabase
      .from('payroll_settings')
      .upsert({ year_month: yearMonth, working_days: days, updated_at: new Date().toISOString() })
    setSavingWorkingDays(false)
    if (error) return error.message
    setWorkingDays(days)
    setSummaries(prev => prev.map(s => ({
      ...s,
      ...computePayroll(s.present, s.late, s.employee.monthly_salary, days),
    })))
    return null
  }, [yearMonth])

  return { summaries, loading, error, workingDays, savingWorkingDays, saveWorkingDays }
}
