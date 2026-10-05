import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AttendanceRecord } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { totalBreakSeconds } from '../lib/breaks'
import { currentYearMonth, daysInMonth, localDate } from '../lib/calendar'

// Present / late / automatic morning half day is worked out by the server from
// the employee's shift when check_in_time is first set (migration 020).

// Local calendar date, so an early-morning check-in in IST isn't filed under yesterday (UTC)
const todayISO = () => localDate()

/** Today's record plus every record in `yearMonth` ("YYYY-MM", defaults to this month). */
export function useAttendance(yearMonth = currentYearMonth()) {
  const { employee } = useAuth()
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null | undefined>(undefined)
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const checkingIn = useRef(false)  // blocks a double-tap from inserting twice

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
    const { data } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('employee_id', employee.id)
      .gte('date', `${yearMonth}-01`)
      .lte('date', `${yearMonth}-${String(daysInMonth(yearMonth)).padStart(2, '0')}`)
      .order('date', { ascending: false })
    setMonthRecords(data ?? [])
  }, [employee, yearMonth])

  useEffect(() => {
    fetchToday()
    fetchMonth()
  }, [fetchToday, fetchMonth])

  /** `selfie`: the uploaded check-in selfie, or why there isn't one (migration 032). */
  async function checkIn(selfie?: { selfie_path: string } | { selfie_missing_reason: string }) {
    if (!employee || checkingIn.current) return { record: null, error: null }
    checkingIn.current = true
    setIsSubmitting(true)
    setError(null)
    const fields = { check_in_time: new Date().toISOString(), ...selfie }

    // A row for today may already exist (approved leave, admin entry, another tab),
    // so fill that row in instead of inserting a duplicate.
    const fillExisting = async () => {
      const { data: existing, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('employee_id', employee.id)
        .eq('date', todayISO())
        .maybeSingle()
      if (error || !existing) return { data: existing, error }
      if (existing.check_in_time) return { data: existing, error: null }
      return supabase
        .from('attendance_records')
        .update(fields)
        .eq('id', existing.id)
        .select()
        .single()
    }

    let result = await fillExisting()
    if (!result.error && !result.data) {
      result = await supabase
        .from('attendance_records')
        .insert({ employee_id: employee.id, date: todayISO(), ...fields })
        .select()
        .single()
      // Lost a race with another insert for today — use that row instead
      if (result.error?.code === '23505') result = await fillExisting()
    }

    if (result.error) setError(result.error.message)
    else {
      setTodayRecord(result.data)
      await fetchMonth()
    }
    checkingIn.current = false
    setIsSubmitting(false)
    return { record: (result.data ?? null) as AttendanceRecord | null, error: result.error?.message ?? null }
  }

  async function updateToday(changes: Partial<AttendanceRecord>) {
    if (!employee || !todayRecord) return
    setIsSubmitting(true)
    setError(null)
    const { data, error } = await supabase
      .from('attendance_records')
      .update(changes)
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

  // Folds a running break into break_seconds and clears break_started_at
  function endBreakChanges(now: Date): Partial<AttendanceRecord> {
    if (!todayRecord?.break_started_at) return {}
    return {
      break_started_at: null,
      break_seconds: totalBreakSeconds(todayRecord, now.getTime()),
    }
  }

  /** `at` back-dates the check-out, e.g. to the shift's split for an afternoon half day. */
  function checkOut(at = new Date()) {
    return updateToday({ ...endBreakChanges(at), check_out_time: at.toISOString() })
  }

  function pauseBreak() {
    if (todayRecord?.break_started_at) return Promise.resolve()
    return updateToday({ break_started_at: new Date().toISOString() })
  }

  function resumeBreak() {
    return updateToday(endBreakChanges(new Date()))
  }

  return { todayRecord, monthRecords, isSubmitting, error, checkIn, checkOut, pauseBreak, resumeBreak }
}
