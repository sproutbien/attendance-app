import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { AttendanceCorrection } from '../types'

export type NewCorrection = Pick<AttendanceCorrection, 'date' | 'requested_check_in' | 'requested_check_out' | 'reason'>

/** The signed-in employee's correction requests, newest first. */
export function useCorrections() {
  const { employee } = useAuth()
  const [corrections, setCorrections] = useState<AttendanceCorrection[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!employee) return
    const { data } = await supabase
      .from('attendance_corrections')
      .select('*')
      .eq('employee_id', employee.id)
      .order('requested_at', { ascending: false })
      .limit(50)
    setCorrections(data ?? [])
    setLoading(false)
  }, [employee])

  useEffect(() => { refresh() }, [refresh])

  /** Returns an error message, or null on success. */
  async function submit(c: NewCorrection): Promise<string | null> {
    if (!employee) return 'Not signed in'
    const { error } = await supabase.from('attendance_corrections').insert({ employee_id: employee.id, ...c })
    if (error) {
      return error.code === '23505' ? 'You already have a pending correction for this day.' : error.message
    }
    await refresh()
    return null
  }

  async function withdraw(id: string): Promise<string | null> {
    const { error } = await supabase.from('attendance_corrections').delete().eq('id', id).eq('status', 'pending')
    if (error) return error.message
    await refresh()
    return null
  }

  const pendingDates = new Set(corrections.filter(c => c.status === 'pending').map(c => c.date))

  return { corrections, pendingDates, loading, submit, withdraw, refresh }
}
