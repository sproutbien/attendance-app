import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useMonthlyReport } from '../../hooks/useMonthlyReport'
import type { EmployeeSummary } from '../../hooks/useMonthlyReport'
import { useMonthCalendar } from '../../hooks/useMonthCalendar'
import { useHolidayChoices } from '../../hooks/useHolidayChoices'
import AttendanceCalendarGrid from '../../components/AttendanceCalendarGrid'
import { CalendarLegend } from '../../components/MonthCalendar'
import { suggestedWorkingDays } from '../../lib/calendar'
import { useBranding } from '../../contexts/BrandingContext'

// ── Helpers ───────────────────────────────────────────────────

function monthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
}

function csvEscape(val: string | number) {
  const s = String(val)
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

function fmt(n: number) {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function exportCSV(summaries: EmployeeSummary[], yearMonth: string, workingDays: number | null, companyName: string) {
  const label = monthLabel(yearMonth)
  const hasPayroll = workingDays != null && summaries.some(s => s.employee.monthly_salary != null)

  const headers = [
    'Employee', 'Email', 'Department', 'Working Days',
    'Present', 'Late', 'Absent', 'On Leave', 'Paid Leave', 'LOP (unpaid leave + absent)',
    ...(hasPayroll ? ['Paid Days', 'Gross Salary', 'Deduction', 'Net Pay'] : []),
  ]

  const dataRows = summaries.map(s => [
    s.employee.full_name,
    s.employee.email,
    s.employee.department ?? '',
    s.totalDays,
    s.present,
    s.late,
    s.absent,
    s.on_leave,
    s.paid_leave,
    s.lop,
    ...(hasPayroll ? [
      s.paidDays ?? '',
      s.employee.monthly_salary ?? '',
      s.deduction != null ? s.deduction.toFixed(2) : '',
      s.netPay != null ? s.netPay.toFixed(2) : '',
    ] : []),
  ])

  const attTotals = summaries.reduce(
    (acc, s) => ({ present: acc.present + s.present, late: acc.late + s.late, absent: acc.absent + s.absent, on_leave: acc.on_leave + s.on_leave }),
    { present: 0, late: 0, absent: 0, on_leave: 0 }
  )

  const payTotals = hasPayroll ? summaries.reduce(
    (acc, s) => ({
      gross: acc.gross + (s.employee.monthly_salary ?? 0),
      ded: acc.ded + (s.deduction ?? 0),
      net: acc.net + (s.netPay ?? 0),
    }),
    { gross: 0, ded: 0, net: 0 }
  ) : null

  const lines = [
    [`${companyName} Attendance Report — ${label}` + (workingDays != null ? ` (${workingDays} working days)` : '')].map(csvEscape).join(','),
    '',
    headers.map(csvEscape).join(','),
    ...dataRows.map(row => row.map(csvEscape).join(',')),
    '',
    [
      'TOTAL', '', '', '',
      attTotals.present, attTotals.late, attTotals.absent, attTotals.on_leave,
      ...(payTotals ? [payTotals.gross.toFixed(2), payTotals.ded.toFixed(2), payTotals.net.toFixed(2)] : []),
    ].map(csvEscape).join(','),
  ]

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `attendance-${yearMonth}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Page ─────────────────────────────────────────────────────

export default function AdminReportsPage() {
  const { branding } = useBranding()
  const currentMonth = new Date().toISOString().slice(0, 7)
  const [yearMonth, setYearMonth] = useState(currentMonth)
  const { summaries, loading, error, workingDays, savingWorkingDays, saveWorkingDays } = useMonthlyReport(yearMonth)
  const calendar = useMonthCalendar(yearMonth)
  const choices = useHolidayChoices(yearMonth)

  const totals = summaries.reduce(
    (acc, s) => ({ present: acc.present + s.present, late: acc.late + s.late, absent: acc.absent + s.absent, on_leave: acc.on_leave + s.on_leave }),
    { present: 0, late: 0, absent: 0, on_leave: 0 }
  )

  const hasPayroll = workingDays != null && !loading && summaries.some(s => s.employee.monthly_salary != null)

  const payTotals = hasPayroll ? summaries.reduce(
    (acc, s) => ({
      gross: acc.gross + (s.employee.monthly_salary ?? 0),
      deduction: acc.deduction + (s.deduction ?? 0),
      netPay: acc.netPay + (s.netPay ?? 0),
    }),
    { gross: 0, deduction: 0, netPay: 0 }
  ) : null

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>Reports</h1>
          <input
            type="month"
            value={yearMonth}
            max={currentMonth}
            onChange={e => setYearMonth(e.target.value)}
            style={{
              padding: '0.4rem 0.625rem',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              fontSize: '0.875rem',
              color: '#1e293b',
              outline: 'none',
            }}
          />
        </div>
        <button
          onClick={() => exportCSV(summaries, yearMonth, workingDays, branding.company_name)}
          disabled={loading || summaries.length === 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1.125rem',
            background: loading || summaries.length === 0 ? '#f1f5f9' : 'var(--brand-600)',
            color: loading || summaries.length === 0 ? '#94a3b8' : '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: loading || summaries.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          ↓ Export CSV
        </button>
      </div>

      <p style={{ margin: '0 0 1.25rem', color: '#64748b', fontSize: '0.875rem' }}>
        {monthLabel(yearMonth)} · {loading ? '…' : `${summaries.length} active employee${summaries.length !== 1 ? 's' : ''}`}
      </p>

      {/* Monthly attendance calendar */}
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>Attendance calendar</h2>
          <CalendarLegend marks={['leave', 'half_leave', 'leave_pending', 'holiday', 'choice_holiday', 'present', 'late', 'absent', 'sunday']} />
        </div>
        {error || calendar.error ? (
          <div style={{ padding: '1rem 0', color: '#ef4444' }}>{error ?? calendar.error}</div>
        ) : loading || calendar.loading ? (
          <div style={{ padding: '1rem 0', color: '#94a3b8' }}>Loading…</div>
        ) : summaries.length === 0 ? (
          <div style={{ padding: '1rem 0', color: '#94a3b8' }}>No active employees found.</div>
        ) : (
          <AttendanceCalendarGrid
            yearMonth={yearMonth}
            employees={summaries.map(s => s.employee)}
            holidays={calendar.holidays}
            holidayFor={calendar.holidayFor}
            markFor={(empId, date) => {
              const joined = summaries.find(s => s.employee.id === empId)?.employee.joining_date
              return joined && date < joined ? 'none' : calendar.markFor(empId, date)
            }}
          />
        )}
      </div>

      {/* Working days editor */}
      {!loading && !calendar.loading && !choices.loading && (
        <WorkingDaysEditor
          workingDays={workingDays}
          suggested={suggestedWorkingDays(yearMonth, calendar.holidays.keys(), choices.choices.reduce((n, c) => n + c.pick_count, 0))}
          saving={savingWorkingDays}
          onSave={saveWorkingDays}
        />
      )}

      {/* Summary pills */}
      {!loading && summaries.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {([
            { label: 'Total Present',  value: totals.present,  bg: '#dcfce7', text: '#166534' },
            { label: 'Total Late',     value: totals.late,     bg: '#fef9c3', text: '#854d0e' },
            { label: 'Total Absent',   value: totals.absent,   bg: '#fee2e2', text: '#991b1b' },
            { label: 'Total On Leave', value: totals.on_leave, bg: '#ede9fe', text: '#5b21b6' },
          ] as const).map(({ label, value, bg, text }) => (
            <div key={label} style={{ background: bg, borderRadius: 12, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: text, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: text, opacity: 0.75, marginTop: '0.25rem' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflowX: 'auto' }}>
        {error ? (
          <div style={{ padding: '2rem', color: '#ef4444' }}>{error}</div>
        ) : loading ? (
          <div style={{ padding: '2rem', color: '#94a3b8' }}>Loading…</div>
        ) : summaries.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>No active employees found.</div>
        ) : (
          <table className="rt" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={thStyle}>Employee</th>
                <th style={thStyle}>Department</th>
                <th style={{ ...thStyle, textAlign: 'center' }} title="Working days so far (Sundays and holidays excluded)">Work Days</th>
                <th style={{ ...thStyle, textAlign: 'center', color: '#166534' }}>Present</th>
                <th style={{ ...thStyle, textAlign: 'center', color: '#854d0e' }}>Late</th>
                <th style={{ ...thStyle, textAlign: 'center', color: '#991b1b' }}>Absent</th>
                <th style={{ ...thStyle, textAlign: 'center', color: '#5b21b6' }}>On Leave</th>
                {hasPayroll && <>
                  <th style={{ ...thStyle, textAlign: 'center', color: '#166534' }} title="Days worked plus paid leave">Paid Days</th>
                  <th style={{ ...thStyle, textAlign: 'right', color: '#0369a1' }}>Gross</th>
                  <th style={{ ...thStyle, textAlign: 'right', color: '#b91c1c' }}>Deduction</th>
                  <th style={{ ...thStyle, textAlign: 'right', color: '#166534' }}>Net Pay</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {summaries.map(s => <SummaryRow key={s.employee.id} summary={s} showPayroll={hasPayroll} />)}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#1e293b' }} colSpan={2}>Total</td>
                <td style={{ ...tdStyle, textAlign: 'center', color: '#64748b' }}>—</td>
                <TotalCell value={totals.present}  color="#166534" bg="#dcfce7" />
                <TotalCell value={totals.late}     color="#854d0e" bg="#fef9c3" />
                <TotalCell value={totals.absent}   color="#991b1b" bg="#fee2e2" />
                <TotalCell value={totals.on_leave} color="#5b21b6" bg="#ede9fe" />
                {hasPayroll && payTotals && <>
                  <td style={{ ...tdStyle, textAlign: 'center', color: '#64748b' }}>—</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#0369a1' }}>{fmt(payTotals.gross)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#b91c1c' }}>{fmt(payTotals.deduction)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#166534' }}>{fmt(payTotals.netPay)}</td>
                </>}
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {!loading && summaries.length > 0 && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#94a3b8' }}>
          "Work Days" = working days (Sundays and public holidays excluded) from the 1st to today, or the full month for past months.
          Paid Days = days worked + paid leave. Deduction = (Working Days − Paid Days) × Daily Rate, so absences and Loss of Pay are unpaid.
          Absent days (no check-in, no approved leave) count as Loss of Pay; employees can still apply leave for the last 7 days.
        </p>
      )}
    </div>
  )
}

// ── Working days inline editor ────────────────────────────────

function WorkingDaysEditor({ workingDays, suggested, saving, onSave }: {
  workingDays: number | null
  suggested: number                 // days in month − Sundays − holidays
  saving: boolean
  onSave: (days: number) => Promise<string | null>
}) {
  // Unsaved months are pre-filled with the suggestion; a saved value is never overridden
  const initial = String(workingDays ?? suggested)
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setValue(initial)
  }, [initial])

  async function handleSave() {
    const n = parseInt(value, 10)
    if (isNaN(n) || n < 1 || n > 31) { setErr('Enter 1–31'); return }
    setErr(null)
    const error = await onSave(n)
    if (error) { setErr(error) } else { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  const unchanged = value === (workingDays != null ? String(workingDays) : '')

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
      background: '#fff', borderRadius: 12, padding: '0.875rem 1.125rem',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '1.25rem',
    }}>
      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e293b' }}>Working days this month</span>
      <input
        type="number"
        value={value}
        onChange={e => { setValue(e.target.value); setSaved(false) }}
        min={1}
        max={31}
        placeholder="e.g. 22"
        style={{
          width: 72,
          padding: '0.375rem 0.5rem',
          border: `1px solid ${err ? '#fca5a5' : '#d1d5db'}`,
          borderRadius: 8,
          fontSize: '0.9375rem',
          outline: 'none',
          textAlign: 'center',
          color: '#1e293b',
          fontFamily: 'inherit',
        }}
      />
      <button
        onClick={handleSave}
        disabled={saving || unchanged || value === ''}
        style={{
          padding: '0.375rem 0.875rem',
          background: saved ? '#16a34a' : '#1d4ed8',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: '0.8125rem',
          cursor: (saving || unchanged || value === '') ? 'not-allowed' : 'pointer',
          opacity: (saving || unchanged || value === '') ? 0.45 : 1,
          whiteSpace: 'nowrap',
          transition: 'background 0.2s',
        }}
      >
        {saved ? 'Saved!' : saving ? '…' : 'Save'}
      </button>
      {err
        ? <span style={{ fontSize: '0.8125rem', color: '#ef4444' }}>{err}</span>
        : <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>
            {workingDays == null
              ? `Suggested ${suggested} (excluding Sundays, public holidays and choice holidays) — save to enable payroll calculations.`
              : `Payroll is calculated over ${workingDays} working days.${workingDays !== suggested ? ` (Calendar suggests ${suggested}.)` : ''}`}
          </span>
      }
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function SummaryRow({ summary: s, showPayroll }: { summary: EmployeeSummary; showPayroll: boolean }) {
  const attendanceRate = s.totalDays > 0 ? Math.round(((s.present + s.late) / s.totalDays) * 100) : 0
  const barColor = attendanceRate >= 80 ? '#16a34a' : attendanceRate >= 60 ? '#d97706' : '#ef4444'

  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
      <td style={tdStyle}>
        <div style={{ fontWeight: 600, color: '#1e293b' }}>{s.employee.full_name}</div>
        <div style={{ marginTop: '0.375rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ flex: 1, height: 4, background: '#f1f5f9', borderRadius: 2, maxWidth: 120 }}>
            <div style={{ width: `${attendanceRate}%`, height: '100%', background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{attendanceRate}%</span>
        </div>
      </td>
      <td style={{ ...tdStyle, color: '#64748b' }}>{s.employee.department ?? '—'}</td>
      <td style={{ ...tdStyle, textAlign: 'center', color: '#64748b', fontWeight: 500 }}>{s.totalDays}</td>
      <StatCell value={s.present}  color="#166534" bg="#dcfce7" />
      <StatCell value={s.late}     color="#854d0e" bg="#fef9c3" />
      <StatCell value={s.absent}   color="#991b1b" bg="#fee2e2" dim={s.absent === 0} note={s.absent > 0 ? 'LOP' : undefined} />
      <StatCell value={s.on_leave} color="#5b21b6" bg="#ede9fe" dim={s.on_leave === 0} note={s.leave_lop > 0 ? `${s.leave_lop} LOP` : undefined} />
      {showPayroll && <>
        <td style={{ ...tdStyle, textAlign: 'center', color: '#166534', fontWeight: 600 }}>
          {s.paidDays != null ? s.paidDays : <span style={{ color: '#cbd5e1' }}>—</span>}
        </td>
        <td style={{ ...tdStyle, textAlign: 'right', color: '#0369a1', fontWeight: 500 }}>
          {s.employee.monthly_salary != null ? fmt(s.employee.monthly_salary) : <span style={{ color: '#cbd5e1' }}>—</span>}
        </td>
        <td style={{ ...tdStyle, textAlign: 'right', color: s.deduction && s.deduction > 0 ? '#b91c1c' : '#64748b', fontWeight: s.deduction && s.deduction > 0 ? 600 : 400 }}>
          {s.deduction != null ? fmt(s.deduction) : <span style={{ color: '#cbd5e1' }}>—</span>}
        </td>
        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: '#166534' }}>
          {s.netPay != null ? fmt(s.netPay) : <span style={{ color: '#cbd5e1' }}>—</span>}
        </td>
      </>}
    </tr>
  )
}

function StatCell({ value, color, bg, dim, note }: { value: number; color: string; bg: string; dim?: boolean; note?: string }) {
  if (value === 0 || dim) {
    return <td style={{ ...tdStyle, textAlign: 'center', color: '#cbd5e1', fontWeight: 500 }}>{value}</td>
  }
  return (
    <td style={{ ...tdStyle, textAlign: 'center' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 28, height: 28, borderRadius: 6,
        background: bg, color, fontWeight: 700, fontSize: '0.875rem',
      }}>
        {value}
      </span>
      {note && <div style={{ fontSize: '0.6875rem', color: '#b91c1c', marginTop: 2 }}>{note}</div>}
    </td>
  )
}

function TotalCell({ value, color, bg }: { value: number; color: string; bg: string }) {
  return (
    <td style={{ ...tdStyle, textAlign: 'center' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 32, height: 28, borderRadius: 6,
        background: bg, color, fontWeight: 700, fontSize: '0.9375rem',
      }}>
        {value}
      </span>
    </td>
  )
}

// ── Styles ────────────────────────────────────────────────────

const thStyle: CSSProperties = {
  textAlign: 'left', padding: '0.625rem 1rem',
  fontWeight: 600, fontSize: '0.75rem',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  color: '#64748b', whiteSpace: 'nowrap',
}

const tdStyle: CSSProperties = { padding: '0.875rem 1rem', verticalAlign: 'middle' }
