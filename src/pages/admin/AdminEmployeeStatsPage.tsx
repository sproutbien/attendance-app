import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import StatsView from '../../components/stats/StatsView'
import type { Employee } from '../../types'

/** Admin: the same statistics screen an employee sees, for any employee. */
export default function AdminEmployeeStatsPage() {
  const { id = '' } = useParams()
  const [employee, setEmployee] = useState<Employee | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    supabase.from('employees').select('*').eq('id', id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setEmployee(data ?? null) })
    return () => { cancelled = true }
  }, [id])

  return (
    // The stats screen's colours live on .sb-app; the admin area is always light
    <div className="sb-app st-admin" data-theme="light">
      <Link to={`/admin/employees/${id}`} className="st-btn st-no-print" style={{ textDecoration: 'none', marginBottom: 4 }}>
        <ArrowLeft size={15} /> Profile
      </Link>
      {employee === undefined ? (
        <div className="st-card" style={{ marginTop: 16 }}><p className="st-empty">Loading…</p></div>
      ) : employee === null ? (
        <div className="st-card" style={{ marginTop: 16 }}><p className="st-empty">Employee not found.</p></div>
      ) : (
        <StatsView employee={employee} title={`${employee.full_name} · Statistics`} />
      )}
    </div>
  )
}
