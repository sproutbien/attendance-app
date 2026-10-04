import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { removeResumeFile, uploadResume } from '../lib/hiring'
import type { Candidate } from '../types'

export type CandidateFields = Pick<Candidate, 'full_name' | 'role' | 'email' | 'phone' | 'source' | 'notes'>

/** Admin: every candidate, newest first. */
export function useCandidates() {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from('candidates').select('*').order('created_at', { ascending: false })
    setCandidates((data ?? []) as Candidate[])
    setError(error?.message ?? null)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  /** Returns the new candidate, or an error message. */
  async function add(fields: CandidateFields, resume: File | null): Promise<Candidate | string> {
    const { data, error } = await supabase.from('candidates').insert(fields).select().single()
    if (error) return error.message
    let c = data as Candidate
    if (resume) {
      try {
        const cols = await uploadResume(c.id, resume)
        const upd = await supabase.from('candidates').update(cols).eq('id', c.id).select().single()
        if (upd.error) { await removeResumeFile(cols.resume_path); throw new Error(upd.error.message) }
        c = upd.data as Candidate
      } catch (e) {
        await refresh()
        return `Candidate added, but the résumé wasn't: ${(e as Error).message}`
      }
    }
    await refresh()
    return c
  }

  async function update(id: string, changes: Partial<Candidate>) {
    const { error } = await supabase.from('candidates').update(changes).eq('id', id)
    await refresh()
    return error?.message ?? null
  }

  /** Replaces (or adds) the résumé. */
  async function setResume(c: Candidate, file: File) {
    try {
      const cols = await uploadResume(c.id, file)
      const err = await update(c.id, cols)
      if (err) { await removeResumeFile(cols.resume_path); return err }
      if (c.resume_path) await removeResumeFile(c.resume_path)
      return null
    } catch (e) {
      return (e as Error).message
    }
  }

  async function remove(c: Candidate) {
    const { error } = await supabase.from('candidates').delete().eq('id', c.id)
    if (!error && c.resume_path) await removeResumeFile(c.resume_path)
    await refresh()
    return error?.message ?? null
  }

  return { candidates, loading, error, refresh, add, update, setResume, remove }
}
