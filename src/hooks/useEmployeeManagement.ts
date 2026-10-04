import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Employee, EmployeeOption, EmployeeOptionKind } from '../types'

/** Fields the admin edits on the Add / Edit form (blank strings already turned into null). */
export type EmployeeProfileFields = Pick<Employee,
  | 'full_name' | 'role' | 'status' | 'department' | 'designation' | 'monthly_salary' | 'phone'
  | 'joining_date' | 'employment_type' | 'work_location' | 'reporting_manager_id' | 'last_working_day'
  | 'emergency_contact_name' | 'emergency_contact_relation' | 'emergency_contact_phone' | 'probation_end_date'
> & { employee_code: string | null }   // null = assign the next SB number

export type EmployeeFormData = EmployeeProfileFields & {
  email: string
  password?: string   // add only
  shift: { id: string; from: string } | null   // null = shift unchanged
  startOnboarding?: boolean   // add only: copy the onboarding checklist to them
}

/** The employees-row part of the form (email and password only apply when adding). */
export function profileUpdates({ email: _email, password: _password, shift: _shift, startOnboarding: _start, ...rest }: EmployeeFormData): EmployeeProfileFields {
  return rest
}

export function useEmployeeManagement() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchEmployees = useCallback(async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('full_name')
    if (error) setError(error.message)
    setEmployees(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchEmployees() }, [fetchEmployees])

  /** Returns the new employee's id, or null on failure. */
  async function addEmployee({ email, password, shift: _shift, startOnboarding: _start, ...profile }: EmployeeFormData): Promise<string | null> {
    setSaving(true)
    setError(null)
    const { data: newId, error } = await supabase.rpc('create_employee', {
      p_email:      email.trim().toLowerCase(),
      p_password:   password!,
      p_full_name:  profile.full_name,
      p_role:       profile.role,
      p_department: profile.department,
    })
    if (error) {
      setError(error.message)
      setSaving(false)
      return null
    }
    // create_employee only takes the basics; the rest of the profile follows
    const { employee_code, ...rest } = profile
    const { error: updErr } = await supabase
      .from('employees')
      .update(employee_code ? { ...rest, employee_code } : rest)
      .eq('id', newId)
    await fetchEmployees()
    setSaving(false)
    if (updErr) {
      setError(`Employee created, but some details weren't saved: ${updErr.message}`)
      return null
    }
    return newId as string
  }

  async function updateEmployee(
    id: string,
    updates: Partial<Omit<Employee, 'id' | 'created_at' | 'employee_code'>> & { employee_code?: string | null },
  ): Promise<boolean> {
    setSaving(true)
    setError(null)
    // Blank employee ID → let the server assign the next number
    const { data, error } = await supabase
      .from('employees')
      .update(updates.employee_code === null ? { ...updates, employee_code: '' } : updates)
      .eq('id', id)
      .select()
      .single()
    setSaving(false)
    if (error) {
      setError(error.code === '23505' ? 'That employee ID is already in use.' : error.message)
      return false
    }
    setEmployees(prev => prev.map(e => e.id === id ? data : e))
    return true
  }

  /** Calls one of the bin RPCs, then refetches. Returns an error message or null. */
  async function binAction(fn: 'bin_employee' | 'restore_employee' | 'purge_employee', id: string): Promise<string | null> {
    setSaving(true)
    const { error } = await supabase.rpc(fn, { p_employee: id })
    if (!error) await fetchEmployees()
    setSaving(false)
    return error?.message ?? null
  }

  return {
    employees, loading, saving, error, setError, addEmployee, updateEmployee, refetch: fetchEmployees,
    binEmployee:     (id: string) => binAction('bin_employee', id),
    restoreEmployee: (id: string) => binAction('restore_employee', id),
    purgeEmployee:   (id: string) => binAction('purge_employee', id),
  }
}

/** Admin-managed dropdown lists: departments, work locations, employment types. */
export function useEmployeeOptions() {
  const [options, setOptions] = useState<EmployeeOption[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('employee_options').select('id, kind, name').order('name')
    setOptions(data ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  const byKind = (kind: EmployeeOptionKind) => options.filter(o => o.kind === kind)

  async function run(op: PromiseLike<{ error: { message: string; code?: string } | null }>): Promise<string | null> {
    const { error } = await op
    if (error) return error.code === '23505' ? 'That name is already in the list.' : error.message
    await load()
    return null
  }

  return {
    options, byKind, reload: load,
    add:    (kind: EmployeeOptionKind, name: string) => run(supabase.from('employee_options').insert({ kind, name: name.trim() })),
    rename: (id: string, name: string) => run(supabase.rpc('rename_employee_option', { p_id: id, p_name: name })),
    remove: (id: string) => run(supabase.from('employee_options').delete().eq('id', id)),
  }
}

/** Admin-only HR notes for one employee. */
export function useHrNotes(employeeId: string) {
  const [notes, setNotes] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('employee_hr_notes')
      .select('notes, updated_at')
      .eq('employee_id', employeeId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setNotes(data?.notes ?? '')
        setUpdatedAt(data?.updated_at ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [employeeId])

  async function save(text: string, adminId: string): Promise<string | null> {
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('employee_hr_notes')
      .upsert({ employee_id: employeeId, notes: text, updated_by: adminId, updated_at: now })
    if (error) return error.message
    setNotes(text)
    setUpdatedAt(now)
    return null
  }

  return { notes, updatedAt, loading, save }
}
