import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadEmployeeDocument } from '../lib/onboarding'
import type { DocCategory, EmployeeDocument, OnboardingTask, OnboardingTemplateTask } from '../types'

/** One employee's checklist and documents (an employee sees their own; admins anyone's). */
export function useOnboarding(employeeId: string | undefined) {
  const [tasks, setTasks] = useState<OnboardingTask[]>([])
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!employeeId) return
    const [t, d] = await Promise.all([
      supabase.from('onboarding_tasks').select('*').eq('employee_id', employeeId).order('sort_order').order('created_at'),
      supabase.from('employee_documents').select('*').eq('employee_id', employeeId).order('uploaded_at'),
    ])
    setTasks((t.data ?? []) as OnboardingTask[])
    setDocs((d.data ?? []) as EmployeeDocument[])
    setLoading(false)
  }, [employeeId])

  useEffect(() => { refresh() }, [refresh])

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p
    await refresh()
    return error?.message ?? null
  }

  return {
    tasks, docs, loading, refresh,
    /** Admin: copy the checklist template to this employee (no-op if they have one). */
    start: () => run(supabase.rpc('start_onboarding', { p_employee: employeeId })),
    setDone: (taskId: string, done: boolean) => run(supabase.rpc('set_onboarding_task_done', { p_task: taskId, p_done: done })),
    /** Admin: an extra step just for this person. */
    addTask: (title: string, assignee: OnboardingTask['assignee']) => run(supabase.from('onboarding_tasks').insert({
      employee_id: employeeId, title, assignee, sort_order: (tasks[tasks.length - 1]?.sort_order ?? 0) + 1,
    })),
    removeTask: (taskId: string) => run(supabase.from('onboarding_tasks').delete().eq('id', taskId)),
    /** Uploads files under one category; returns error messages for any that failed. */
    upload: async (category: DocCategory, files: File[]) => {
      const errors: string[] = []
      for (const f of files) {
        try { await uploadEmployeeDocument(employeeId!, category, f) } catch (e) { errors.push((e as Error).message) }
      }
      await refresh()
      return errors
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

/** Admin: done / total per employee who has a checklist. */
export function useOnboardingOverview() {
  const [byEmployee, setByEmployee] = useState<Map<string, { done: number; total: number }>>(new Map())
  const refresh = useCallback(async () => {
    const { data } = await supabase.from('onboarding_tasks').select('employee_id, done_at')
    const m = new Map<string, { done: number; total: number }>()
    for (const t of data ?? []) {
      const p = m.get(t.employee_id) ?? { done: 0, total: 0 }
      p.total++
      if (t.done_at) p.done++
      m.set(t.employee_id, p)
    }
    setByEmployee(m)
  }, [])
  useEffect(() => { refresh() }, [refresh])
  return { byEmployee, refresh }
}
