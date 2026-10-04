import { useCallback, useEffect, useState } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import type { Employee } from '../types'
import { TRACKING_START, isSunday, monthDates } from '../lib/calendar'
import { TRACKED_STATUSES } from '../lib/employees'
import { loadHolidays } from '../lib/holidays'

export type EmployeeSummary = {
  employee: Pick<Employee, 'id' | 'full_name' | 'email' | 'department' | 'monthly_salary'>
  totalDays: number      // working days so far (Sundays and their holidays excluded)
  present: number
  late: number
  on_leave: number
  paid_leave: number     // part of on_leave covered by a paid leave balance
  lop: number            // on_leave days that are unpaid (Loss of Pay)
  absent: number
  paidUnits: number      // worked days + paid leave, before capping at working days
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

/** paidUnits: days worked plus paid leave (each day capped at 1). */
function computePayroll(paidUnits: number, salary: number | null, wd: number | null) {
  if (wd == null || salary == null) {
    return { paidDays: null, deductedDays: null, deduction: null, netPay: null }
  }
  const paidDays = Math.min(paidUnits, wd)
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

      const { start, end } = monthDateRange(yearMonth)

      const [
        { data: employees, error: empErr },
        { data: records, error: recErr },
        { data: settings, error: setErr },
      ] = await Promise.all([
        // Current staff, plus anyone whose last working day falls in or after this month (final pay)
        supabase
          .from('employees')
          .select('id, full_name, email, department, monthly_salary, status, last_working_day')
          .or(`status.in.(${TRACKED_STATUSES.join(',')}),last_working_day.gte.${start}`)
          .is('deleted_at', null)
          .order('full_name'),
        fetchAll((from, to) => supabase
          .from('attendance_records')
          .select('employee_id, status, half_day_session, paid_leave')
          .gte('date', start)
          .lte('date', end)
          .order('id')
          .range(from, to)),
        supabase
          .from('payroll_settings')
          .select('working_days')
          .eq('year_month', yearMonth)
          .maybeSingle(),
      ])
      const { holidays } = await loadHolidays(start, end)
      // Working days so far this month (from TRACKING_START): absent is counted against these, not calendar days.
      // Each person's own choice holidays (e.g. the Onam date they chose) come off their count below.
      const workingDates = monthDates(yearMonth).filter(d => d >= start && d >= TRACKING_START && d <= end && !isSunday(d) && !holidays.common.has(d))

      if (cancelled) return
      if (empErr || recErr || setErr) {
        setError((empErr ?? recErr ?? setErr)!.message)
        setLoading(false)
        return
      }

      const wd = settings?.working_days ?? null
      setWorkingDays(wd)

      type Tally = { present: number; late: number; on_leave: number; paid_leave: number; paid_units: number }
      const empty = (): Tally => ({ present: 0, late: 0, on_leave: 0, paid_leave: 0, paid_units: 0 })
      const tally = new Map<string, Tally>()
      for (const r of records ?? []) {
        if (!tally.has(r.employee_id)) tally.set(r.employee_id, empty())
        const t = tally.get(r.employee_id)!
        const paidLeave = Number(r.paid_leave ?? 0)
        const worked = r.status === 'present' || r.status === 'late' ? (r.half_day_session ? 0.5 : 1) : 0
        t.paid_leave += paidLeave
        t.paid_units += Math.min(1, worked + paidLeave)
        // Half-day leave: 0.5 leave + 0.5 of whatever they did with the other half
        // (present/late if they checked in; otherwise it falls through to absent)
        const w = r.half_day_session ? 0.5 : 1
        if (r.half_day_session)      t.on_leave += 0.5
        if (r.status === 'present')  t.present += w
        if (r.status === 'late')     t.late += w
        if (r.status === 'on_leave') t.on_leave += r.half_day_session ? 0 : 1
      }

      const result: EmployeeSummary[] = (employees ?? []).map(emp => {
        const t = tally.get(emp.id) ?? empty()
        const lwd = emp.last_working_day as string | null
        const own = holidays.personal.get(emp.id)
        const totalDays = workingDates.filter(d => (!lwd || d <= lwd) && !own?.has(d)).length
        const missing = Math.max(0, totalDays - t.present - t.late - t.on_leave)
        // Long leave: days without a record count as (unpaid) leave, not absent
        if (emp.status === 'on_long_leave') t.on_leave += missing
        const absent = emp.status === 'on_long_leave' ? 0 : missing
        const salary = (emp.monthly_salary as number | null) ?? null
        return {
          employee: { id: emp.id, full_name: emp.full_name, email: emp.email, department: emp.department, monthly_salary: salary },
          totalDays,
          present: t.present,
          late: t.late,
          on_leave: t.on_leave,
          paid_leave: t.paid_leave,
          lop: Math.max(0, t.on_leave - t.paid_leave),
          absent,
          paidUnits: t.paid_units,
          ...computePayroll(t.paid_units, salary, wd),
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
      ...computePayroll(s.paidUnits, s.employee.monthly_salary, days),
    })))
    return null
  }, [yearMonth])

  return { summaries, loading, error, workingDays, savingWorkingDays, saveWorkingDays }
}
