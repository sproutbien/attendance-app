import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AttendanceRecord } from '../types'
import { useAuth } from '../contexts/AuthContext'

const LATE_THRESHOLD_HOUR = 9

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function useAttendance() {
  const { employee } = useAuth()
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null | undefined>(undefined)
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchToday = useCallback(async () => {
    if (!employee) return
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('date', todayISO())
      .maybeSingle()
    setTodayRecord(data ?? null)
  }, [employee])

  const fetchMonth = useCallback(async () => {
    if (!employee) return
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('employee_id', employee.id)
      .gte('date', monthStart)
      .lte('date', todayISO())
      .order('date', { ascending: false })
    setMonthRecords(data ?? [])
  }, [employee])

  useEffect(() => {
    fetchToday()
    fetchMonth()
  }, [fetchToday, fetchMonth])

  async function checkIn() {
    if (!employee) return
    setIsSubmitting(true)
    setError(null)
    const now = new Date()
    const status = now.getHours() < LATE_THRESHOLD_HOUR ? 'present' : 'late'
    const { data, error } = await supabase
      .from('attendance_records')
      .insert({
        employee_id: employee.id,
        date: todayISO(),
        check_in_time: now.toISOString(),
        status,
      })
      .select()
      .single()
    if (error) setError(error.message)
    else {
      setTodayRecord(data)
      await fetchMonth()
    }
    setIsSubmitting(false)
  }

  async function checkOut() {
    if (!employee || !todayRecord) return
    setIsSubmitting(true)
    setError(null)
    const { data, error } = await supabase
      .from('attendance_records')
      .update({ check_out_time: new Date().toISOString() })
      .eq('id', todayRecord.id)
      .select()
      .single()
    if (error) setError(error.message)
    else {
      setTodayRecord(data)
      await fetchMonth()
    }
    setIsSubmitting(false)
  }

  return { todayRecord, monthRecords, isSubmitting, error, checkIn, checkOut }
}
