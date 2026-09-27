import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { LeaveRequest } from '../types'
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

  async function submit(startDate: string, endDate: string, reason: string): Promise<boolean> {
    if (!employee) return false
    setSubmitting(true)
    setError(null)
    const { error } = await supabase
      .from('leave_requests')
      .insert({ employee_id: employee.id, start_date: startDate, end_date: endDate, reason })
    if (error) {
      setError(error.message)
      setSubmitting(false)
      return false
    }
    await fetchRequests()
    setSubmitting(false)
    return true
  }

  return { requests, loading, submitting, error, submit }
}
