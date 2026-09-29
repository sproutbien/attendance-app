import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { LeaveRequest } from '../types'

export type NewLeave = Pick<LeaveRequest, 'start_date' | 'end_date' | 'duration' | 'half_day_session' | 'reason'>
import { useAuth } from '../contexts/AuthContext'

export function useLeaveRequests() {
  const { employee } = useAuth()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRequests = useCallback(async () => {
    if (!employee) return
    setLoading(true)
    const { data } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employee.id)
      .order('requested_at', { ascending: false })
    setRequests(data ?? [])
    setLoading(false)
  }, [employee])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  async function submit(leave: NewLeave): Promise<boolean> {
    if (!employee) return false
    setSubmitting(true)
    setError(null)
    const { error } = await supabase
      .from('leave_requests')
      .insert({ employee_id: employee.id, ...leave })
    if (error) {
      setError(error.message)
      setSubmitting(false)
      return false
    }
    await fetchRequests()
    setSubmitting(false)
    return true
  }

  /** Returns an error message, or null on success. */
  async function cancel(id: string): Promise<string | null> {
    const { error } = await supabase.rpc('cancel_leave_request', { p_id: id })
    if (error) return error.message
    await fetchRequests()
    return null
  }

  return { requests, loading, submitting, error, submit, cancel }
}
