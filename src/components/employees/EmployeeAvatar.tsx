import { initials, photoUrl } from '../../lib/employees'
import type { Employee } from '../../types'

/** Round profile photo, falling back to initials. */
export default function EmployeeAvatar({ employee, size = 36, dim = false }: {
  employee: Pick<Employee, 'full_name' | 'photo_path'>
  size?: number
  dim?: boolean     // greyed out, for staff who no longer work here
}) {
  const url = photoUrl(employee)
  const base = { width: size, height: size, borderRadius: '50%', flexShrink: 0 } as const
  if (url) {
    return <img src={url} alt="" style={{ ...base, objectFit: 'cover', display: 'block', opacity: dim ? 0.6 : 1 }} />
  }
  return (
    <div style={{
      ...base,
      background: dim ? '#f1f5f9' : 'var(--brand-100)',
      color: dim ? '#94a3b8' : 'var(--brand-800)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.36,
    }}>
      {initials(employee.full_name)}
    </div>
  )
}
