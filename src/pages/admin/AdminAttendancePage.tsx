import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useAdminAttendance } from '../../hooks/useAdminAttendance'
import type { AdminAttendanceRow } from '../../hooks/useAdminAttendance'
import { STATUS_COLORS, STATUS_LABELS } from '../../types'
import type { AttendanceRecord } from '../../types'
import { fmtDuration, minBreakTopUp, totalBreakSeconds } from '../../lib/breaks'
import { useShifts } from '../../hooks/useShifts'
import type { Shift } from '../../types'
import { localDate } from '../../lib/calendar'

const todayISO = () => localDate()

function shiftDate(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return localDate(d)
}

function fmtDateLabel(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString([], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const SUMMARY_CONFIG: Array<{ status: AttendanceRecord['status']; label: string; color: string; bg: string }> = [
  { status: 'present',  label: 'Present',  color: '#166534', bg: '#dcfce7' },
  { status: 'late',     label: 'Late',     color: '#854d0e', bg: '#fef9c3' },
  { status: 'absent',   label: 'Absent',   color: '#991b1b', bg: '#fee2e2' },
  { status: 'on_leave', label: 'On Leave', color: '#5b21b6', bg: '#ede9fe' },
]

export default function AdminAttendancePage() {
  const today = todayISO()
  const [selectedDate, setSelectedDate] = useState(today)
  const { shiftOn } = useShifts()
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<AttendanceRecord['status'] | ''>('')

  const { rows, loading, error } = useAdminAttendance(selectedDate)

  // Summary counts from unfiltered rows
  const summaryCounts = useMemo(() => {
    const counts: Record<AttendanceRecord['status'], number> = { present: 0, late: 0, absent: 0, on_leave: 0 }
    for (const r of rows) counts[r.effectiveStatus]++
    return counts
  }, [rows])

  // Unique departments for the filter dropdown
  const departments = useMemo(() => {
    const set = new Set(rows.map(r => r.employee.department).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [rows])

  // Filtered rows for the table
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (search && !r.employee.full_name.toLowerCase().includes(search.toLowerCase())) return false
      if (deptFilter && r.employee.department !== deptFilter) return false
      if (statusFilter && r.effectiveStatus !== statusFilter) return false
      return true
    })
  }, [rows, search, deptFilter, statusFilter])

  const isToday = selectedDate === today

  return (
    <div>
      {/* Page header + date nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
          Attendance
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button onClick={() => setSelectedDate(d => shiftDate(d, -1))} style={navBtn}>‹</button>
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={e => setSelectedDate(e.target.value)}
            style={{
              padding: '0.4rem 0.625rem',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              fontSize: '0.875rem',
              color: '#1e293b',
              outline: 'none',
            }}
          />
          <button
            onClick={() => setSelectedDate(d => shiftDate(d, 1))}
            disabled={isToday}
            style={{ ...navBtn, opacity: isToday ? 0.35 : 1, cursor: isToday ? 'default' : 'pointer' }}
          >
            ›
          </button>
          {!isToday && (
            <button onClick={() => setSelectedDate(today)} style={todayBtn}>Today</button>
          )}
        </div>
      </div>

      <p style={{ margin: '-1rem 0 1.5rem', color: '#64748b', fontSize: '0.875rem' }}>
        {fmtDateLabel(selectedDate)}
      </p>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {SUMMARY_CONFIG.map(({ status, label, color, bg }) => (
          <div
            key={status}
            onClick={() => setStatusFilter(sf => sf === status ? '' : status)}
            style={{
              background: statusFilter === status ? bg : '#fff',
              border: `1px solid ${statusFilter === status ? color.replace('1b', '7d').replace('4a', 'a5') : '#e2e8f0'}`,
              borderRadius: 12,
              padding: '1rem 1.25rem',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: '2rem', fontWeight: 700, color, lineHeight: 1 }}>
              {loading ? '—' : summaryCounts[status]}
            </div>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#64748b', marginTop: '0.25rem' }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search employee…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...filterInput, flex: '1 1 180px' }}
        />
        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          style={{ ...filterInput, flex: '0 1 180px' }}
        >
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as AttendanceRecord['status'] | '')}
          style={{ ...filterInput, flex: '0 1 160px' }}
        >
          <option value="">All Statuses</option>
          <option value="present">Present</option>
          <option value="late">Late</option>
          <option value="absent">Absent</option>
          <option value="on_leave">On Leave</option>
        </select>
        {(search || deptFilter || statusFilter) && (
          <button
            onClick={() => { setSearch(''); setDeptFilter(''); setStatusFilter('') }}
            style={{ padding: '0.4rem 0.875rem', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: '0.875rem', color: '#64748b' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflowX: 'auto' }}>
        {error ? (
          <div style={{ padding: '2rem', color: '#ef4444' }}>{error}</div>
        ) : loading ? (
          <div style={{ padding: '2rem', color: '#94a3b8' }}>Loading…</div>
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: '2rem', color: '#94a3b8', textAlign: 'center' }}>
            {rows.length === 0 ? 'No active employees found.' : 'No results match your filters.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {['Employee', 'Department', 'Status', 'Check In', 'Check Out', 'Break'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => (
                <AttendanceTableRow key={row.employee.id} row={row} shift={shiftOn(row.employee.id, selectedDate)} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && filteredRows.length > 0 && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#94a3b8', textAlign: 'right' }}>
          {filteredRows.length} of {rows.length} employee{rows.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}

function AttendanceTableRow({ row, shift }: { row: AdminAttendanceRow; shift: Shift | null }) {
  const colors = STATUS_COLORS[row.effectiveStatus]
  const topUp = minBreakTopUp(row.record, shift)
  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
      <td style={{ ...tdStyle, fontWeight: 500, color: '#1e293b' }}>{row.employee.full_name}</td>
      <td style={{ ...tdStyle, color: '#64748b' }}>{row.employee.department ?? '—'}</td>
      <td style={tdStyle}>
        <span style={{
          display: 'inline-block',
          padding: '2px 10px',
          borderRadius: 99,
          background: colors.bg,
          color: colors.text,
          fontWeight: 500,
          fontSize: '0.8125rem',
        }}>
          {STATUS_LABELS[row.effectiveStatus]}
        </span>
      </td>
      <td style={tdStyle}>{fmtTime(row.record?.check_in_time)}</td>
      <td style={tdStyle}>{fmtTime(row.record?.check_out_time)}</td>
      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
        {fmtDuration(totalBreakSeconds(row.record))}
        {topUp > 0 && (
          <span
            title={`Less than the ${shift!.min_break_minutes}-minute minimum break was recorded; ${Math.round(topUp / 60)} min extra is deducted from worked hours`}
            style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 99, background: '#fef3c7', color: '#92400e', fontSize: '0.75rem', fontWeight: 500 }}
          >
            +{Math.round(topUp / 60)}m to minimum
          </span>
        )}
        {row.record?.break_started_at && !row.record.check_out_time && (
          <span style={{
            marginLeft: 8,
            padding: '1px 8px',
            borderRadius: 99,
            background: '#fef3c7',
            color: '#b45309',
            fontSize: '0.75rem',
            fontWeight: 500,
          }}>
            On break
          </span>
        )}
      </td>
    </tr>
  )
}

const navBtn: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '1.125rem',
  color: '#374151',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
}

const todayBtn: CSSProperties = {
  padding: '0.375rem 0.75rem',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '0.875rem',
  color: '#374151',
}

const filterInput: CSSProperties = {
  padding: '0.5rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: '0.875rem',
  color: '#1e293b',
  outline: 'none',
  background: '#fff',
  minWidth: 0,
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '0.625rem 1rem',
  fontWeight: 600,
  color: '#64748b',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
}

const tdStyle: CSSProperties = {
  padding: '0.75rem 1rem',
}
