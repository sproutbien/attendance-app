import { useEffect, useState } from 'react'
import { ArrowLeftRight, Timer } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/calendar'
import { shiftHours } from '../lib/shifts'
import { fmtMinutes, fmtPermissionTime, permissionMinutes } from '../lib/requests'
import type { PermissionRequest, Shift } from '../types'

/** Employee Dashboard: today's approved one-day shift change and/or permission (migration 042). */
export default function TodayRequestNote() {
  const { employee } = useAuth()
  const [changed, setChanged] = useState<Shift | null>(null)
  const [permission, setPermission] = useState<PermissionRequest | null>(null)

  useEffect(() => {
    if (!employee) return
    const today = localDate()
    Promise.all([
      supabase.from('shift_changes').select('shift:shifts!shift_id(*)').eq('employee_id', employee.id).eq('date', today).eq('status', 'approved').maybeSingle(),
      supabase.from('permission_requests').select('*').eq('employee_id', employee.id).eq('date', today).eq('status', 'approved').maybeSingle(),
    ]).then(([c, p]) => {
      setChanged(((c.data as { shift: Shift } | null)?.shift) ?? null)
      setPermission((p.data as PermissionRequest | null) ?? null)
    })
  }, [employee])

  if (!changed && !permission) return null
  return (
    <div className="sb-card" style={{ marginBottom: '1.25rem', gap: 8, border: '1px solid color-mix(in srgb, var(--blue, #1f5fbf) 35%, transparent)' }}>
      {changed && (
        <div style={row}>
          <ArrowLeftRight size={20} style={{ color: 'var(--blue, #1f5fbf)', flexShrink: 0 }} />
          <span><b>{changed.name} shift today</b> ({shiftHours(changed)}), changed for today. Late and half-day times follow this shift.</span>
        </div>
      )}
      {permission && (
        <div style={row}>
          <Timer size={20} style={{ color: 'var(--blue, #1f5fbf)', flexShrink: 0 }} />
          <span>
            <b>Permission {fmtPermissionTime(permission)}</b> (approved). Use <b>Break</b> while you’re away, and make up the{' '}
            {fmtMinutes(permissionMinutes(permission))} by checking out later today.
          </span>
        </div>
      )}
    </div>
  )
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: 'var(--text-strong, #10261a)', lineHeight: 1.5 }
