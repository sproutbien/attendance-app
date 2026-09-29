import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { LeaveBalance, LeaveType } from '../types'

/** Balances for one employee as of a date (default today). Pass null to skip. */
export function useLeaveBalances(employeeId: string | null | undefined, asOf?: string) {
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!employeeId) return
    const { data, error } = await supabase.rpc('leave_balances', { p_employee: employeeId, p_as_of: asOf ?? null })
    setBalances((data as LeaveBalance[] | null)?.map(b => ({
      ...b,
      // numeric columns arrive as strings
      yearly_quota: Number(b.yearly_quota), carried: Number(b.carried), accrued: Number(b.accrued),
      adjusted: Number(b.adjusted), used: Number(b.used), pending: Number(b.pending),
      available: b.available == null ? null : Number(b.available),
    })) ?? [])
    setError(error?.message ?? null)
    setLoading(false)
  }, [employeeId, asOf])

  useEffect(() => { refresh() }, [refresh])

  return { balances, loading, error, refresh }
}

/** All leave types, in display order. */
export function useLeaveTypes() {
  const [types, setTypes] = useState<LeaveType[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('leave_types').select('*').order('sort_order')
    setTypes((data ?? []).map(t => ({ ...t, yearly_quota: Number(t.yearly_quota), carry_forward_cap: Number(t.carry_forward_cap) })))
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  /** Admin: change a type's quota / carry-forward cap. Returns an error message or null. */
  async function update(code: string, changes: Pick<LeaveType, 'yearly_quota' | 'carry_forward_cap'>) {
    const { error } = await supabase.from('leave_types').update(changes).eq('code', code)
    if (!error) await refresh()
    return error?.message ?? null
  }

  return { types, loading, refresh, update }
}

/** Holiday dates between two dates (for working-day estimates). */
export function useHolidayDates(start: string, end: string) {
  const [dates, setDates] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!start || !end || end < start) return
    let cancelled = false
    supabase.from('public_holidays').select('date').gte('date', start).lte('date', end)
      .then(({ data }) => { if (!cancelled) setDates(new Set((data ?? []).map(h => h.date))) })
    return () => { cancelled = true }
  }, [start, end])
  return dates
}
