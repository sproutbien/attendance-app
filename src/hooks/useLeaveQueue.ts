import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { LeaveRequest } from '../types'
import { useAuth } from '../contexts/AuthContext'

/** Window event fired after the admin changes a leave request (refreshes the nav badge). */
export const LEAVE_CHANGED = 'sb:leave-changed'

export type LeaveRequestWithEmployee = LeaveRequest & {
  employee: { full_name: string; department: string | null }
}

export function useLeaveQueue() {
  const { employee: admin } = useAuth()
  const [requests, setRequests] = useState<LeaveRequestWithEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState<Set<string>>(new Set())

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('leave_requests')
      .select(`
        id, employee_id, start_date, end_date, duration, half_day_session, leave_type, days, paid_days, lop_days, reason, status,
        voice_note_path, voice_note_seconds,
        requested_at, reviewed_by, reviewed_at,
        cancelled_at, cancelled_after_approval, cancel_seen_at,
        employee:employees!employee_id(full_name, department)
      `)
      .order('requested_at', { ascending: true })
    setRequests((data as LeaveRequestWithEmployee[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  async function action(id: string, status: 'approved' | 'rejected') {
    if (!admin) return
    setActioning(prev => new Set(prev).add(id))
    // Only a still-pending request can be decided — the employee may have just cancelled it
    const { data } = await supabase
      .from('leave_requests')
      .update({ status, reviewed_by: admin.id, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, reviewed_at, days, paid_days, lop_days')
    if (!data?.length) {
      await fetchRequests()
      setActioning(prev => { const s = new Set(prev); s.delete(id); return s })
      return
    }
    // Update local state so the UI reflects the change immediately (incl. the server's paid / LOP split)
    const saved = data[0]
    setRequests(prev =>
      prev.map(r => r.id === id
        ? { ...r, ...saved, status, reviewed_by: admin.id }
        : r
      )
    )
    setActioning(prev => { const s = new Set(prev); s.delete(id); return s })
    window.dispatchEvent(new Event(LEAVE_CHANGED))
  }

  /** Dismiss in-app cancellation alerts (all of them when no ids are given). */
  async function markCancellationsSeen(ids: string[]) {
    if (ids.length === 0) return
    const seenAt = new Date().toISOString()
    const { error } = await supabase.from('leave_requests').update({ cancel_seen_at: seenAt }).in('id', ids)
    if (!error) setRequests(prev => prev.map(r => ids.includes(r.id) ? { ...r, cancel_seen_at: seenAt } : r))
    window.dispatchEvent(new Event(LEAVE_CHANGED))
  }

  const pending  = requests.filter(r => r.status === 'pending')
  // Everything decided or withdrawn, newest first
  const history  = requests.filter(r => r.status !== 'pending')
    .sort((a, b) => b.requested_at.localeCompare(a.requested_at))
  const newCancellations = requests.filter(r => r.status === 'cancelled' && !r.cancel_seen_at)
    .sort((a, b) => (b.cancelled_at ?? '').localeCompare(a.cancelled_at ?? ''))

  return {
    pending, history, newCancellations, loading, actioning,
    approve: (id: string) => action(id, 'approved'),
    reject: (id: string) => action(id, 'rejected'),
    markCancellationsSeen,
  }
}
