import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { daysInMonth } from '../lib/calendar'
import { TRACKED_STATUSES } from '../lib/employees'
import type { HolidayChoice, HolidayChoiceDate } from '../types'

export type ChoicePick = { choice_id: string; employee_id: string; date: string; picked_by: string | null }
export type ChoiceEmployee = { id: string; full_name: string; department: string | null }
export type ChoiceDraft = { name: string; pick_count: number; choose_by: string; dates: HolidayChoiceDate[] }

/** Admin: the choice holidays with dates in a month, everyone's picks, and the people they apply to. */
export function useHolidayChoices(yearMonth: string) {
  const [choices, setChoices] = useState<HolidayChoice[]>([])
  const [picks, setPicks] = useState<ChoicePick[]>([])
  const [employees, setEmployees] = useState<ChoiceEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const start = `${yearMonth}-01`
    const end = `${yearMonth}-${String(daysInMonth(yearMonth)).padStart(2, '0')}`
    // All of a choice's dates are in one month, so its dates in this month are all of them
    const { data: dates, error: dErr } = await supabase.from('holiday_choice_dates')
      .select('choice_id, date, is_default, max_people').gte('date', start).lte('date', end).order('date')
    const ids = [...new Set((dates ?? []).map(d => d.choice_id as string))]
    const [ch, pk, emp] = await Promise.all([
      ids.length ? supabase.from('holiday_choices').select('id, name, pick_count, choose_by').in('id', ids) : Promise.resolve({ data: [], error: null }),
      ids.length ? supabase.from('holiday_picks').select('choice_id, employee_id, date, picked_by').in('choice_id', ids) : Promise.resolve({ data: [], error: null }),
      supabase.from('employees').select('id, full_name, department')
        .in('status', TRACKED_STATUSES).is('deleted_at', null).order('full_name'),
    ])
    setError((dErr ?? ch.error ?? pk.error ?? emp.error)?.message ?? null)
    setChoices(((ch.data ?? []) as Omit<HolidayChoice, 'dates'>[])
      .map(c => ({
        ...c,
        dates: (dates ?? []).filter(d => d.choice_id === c.id)
          .map(d => ({ date: d.date, is_default: d.is_default, max_people: d.max_people })),
      }))
      .sort((a, b) => a.dates[0].date.localeCompare(b.dates[0].date)))
    setPicks((pk.data ?? []) as ChoicePick[])
    setEmployees((emp.data ?? []) as ChoiceEmployee[])
    setLoading(false)
  }, [yearMonth])

  useEffect(() => { setLoading(true); refresh() }, [refresh])

  /** Add (id null) or edit a choice holiday. Returns an error message or null. */
  async function save(id: string | null, d: ChoiceDraft) {
    const { error } = await supabase.rpc('save_holiday_choice', {
      p_id: id, p_name: d.name, p_pick_count: d.pick_count, p_choose_by: d.choose_by, p_dates: d.dates,
    })
    if (!error) await refresh()
    return error?.message ?? null
  }

  async function remove(id: string) {
    const { error } = await supabase.rpc('delete_holiday_choice', { p_id: id })
    if (!error) await refresh()
    return error?.message ?? null
  }

  /** Set someone's dates (empty = clear, so the defaults apply after the deadline). */
  async function setFor(choiceId: string, employeeId: string, dates: string[]) {
    const { error } = await supabase.rpc('set_holiday_picks', { p_choice: choiceId, p_dates: dates, p_employee: employeeId })
    if (!error) await refresh()
    return error?.message ?? null
  }

  return { choices, picks, employees, loading, error, save, remove, setFor }
}

export type LeaveOnDate = {
  employee_id: string
  full_name: string
  start_date: string
  end_date: string
  status: 'pending' | 'approved'
  leave_type: string
}

/** Admin: pending / approved leave covering any of these dates (it gets recounted if holidays change). */
export function useLeaveOnDates(dates: string[]) {
  const key = [...new Set(dates.filter(Boolean))].sort().join(',')
  const [leave, setLeave] = useState<LeaveOnDate[]>([])
  useEffect(() => {
    if (!key) { setLeave([]); return }
    let cancelled = false
    supabase.rpc('leave_on_dates', { p_dates: key.split(',') })
      .then(({ data }) => { if (!cancelled) setLeave((data ?? []) as LeaveOnDate[]) })
    return () => { cancelled = true }
  }, [key])
  return leave
}

export type MyHolidayChoice = HolidayChoice & {
  open: boolean            // can still choose (deadline not passed)
  chosen: boolean          // they've made their own choice
  my_dates: string[]       // their holiday date(s) right now
  dates: (HolidayChoiceDate & { taken: number })[]   // taken = others who chose that date
}

/** Employee: their choice holidays still to come. */
export function useMyHolidayChoices() {
  const [choices, setChoices] = useState<MyHolidayChoice[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc('my_holiday_choices')
    setChoices((data ?? []) as MyHolidayChoice[])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function choose(choiceId: string, dates: string[]) {
    const { error } = await supabase.rpc('set_holiday_picks', { p_choice: choiceId, p_dates: dates })
    if (!error) await refresh()
    return error?.message ?? null
  }

  return { choices, loading, refresh, choose }
}
