import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { LeaveRequest } from '../types'
import { useAuth } from '../contexts/AuthContext'

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
        id, employee_id, start_date, end_date, duration, half_day_session, reason, status,
        requested_at, reviewed_by, reviewed_at,
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
    await supabase
      .from('leave_requests')
      .update({ status, reviewed_by: admin.id, reviewed_at: new Date().toISOString() })
      .eq('id', id)
    // Optimistically update local state so the UI reflects the change immediately
    setRequests(prev =>
      prev.map(r => r.id === id
        ? { ...r, status, reviewed_by: admin.id, reviewed_at: new Date().toISOString() }
        : r
      )
    )
    setActioning(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  const pending  = requests.filter(r => r.status === 'pending')
  const reviewed = requests.filter(r => r.status !== 'pending')

  return { pending, reviewed, loading, actioning, approve: (id: string) => action(id, 'approved'), reject: (id: string) => action(id, 'rejected') }
}
