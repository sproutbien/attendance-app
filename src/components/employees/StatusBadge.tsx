import { EMPLOYEE_STATUS_COLORS, EMPLOYEE_STATUS_LABELS } from '../../lib/employees'
import type { EmployeeStatus } from '../../types'

export default function StatusBadge({ status }: { status: EmployeeStatus }) {
  const c = EMPLOYEE_STATUS_COLORS[status]
  return (
    <span style={{ padding: '2px 10px', borderRadius: 99, background: c.bg, color: c.text, fontWeight: 600, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
      {EMPLOYEE_STATUS_LABELS[status]}
    </span>
  )
}
