import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { LeaveDocument } from '../types'

/**
 * Documents on leave requests, grouped by leave id.
 * Employees get their own (RLS); admins get everyone's when no employee is given.
 */
export function useLeaveDocuments(employeeId?: string) {
  const [docs, setDocs] = useState<LeaveDocument[]>([])

  const reload = useCallback(async () => {
    let q = supabase.from('leave_documents').select('*').order('uploaded_at')
    if (employeeId) q = q.eq('employee_id', employeeId)
    const { data } = await q
    setDocs(data ?? [])
  }, [employeeId])

  useEffect(() => { reload() }, [reload])

  const byLeave = useMemo(() => {
    const m = new Map<string, LeaveDocument[]>()
    for (const d of docs) m.set(d.leave_id, [...(m.get(d.leave_id) ?? []), d])
    return m
  }, [docs])

  return { byLeave, reload }
}
