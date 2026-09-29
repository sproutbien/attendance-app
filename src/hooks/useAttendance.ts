import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AttendanceRecord, HalfDaySession } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { totalBreakSeconds } from '../lib/breaks'
import { currentYearMonth, daysInMonth, localDate } from '../lib/calendar'
import { halfDaySplit } from '../lib/halfDay'

// Work starts 9:30 AM with a 10-minute grace. Minutes since midnight, inclusive.
const ON_TIME_UNTIL = 9 * 60 + 40         // up to 9:40 AM → present
const HALF_DAY_AFTER = 11 * 60 + 30       // after 11:30 AM → morning counts as half-day leave

/**
 * Status for a check-in at `now`:
 *   ≤ 9:40 AM present · 9:41–11:30 AM late · after 11:30 AM morning half-day leave.
 * On a morning half day (approved or automatic) it's present until 1:30 PM, late after.
 */
function checkInFields(now: Date, rec: AttendanceRecord | null): {
  status: 'present' | 'late'
  half_day_session: HalfDaySession | null
} {
  const minutes = now.getHours() * 60 + now.getMinutes()
  const session = rec?.half_day_session ?? (minutes > HALF_DAY_AFTER ? 'morning' : null)
  if (session === 'morning') {
    const lateFrom = halfDaySplit(localDate(now)).getTime() + 60_000  // 1:30 PM itself is on time
    return { status: now.getTime() < lateFrom ? 'present' : 'late', half_day_session: 'morning' }
  }
  return { status: minutes <= ON_TIME_UNTIL ? 'present' : 'late', half_day_session: session }
}

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

  async function checkIn() {
    if (!employee || checkingIn.current) return
    checkingIn.current = true
    setIsSubmitting(true)
    setError(null)
    const now = new Date()
    const fields = (rec: AttendanceRecord | null) => ({
      check_in_time: now.toISOString(),
      ...checkInFields(now, rec),
    })

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
        .update(fields(existing))
        .eq('id', existing.id)
        .select()
        .single()
    }

    let result = await fillExisting()
    if (!result.error && !result.data) {
      result = await supabase
        .from('attendance_records')
        .insert({ employee_id: employee.id, date: todayISO(), ...fields(null) })
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

  /** `at` back-dates the check-out, e.g. to 1:30 PM for an afternoon half day. */
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
