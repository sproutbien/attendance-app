import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/calendar'
import { LEAVE_CHANGED } from './useLeaveQueue'
import type { PermissionRequest, Shift, ShiftChange } from '../types'

// One-day shift changes and permissions (migration 042)

export type PermissionLimits = { permission_monthly_limit: number; permission_max_minutes: number }
const DEFAULT_LIMITS: PermissionLimits = { permission_monthly_limit: 2, permission_max_minutes: 120 }

type Who = { employee: { full_name: string; department: string | null } | null }
export type ShiftChangeRow = ShiftChange & Who
export type PermissionRow = PermissionRequest & Who

const since = () => localDate(new Date(Date.now() - 90 * 86_400_000))

async function loadLimits(): Promise<PermissionLimits> {
  const { data } = await supabase.from('attendance_settings').select('permission_monthly_limit, permission_max_minutes').maybeSingle()
  return (data as PermissionLimits | null) ?? DEFAULT_LIMITS
}

/** Employee: their own requests, the shifts to pick from, and the permission limits. */
export function useMyRequests(employeeId: string | undefined) {
  const [shiftChanges, setShiftChanges] = useState<ShiftChange[]>([])
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [limits, setLimits] = useState<PermissionLimits>(DEFAULT_LIMITS)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!employeeId) return
    const [c, p, s, l] = await Promise.all([
      supabase.from('shift_changes').select('*').eq('employee_id', employeeId).gte('date', since()).order('date', { ascending: false }),
      supabase.from('permission_requests').select('*').eq('employee_id', employeeId).gte('date', since()).order('date', { ascending: false }),
      supabase.from('shifts').select('*').order('start_time'),
      loadLimits(),
    ])
    setShiftChanges((c.data ?? []) as ShiftChange[])
    setPermissions((p.data ?? []) as PermissionRequest[])
    setShifts((s.data ?? []) as Shift[])
    setLimits(l)
    setLoading(false)
  }, [employeeId])

  useEffect(() => { refresh() }, [refresh])

  const run = async (op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op
    if (!error) await refresh()
    return error?.message ?? null
  }

  /** Pending + approved permissions in the month of `date` (they count towards the limit). */
  const usedInMonth = (date: string) =>
    permissions.filter(p => (p.status === 'pending' || p.status === 'approved') && p.date.slice(0, 7) === date.slice(0, 7)).length

  return {
    shiftChanges, permissions, shifts, limits, loading, refresh, usedInMonth,
    requestShiftChange: (date: string, shiftId: string, reason: string) =>
      run(supabase.rpc('request_shift_change', { p_date: date, p_shift: shiftId, p_reason: reason })),
    requestPermission: (date: string, start: string, end: string, reason: string) =>
      run(supabase.rpc('request_permission', { p_date: date, p_start: start, p_end: end, p_reason: reason })),
    cancel: (kind: 'shift' | 'permission', id: string) => run(supabase.rpc('cancel_my_request', { p_kind: kind, p_id: id })),
  }
}

/** Admin: everyone's shift changes and permissions (pending, plus the last 90 days), and the limits. */
export function useRequestQueue() {
  const [shiftChanges, setShiftChanges] = useState<ShiftChangeRow[]>([])
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [limits, setLimits] = useState<PermissionLimits>(DEFAULT_LIMITS)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    const who = '*, employee:employees!employee_id(full_name, department)'
    const [c, p, l] = await Promise.all([
      supabase.from('shift_changes').select(who).or(`status.eq.pending,date.gte.${since()}`).order('date', { ascending: false }),
      supabase.from('permission_requests').select(who).or(`status.eq.pending,date.gte.${since()}`).order('date', { ascending: false }),
      loadLimits(),
    ])
    setShiftChanges((c.data ?? []) as ShiftChangeRow[])
    setPermissions((p.data ?? []) as PermissionRow[])
    setLimits(l)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function run(key: string, op: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(prev => new Set(prev).add(key))
    const { error } = await op
    await refresh()
    setBusy(prev => { const s = new Set(prev); s.delete(key); return s })
    window.dispatchEvent(new Event(LEAVE_CHANGED))   // refresh the nav badges
    return error?.message ?? null
  }

  return {
    shiftChanges, permissions, limits, loading, busy, refresh,
    reviewShift: (id: string, approve: boolean, note: string) =>
      run(id, supabase.rpc('review_shift_change', { p_id: id, p_approve: approve, p_note: note })),
    reviewPermission: (id: string, approve: boolean, note: string) =>
      run(id, supabase.rpc('review_permission', { p_id: id, p_approve: approve, p_note: note })),
    /** Set a one-day shift change for someone directly (approved at once). */
    setShiftFor: (employeeId: string, date: string, shiftId: string, note: string) =>
      run('set', supabase.rpc('request_shift_change', { p_date: date, p_shift: shiftId, p_reason: note, p_employee: employeeId })),
    saveLimits: (l: PermissionLimits) =>
      run('limits', supabase.from('attendance_settings').update({ ...l, updated_at: new Date().toISOString() }).eq('id', true)),
  }
}
