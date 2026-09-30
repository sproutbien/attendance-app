import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

export type EmployeeFormData = {
  full_name: string
  email: string
  password?: string
  role: 'employee' | 'admin'
  department: string
  designation: string
  monthly_salary: number | null
  phone: string | null
  joining_date: string | null
}

export function useEmployeeManagement() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchEmployees = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('employees')
      .select('*')
      .order('full_name')
    setEmployees(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchEmployees() }, [fetchEmployees])

  async function addEmployee(data: EmployeeFormData): Promise<boolean> {
    setSaving(true)
    setError(null)
    const { data: newId, error } = await supabase.rpc('create_employee', {
      p_email:      data.email.trim().toLowerCase(),
      p_password:   data.password!,
      p_full_name:  data.full_name.trim(),
      p_role:       data.role,
      p_department: data.department.trim() || null,
    })
    if (error) {
      setError(error.message)
      setSaving(false)
      return false
    }
    const designation = data.designation.trim() || null
    if (newId && (data.monthly_salary != null || data.phone != null || designation != null || data.joining_date != null)) {
      await supabase.from('employees').update({ monthly_salary: data.monthly_salary, phone: data.phone, designation, joining_date: data.joining_date }).eq('id', newId)
    }
    await fetchEmployees()
    setSaving(false)
    return true
  }

  async function updateEmployee(id: string, updates: Partial<Omit<Employee, 'id' | 'created_at'>>): Promise<boolean> {
    setSaving(true)
    setError(null)
    const { error } = await supabase
      .from('employees')
      .update(updates)
      .eq('id', id)
    if (error) {
      setError(error.message)
      setSaving(false)
      return false
    }
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e))
    setSaving(false)
    return true
  }

  async function toggleStatus(employee: Employee): Promise<void> {
    const next = employee.status === 'active' ? 'inactive' : 'active'
    await updateEmployee(employee.id, { status: next })
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
    employees, loading, saving, error, setError, addEmployee, updateEmployee, toggleStatus, refetch: fetchEmployees,
    binEmployee:     (id: string) => binAction('bin_employee', id),
    restoreEmployee: (id: string) => binAction('restore_employee', id),
    purgeEmployee:   (id: string) => binAction('purge_employee', id),
  }
}
