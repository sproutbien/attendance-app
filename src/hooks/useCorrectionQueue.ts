import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { AttendanceCorrection } from '../types'
import { LEAVE_CHANGED } from './useLeaveQueue'

export type CorrectionWithEmployee = AttendanceCorrection & {
  employee: { full_name: string; department: string | null }
}

/** Admin view of every correction request. */
export function useCorrectionQueue() {
  const { employee: admin } = useAuth()
  const [requests, setRequests] = useState<CorrectionWithEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('attendance_corrections')
      .select('*, employee:employees!employee_id(full_name, department)')
      .order('requested_at', { ascending: false })
    setRequests((data as CorrectionWithEmployee[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function run(id: string, op: () => PromiseLike<{ error: { message: string } | null }>): Promise<string | null> {
    setActioning(prev => new Set(prev).add(id))
    const { error } = await op()
    await refresh()
    setActioning(prev => { const s = new Set(prev); s.delete(id); return s })
    window.dispatchEvent(new Event(LEAVE_CHANGED))  // refresh the nav badges
    return error?.message ?? null
  }

  /** checkIn / checkOut: ISO or null to keep the recorded time. */
  const approve = (id: string, checkIn: string | null, checkOut: string | null, note: string) =>
    run(id, () => supabase.rpc('approve_attendance_correction', {
      p_id: id, p_check_in: checkIn, p_check_out: checkOut, p_note: note,
    }))

  const reject = (id: string, note: string) =>
    run(id, () => supabase
      .from('attendance_corrections')
      .update({ status: 'rejected', admin_note: note.trim() || null, reviewed_by: admin?.id, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending'))

  const pending = requests.filter(r => r.status === 'pending').reverse()  // oldest first
  const history = requests.filter(r => r.status !== 'pending')

  return { pending, history, loading, actioning, approve, reject }
}
