import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { LeaveRequest } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { localDate } from '../lib/calendar'
import { VOICE_NOTE_BUCKET, uploadVoiceNote } from '../lib/voiceNotes'
import type { VoiceNote } from '../lib/voiceNotes'
import { uploadLeaveDocuments } from '../lib/leaveDocs'

export type NewLeave = Pick<LeaveRequest, 'start_date' | 'end_date' | 'duration' | 'half_day_session' | 'leave_type' | 'reason' | 'split_with_lop'>

export function useLeaveRequests() {
  const { employee } = useAuth()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)   // saved, but something extra (a document) failed
  const [checkedInToday, setCheckedInToday] = useState(false)  // limits which leave can start today

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

  useEffect(() => {
    if (!employee) return
    supabase
      .from('attendance_records')
      .select('check_in_time')
      .eq('employee_id', employee.id)
      .eq('date', localDate())
      .maybeSingle()
      .then(({ data }) => setCheckedInToday(!!data?.check_in_time))
  }, [employee])

  async function submit(leave: NewLeave, voice: VoiceNote | null = null, documents: File[] = []): Promise<boolean> {
    if (!employee) return false
    setSubmitting(true)
    setError(null)
    setWarning(null)
    let voicePath: string | null = null
    if (voice) {
      try {
        voicePath = await uploadVoiceNote(employee.id, voice)
      } catch (e) {
        setError((e as Error).message)
        setSubmitting(false)
        return false
      }
    }
    const { data: saved, error } = await supabase
      .from('leave_requests')
      .insert({
        employee_id: employee.id,
        ...leave,
        voice_note_path: voicePath,
        voice_note_seconds: voice ? Math.round(voice.seconds) : null,
      })
      .select('id')
      .single()
    if (error) {
      // Don't leave an orphaned recording behind
      if (voicePath) await supabase.storage.from(VOICE_NOTE_BUCKET).remove([voicePath])
      setError(error.message)
      setSubmitting(false)
      return false
    }
    if (documents.length && saved) {
      const failed = await uploadLeaveDocuments(employee.id, saved.id, documents)
      if (failed.length) setWarning(`${failed.join(' ')} You can add documents from My Requests.`)
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

  /** Cancel today's part of a full-day leave ('today' only, or today 'onward'). Returns an error message or null. */
  async function cancelToday(id: string, mode: 'today' | 'onward'): Promise<string | null> {
    const { error } = await supabase.rpc('cancel_leave_today', { p_id: id, p_mode: mode })
    if (error) return error.message
    await fetchRequests()
    return null
  }

  return { requests, loading, submitting, error, warning, checkedInToday, submit, cancel, cancelToday }
}
