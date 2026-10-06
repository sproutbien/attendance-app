import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { localDate } from '../lib/calendar'
import { FALLBACK_SHIFT } from '../lib/shifts'
import type { EmployeeShift, Shift, ShiftChange } from '../types'
import { shiftOnDate } from '../lib/stats'

/** The signed-in employee's shift on `date` (today by default), or another employee's (admins). */
export function useMyShift(date = localDate(), employeeId?: string) {
  const { employee } = useAuth()
  const id = employeeId ?? employee?.id
  const [shift, setShift] = useState<Shift | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    supabase.rpc('shift_for', { p_employee: id, p_date: date }).then(({ data }) => {
      if (!cancelled && data?.id) setShift(data as Shift)
    })
    return () => { cancelled = true }
  }, [id, date])

  return { shift: shift ?? FALLBACK_SHIFT, loaded: shift !== null }
}

/** An employee's shift on any date (from their dated assignments), for per-day rules like the minimum break. */
export function useShiftHistory(employeeId: string | undefined) {
  const [data, setData] = useState<{ shifts: Shift[]; assignments: EmployeeShift[]; changes: Pick<ShiftChange, 'date' | 'shift_id'>[] } | null>(null)

  useEffect(() => {
    if (!employeeId) return
    let cancelled = false
    Promise.all([
      supabase.from('shifts').select('*'),
      supabase.from('employee_shifts').select('employee_id, effective_from, shift_id').eq('employee_id', employeeId).order('effective_from'),
      supabase.from('shift_changes').select('date, shift_id').eq('employee_id', employeeId).eq('status', 'approved'),
    ]).then(([s, a, c]) => {
      if (!cancelled) setData({ shifts: s.data ?? [], assignments: a.data ?? [], changes: c.data ?? [] })
    })
    return () => { cancelled = true }
  }, [employeeId])

  return useCallback((date: string): Shift | null => data ? shiftOnDate(data, date) : null, [data])
}

export type ShiftInput = Omit<Shift, 'id' | 'is_default'>

/** Admin: every shift, who's on which, and editing. */
export function useShifts() {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [assignments, setAssignments] = useState<EmployeeShift[]>([])
  const [changes, setChanges] = useState<Pick<ShiftChange, 'employee_id' | 'date' | 'shift_id'>[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [s, a, c] = await Promise.all([
      supabase.from('shifts').select('*').order('start_time').order('name'),
      supabase.from('employee_shifts').select('employee_id, effective_from, shift_id').order('effective_from'),
      supabase.from('shift_changes').select('employee_id, date, shift_id').eq('status', 'approved').gte('date', localDate(new Date(Date.now() - 62 * 86_400_000))),
    ])
    setShifts(s.data ?? [])
    setAssignments(a.data ?? [])
    setChanges(c.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const defaultShift = shifts.find(s => s.is_default) ?? null

  /** Shift on a date: latest assignment on or before it, else the default. */
  function shiftOn(employeeId: string, date = localDate()): Shift | null {
    let id: string | null = null
    for (const a of assignments) {
      if (a.employee_id === employeeId && a.effective_from <= date) id = a.shift_id  // sorted by date
    }
    return (id && shifts.find(s => s.id === id)) || defaultShift
  }

  /** The shift actually worked on a date: an approved one-day change, else the usual shift. */
  function dayShift(employeeId: string, date = localDate()): Shift | null {
    const c = changes.find(x => x.employee_id === employeeId && x.date === date)
    return (c && shifts.find(s => s.id === c.shift_id)) || shiftOn(employeeId, date)
  }

  /** The next scheduled change after today, if any. */
  function upcomingFor(employeeId: string): { shift: Shift; from: string } | null {
    const today = localDate()
    const next = assignments.find(a => a.employee_id === employeeId && a.effective_from > today)
    const shift = next && shifts.find(s => s.id === next.shift_id)
    return next && shift ? { shift, from: next.effective_from } : null
  }

  /** Employees whose current or scheduled shift is this one. */
  function usage(shiftId: string, employeeIds: string[]) {
    const today = localDate()
    return employeeIds.filter(id => shiftOn(id, today)?.id === shiftId || upcomingFor(id)?.shift.id === shiftId).length
  }

  async function run(op: PromiseLike<{ error: { message: string; code?: string } | null }>): Promise<string | null> {
    const { error } = await op
    if (error) {
      if (error.code === '23505') return 'A shift with that name already exists.'
      if (error.code === '23503') return 'This shift has been used, so it can’t be deleted.'
      if (error.code === '23514') return 'Times must be in order: start ≤ late after ≤ half day after ≤ split < end.'
      return error.message
    }
    await load()
    return null
  }

  return {
    shifts, assignments, changes, loading, defaultShift, shiftOn, dayShift, upcomingFor, usage, reload: load,
    create:     (s: ShiftInput) => run(supabase.from('shifts').insert(s)),
    update:     (id: string, s: ShiftInput) => run(supabase.from('shifts').update(s).eq('id', id)),
    remove:     (id: string) => run(supabase.from('shifts').delete().eq('id', id)),
    setDefault: (id: string) => run(supabase.rpc('set_default_shift', { p_shift: id })),
    assign:     (employeeId: string, shiftId: string, from: string) =>
      run(supabase.rpc('set_employee_shift', { p_employee: employeeId, p_shift: shiftId, p_from: from })),
  }
}
