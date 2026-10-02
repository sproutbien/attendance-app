import { useEffect, useMemo, useState } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import { TRACKING_START, daysInMonth, localDate, shiftMonth } from '../lib/calendar'
import { TRACKED_STATUSES } from '../lib/employees'
import { computeMonthStats, teamTotals } from '../lib/stats'
import type { MonthStats, TeamTotals } from '../lib/stats'
import type { AttendanceRecord, Employee, EmployeeShift, LeaveRequest, Shift } from '../types'
import { TREND_MONTHS } from './useEmployeeStats'

export type TeamMember = Pick<Employee,
  'id' | 'full_name' | 'employee_code' | 'designation' | 'department' | 'role' | 'status' | 'photo_path' | 'joining_date' | 'last_working_day'>

export type MemberStats = { employee: TeamMember; month: MonthStats; previous: MonthStats | null }

type Raw = {
  employees: TeamMember[]
  records: AttendanceRecord[]
  holidays: Set<string>
  leaves: LeaveRequest[]
  shifts: Shift[]
  assignments: EmployeeShift[]
}

/** Admin: every current employee's stats for a month, plus team totals and a team trend. */
export function useTeamStats(yearMonth: string) {
  const [raw, setRaw] = useState<Raw | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    let cancelled = false
    const start = `${months[0]}-01`
    const end = `${yearMonth}-${String(daysInMonth(yearMonth)).padStart(2, '0')}`

    async function load() {
      setLoading(true)
      setError(null)
      const [emp, rec, hol, lv, sh, asg] = await Promise.all([
        // Current staff, plus anyone whose last working day falls in the period
        supabase.from('employees')
          .select('id, full_name, employee_code, designation, department, role, status, photo_path, joining_date, last_working_day')
          .is('deleted_at', null)
          .or(`status.in.(${TRACKED_STATUSES.join(',')}),last_working_day.gte.${start}`)
          .order('full_name'),
        fetchAll<AttendanceRecord>((from, to) =>
          supabase.from('attendance_records').select('*').gte('date', start).lte('date', end).order('id').range(from, to)),
        supabase.from('public_holidays').select('date').gte('date', start).lte('date', end),
        fetchAll<LeaveRequest>((from, to) =>
          supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', end).gte('end_date', start)
            .order('id').range(from, to)),
        supabase.from('shifts').select('*'),
        supabase.from('employee_shifts').select('employee_id, effective_from, shift_id').order('effective_from'),
      ])
      if (cancelled) return
      const err = emp.error ?? rec.error ?? hol.error ?? lv.error ?? sh.error ?? asg.error
      if (err) { setError(err.message); setLoading(false); return }
      setRaw({
        employees: emp.data ?? [],
        records: rec.data ?? [],
        holidays: new Set((hol.data ?? []).map(h => h.date)),
        leaves: lv.data ?? [],
        shifts: sh.data ?? [],
        assignments: asg.data ?? [],
      })
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [months, yearMonth])

  const result = useMemo(() => {
    if (!raw) return null
    const today = localDate()
    const byEmp = <T extends { employee_id: string }>(rows: T[]) => {
      const map = new Map<string, T[]>()
      for (const r of rows) {
        if (!map.has(r.employee_id)) map.set(r.employee_id, [])
        map.get(r.employee_id)!.push(r)
      }
      return map
    }
    const recs = byEmp(raw.records), leaves = byEmp(raw.leaves), asg = byEmp(raw.assignments)

    // Per person, per month (oldest first)
    const perPerson = raw.employees.map(e => {
      const input = {
        records: recs.get(e.id) ?? [], holidays: raw.holidays, leaves: leaves.get(e.id) ?? [],
        shifts: raw.shifts, assignments: asg.get(e.id) ?? [], activeFrom: e.joining_date, activeTo: e.last_working_day,
      }
      return { employee: e, trend: months.map(ym => computeMonthStats(ym, input, today)) }
    })

    const members: MemberStats[] = perPerson.map(p => ({
      employee: p.employee,
      month: p.trend[p.trend.length - 1],
      previous: p.trend.length > 1 ? p.trend[p.trend.length - 2] : null,
    }))

    /** Team totals per month; `include` picks who counts (e.g. leave admins out). */
    const trendFor = (include: (e: TeamMember) => boolean): { yearMonth: string; totals: TeamTotals }[] =>
      months.map((ym, i) => ({ yearMonth: ym, totals: teamTotals(perPerson.filter(p => include(p.employee)).map(p => p.trend[i])) }))

    return { members, trendFor }
  }, [raw, months])

  return { members: result?.members ?? null, trendFor: result?.trendFor ?? null, loading, error }
}
