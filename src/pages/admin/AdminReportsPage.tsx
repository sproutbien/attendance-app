import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useMonthlyReport } from '../../hooks/useMonthlyReport'
import type { EmployeeSummary } from '../../hooks/useMonthlyReport'

// ── Helpers ───────────────────────────────────────────────────

function monthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })
}

function csvEscape(val: string | number) {
  const s = String(val)
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCSV(summaries: EmployeeSummary[], yearMonth: string) {
  const label = monthLabel(yearMonth)
  const headers = ['Employee', 'Email', 'Department', 'Total Days', 'Present', 'Late', 'Absent', 'On Leave']

  const dataRows = summaries.map(s => [
    s.employee.full_name,
    s.employee.email,
    s.employee.department ?? '',
    s.totalDays,
    s.present,
    s.late,
    s.absent,
    s.on_leave,
  ])

  const totals = summaries.reduce(
    (acc, s) => ({ present: acc.present + s.present, late: acc.late + s.late, absent: acc.absent + s.absent, on_leave: acc.on_leave + s.on_leave }),
    { present: 0, late: 0, absent: 0, on_leave: 0 }
  )

  const lines = [
    [`Sproutbien Attendance Report — ${label}`].map(csvEscape).join(','),
    '',
    headers.map(csvEscape).join(','),
    ...dataRows.map(row => row.map(csvEscape).join(',')),
    '',
    ['TOTAL', '', '', '', totals.present, totals.late, totals.absent, totals.on_leave].map(csvEscape).join(','),
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
  const currentMonth = new Date().toISOString().slice(0, 7)
  const [yearMonth, setYearMonth] = useState(currentMonth)
  const { summaries, loading, error } = useMonthlyReport(yearMonth)

  const totals = summaries.reduce(
    (acc, s) => ({ present: acc.present + s.present, late: acc.late + s.late, absent: acc.absent + s.absent, on_leave: acc.on_leave + s.on_leave }),
    { present: 0, late: 0, absent: 0, on_leave: 0 }
  )

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
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
          onClick={() => exportCSV(summaries, yearMonth)}
          disabled={loading || summaries.length === 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1.125rem',
            background: loading || summaries.length === 0 ? '#f1f5f9' : '#16a34a',
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

      <p style={{ margin: '-1rem 0 1.5rem', color: '#64748b', fontSize: '0.875rem' }}>
        {monthLabel(yearMonth)} · {loading ? '…' : `${summaries.length} active employee${summaries.length !== 1 ? 's' : ''}`}
      </p>

      {/* Summary pills */}
      {!loading && summaries.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={thStyle}>Employee</th>
                <th style={thStyle}>Department</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Days</th>
                <th style={{ ...thStyle, textAlign: 'center', color: '#166534' }}>Present</th>
                <th style={{ ...thStyle, textAlign: 'center', color: '#854d0e' }}>Late</th>
                <th style={{ ...thStyle, textAlign: 'center', color: '#991b1b' }}>Absent</th>
                <th style={{ ...thStyle, textAlign: 'center', color: '#5b21b6' }}>On Leave</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(s => <SummaryRow key={s.employee.id} summary={s} />)}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#1e293b' }} colSpan={2}>Total</td>
                <td style={{ ...tdStyle, textAlign: 'center', color: '#64748b' }}>—</td>
                <TotalCell value={totals.present}  color="#166534" bg="#dcfce7" />
                <TotalCell value={totals.late}     color="#854d0e" bg="#fef9c3" />
                <TotalCell value={totals.absent}   color="#991b1b" bg="#fee2e2" />
                <TotalCell value={totals.on_leave} color="#5b21b6" bg="#ede9fe" />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {!loading && summaries.length > 0 && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#94a3b8' }}>
          "Days" = calendar days from the 1st to today (current month) or end of month (past months).
          Absent = Days − Present − Late − On Leave.
        </p>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function SummaryRow({ summary: s }: { summary: EmployeeSummary }) {
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
      <StatCell value={s.absent}   color="#991b1b" bg="#fee2e2" dim={s.absent === 0} />
      <StatCell value={s.on_leave} color="#5b21b6" bg="#ede9fe" dim={s.on_leave === 0} />
    </tr>
  )
}

function StatCell({ value, color, bg, dim }: { value: number; color: string; bg: string; dim?: boolean }) {
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
