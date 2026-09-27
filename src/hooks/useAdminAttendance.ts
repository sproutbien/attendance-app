import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Employee, AttendanceRecord } from '../types'

export type AdminAttendanceRow = {
  employee: Pick<Employee, 'id' | 'full_name' | 'department'>
  record: AttendanceRecord | null
  effectiveStatus: AttendanceRecord['status']
}

export function useAdminAttendance(selectedDate: string) {
  const [rows, setRows] = useState<AdminAttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetch() {
      setLoading(true)
      setError(null)

      const [{ data: employees, error: empErr }, { data: records, error: recErr }] = await Promise.all([
        supabase
          .from('employees')
          .select('id, full_name, department')
          .eq('status', 'active')
          .order('full_name'),
        supabase
          .from('attendance_records')
          .select('*')
          .eq('date', selectedDate),
      ])

      if (cancelled) return

      if (empErr || recErr) {
        setError((empErr ?? recErr)!.message)
        setLoading(false)
        return
      }

      const recordMap = new Map((records ?? []).map(r => [r.employee_id, r]))

      const combined: AdminAttendanceRow[] = (employees ?? []).map(emp => {
        const record = recordMap.get(emp.id) ?? null
        return {
          employee: emp,
          record,
          effectiveStatus: record?.status ?? 'absent',
        }
      })

      setRows(combined)
      setLoading(false)
    }

    fetch()
    return () => { cancelled = true }
  }, [selectedDate])

  return { rows, loading, error }
}
