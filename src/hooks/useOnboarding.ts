import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { removeDocumentFiles, removeOwnDocument, uploadEmployeeDocument } from '../lib/onboarding'
import type { DocCategory, EmployeeDocument, OnboardingReview, OnboardingTask, OnboardingTemplateTask } from '../types'

/** One employee's checklist and documents (an employee sees their own; admins anyone's). */
export function useOnboarding(employeeId: string | undefined) {
  const [tasks, setTasks] = useState<OnboardingTask[]>([])
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [review, setReview] = useState<OnboardingReview | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!employeeId) return
    const [t, d, r] = await Promise.all([
      supabase.from('onboarding_tasks').select('*').eq('employee_id', employeeId).order('sort_order').order('created_at'),
      supabase.from('employee_documents').select('*').eq('employee_id', employeeId).order('uploaded_at'),
      supabase.from('onboarding_reviews').select('*').eq('employee_id', employeeId).maybeSingle(),
    ])
    setTasks((t.data ?? []) as OnboardingTask[])
    setDocs((d.data ?? []) as EmployeeDocument[])
    setReview((r.data ?? null) as OnboardingReview | null)
    setLoading(false)
  }, [employeeId])

  useEffect(() => { refresh() }, [refresh])

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    await refresh()
    return error?.message ?? null
  }

  return {
    tasks, docs, review, loading, refresh,
    /** Admin: copy the checklist template to this employee (no-op if they have one). */
    start: () => run(supabase.rpc('start_onboarding', { p_employee: employeeId })),
    setDone: (taskId: string, done: boolean) => run(supabase.rpc('set_onboarding_task_done', { p_task: taskId, p_done: done })),
    /** Admin: an extra step just for this person. */
    addTask: (title: string, assignee: OnboardingTask['assignee']) => run(supabase.from('onboarding_tasks').insert({
      employee_id: employeeId, title, assignee, sort_order: (tasks[tasks.length - 1]?.sort_order ?? 0) + 1,
    })),
    removeTask: (taskId: string) => run(supabase.from('onboarding_tasks').delete().eq('id', taskId)),
    /** Uploads files under one category; returns error messages for any that failed.
     *  A successful upload replaces files HR asked to have re-sent (records go server-side, files here). */
    upload: async (category: DocCategory, files: File[]) => {
      const errors: string[] = []
      const flagged = docs.filter(d => d.category === category && d.resend_reason).map(d => d.path)
      for (const f of files) {
        try { await uploadEmployeeDocument(employeeId!, category, f) } catch (e) { errors.push((e as Error).message) }
      }
      if (flagged.length && errors.length < files.length) await removeDocumentFiles(flagged)
      await refresh()
      return errors
    },
    /** Admin: ask for a document again, saying what's wrong. */
    requestResend: (docId: string, reason: string) => run(supabase.rpc('request_document_resend', { p_document: docId, p_reason: reason })),
    withdrawResend: (docId: string) => run(supabase.rpc('withdraw_document_resend', { p_document: docId })),
    passVerification: () => run(supabase.rpc('pass_document_verification', { p_employee: employeeId })),
    undoVerification: () => run(supabase.rpc('undo_document_verification', { p_employee: employeeId })),
    /** Employee: Done on the "verified" notice. */
    dismissVerified: () => run(supabase.rpc('dismiss_verification_notice')),
    /** Employee: remove their own upload from the last 24 hours. */
    removeOwn: async (doc: EmployeeDocument) => {
      const error = await removeOwnDocument(doc)
      await refresh()
      return error
    },
  }
}

/** Admin: the checklist template new joiners get. */
export function useOnboardingTemplate() {
  const [items, setItems] = useState<OnboardingTemplateTask[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('onboarding_template')
      .select('id, title, details, assignee, document_category, sort_order').order('sort_order').order('created_at')
    setItems((data ?? []) as OnboardingTemplateTask[])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    if (!error) await refresh()
    return error?.message ?? null
  }

  return {
    items, loading,
    add: (item: Omit<OnboardingTemplateTask, 'id' | 'sort_order'>) =>
      run(supabase.from('onboarding_template').insert({ ...item, sort_order: (items[items.length - 1]?.sort_order ?? 0) + 1 })),
    update: (id: string, changes: Partial<Omit<OnboardingTemplateTask, 'id'>>) =>
      run(supabase.from('onboarding_template').update(changes).eq('id', id)),
    remove: (id: string) => run(supabase.from('onboarding_template').delete().eq('id', id)),
  }
}

export type OnboardingProgress = { done: number; total: number; review: 'todo' | 'ready' | 'resend' | 'verified' }

/** Admin: done / total per employee who has a checklist, and where their document review stands. */
export function useOnboardingOverview() {
  const [byEmployee, setByEmployee] = useState<Map<string, OnboardingProgress>>(new Map())
  const refresh = useCallback(async () => {
    const [t, r, d] = await Promise.all([
      supabase.from('onboarding_tasks').select('employee_id, assignee, done_at'),
      supabase.from('onboarding_reviews').select('employee_id'),
      supabase.from('employee_documents').select('employee_id').not('resend_reason', 'is', null),
    ])
    const verified = new Set((r.data ?? []).map(x => x.employee_id))
    const resend = new Set((d.data ?? []).map(x => x.employee_id))
    const m = new Map<string, OnboardingProgress & { mine: number; mineLeft: number }>()
    for (const row of t.data ?? []) {
      const p = m.get(row.employee_id) ?? { done: 0, total: 0, review: 'todo', mine: 0, mineLeft: 0 }
      p.total++
      if (row.assignee === 'employee') p.mine++
      if (row.done_at) p.done++
      else if (row.assignee === 'employee') p.mineLeft++
      m.set(row.employee_id, p)
    }
    for (const [id, p] of m) {
      p.review = resend.has(id) ? 'resend' : verified.has(id) ? 'verified' : p.mine && !p.mineLeft ? 'ready' : 'todo'
    }
    setByEmployee(m)
  }, [])
  useEffect(() => { refresh() }, [refresh])
  return { byEmployee, refresh }
}
