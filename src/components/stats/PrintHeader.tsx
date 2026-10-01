import EmployeeAvatar from '../employees/EmployeeAvatar'
import { EMPLOYEE_STATUS_LABELS, fmtDate } from '../../lib/employees'
import { localDate, monthLabel } from '../../lib/calendar'
import { fmtHM } from '../../lib/breaks'
import { fmtDays, fmtPct } from '../../lib/stats'
import type { MonthStats } from '../../lib/stats'
import { shiftHours } from '../../lib/shifts'
import type { Employee, Shift } from '../../types'

// Printed / PDF report only (hidden on screen): letterhead, the employee's
// details in large type, and the month's key numbers.

export function PrintHeader({ employee: e, shift, yearMonth, m }: {
  employee: Employee
  shift: Shift
  yearMonth: string
  m: MonthStats | undefined
}) {
  const today = localDate()
  const inProgress = yearMonth === today.slice(0, 7)
  const period = inProgress
    ? `1 – ${fmtDate(today)} · month in progress`
    : `${fmtDate(`${yearMonth}-01`)} – ${fmtDate(lastDay(yearMonth))}`

  const details: [string, string | null][] = [
    ['Department', e.department],
    ['Employment type', e.employment_type],
    ['Work location', e.work_location],
    ['Shift', `${shift.name} · ${shiftHours(shift)}`],
    ['Date of joining', e.joining_date ? fmtDate(e.joining_date) : null],
    ['Status', EMPLOYEE_STATUS_LABELS[e.status] + (e.last_working_day ? ` · last day ${fmtDate(e.last_working_day)}` : '')],
  ]

  const highlights: [string, string, string?][] = m ? [
    ['Attendance', fmtPct(m.attendanceRate), `${fmtDays(m.present)} of ${fmtDays(m.workingDays - m.leave)} days`],
    ['Total hours', fmtHM(m.worked), `avg. ${fmtHM(m.avgWorked)} / day`],
    ['On time', fmtPct(m.onTimeRate), `${fmtDays(m.late)} day${m.late === 1 ? '' : 's'} late`],
    ['Leave', `${fmtDays(m.leave)} day${m.leave === 1 ? '' : 's'}`, m.leaveByType.lop ? `${fmtDays(m.leaveByType.lop)} loss of pay` : 'all paid'],
    ['Absent', `${fmtDays(m.absent)} day${m.absent === 1 ? '' : 's'}`],
  ] : []

  return (
    <div className="st-print-only pr-head">
      <div className="pr-letterhead">
        <img src="/logo.jpg" alt="" />
        <div>
          <div className="pr-title">Monthly Attendance Report</div>
          <div className="pr-company">Sproutbien</div>
        </div>
        <div className="pr-period">
          <b>{monthLabel(yearMonth)}</b>
          <span>{period}</span>
        </div>
      </div>

      <div className="pr-person">
        <EmployeeAvatar employee={e} size={64} />
        <div className="pr-who">
          <div className="pr-name">{e.full_name}</div>
          <div className="pr-role">
            <span className="pr-id">{e.employee_code}</span>
            {e.designation && <span>{e.designation}</span>}
          </div>
        </div>
      </div>

      <dl className="pr-details">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || '—'}</dd>
          </div>
        ))}
      </dl>

      {highlights.length > 0 && (
        <div className="pr-highlights">
          {highlights.map(([label, value, sub]) => (
            <div key={label}>
              <span>{label}</span>
              <b>{value}</b>
              {sub && <small>{sub}</small>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Sign-off lines and the generated-on note, at the end of the printed report. */
export function PrintFooter() {
  return (
    <div className="st-print-only pr-foot">
      <div className="pr-signs">
        <div><span />Employee signature</div>
        <div><span />Reporting manager / HR</div>
      </div>
      <p>
        System-generated report · {new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
        {' · '}Hours exclude breaks. Attendance % = days present ÷ working days, approved leave excluded.
      </p>
    </div>
  )
}

function lastDay(yearMonth: string) {
  const [y, mo] = yearMonth.split('-').map(Number)
  return `${yearMonth}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`
}
