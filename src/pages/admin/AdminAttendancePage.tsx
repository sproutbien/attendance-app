import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { CalendarOff, CircleCheck, Clock, Coffee, LogIn, LogOut, Percent, UserX } from 'lucide-react'
import { useAdminAttendance } from '../../hooks/useAdminAttendance'
import type { AdminAttendanceRow } from '../../hooks/useAdminAttendance'
import { STATUS_COLORS, STATUS_LABELS } from '../../types'
import type { AttendanceRecord } from '../../types'
import { fmtDuration, minBreakTopUp, totalBreakSeconds } from '../../lib/breaks'
import { useShifts } from '../../hooks/useShifts'
import { supabase } from '../../lib/supabase'
import { fmtPermissionTime } from '../../lib/requests'
import type { Shift } from '../../types'
import { localDate } from '../../lib/calendar'
import { selfieExpired, selfieUrls } from '../../lib/selfies'
import { SelfieCell, SelfieReview } from '../../components/SelfieAdmin'
import { LocationCell } from '../../components/GeofenceAdmin'
import { CheckInRulesButton, CheckInRulesDrawer, useCheckInRules } from '../../components/CheckInRules'
import { PendingBar } from '../../components/stats/TeamNow'
import { useTeamNow } from '../../hooks/useTeamNow'
import { LATE_STREAK_MIN, TREND_DAYS, UPCOMING_DAYS, useWeekOverview } from '../../hooks/useWeekOverview'
import type { WeekOverview } from '../../hooks/useWeekOverview'
import { WeekColumns } from '../../components/stats/TeamCharts'
import { KIND_META } from '../../components/stats/Charts'
import type { DayKind } from '../../lib/stats'
import EmployeeAvatar from '../../components/employees/EmployeeAvatar'
import { Link } from 'react-router-dom'
import '../../styles/stats.css'

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

const SUMMARY_CONFIG: Array<{ status: AttendanceRecord['status']; label: string; icon: ReactNode; color: string; accent: string; bg: string }> = [
  { status: 'present',  label: 'Present',  icon: <CircleCheck size={16} />, color: '#166534', accent: '#16a34a', bg: '#dcfce7' },
  { status: 'late',     label: 'Late',     icon: <Clock size={16} />,       color: '#854d0e', accent: '#ca8a04', bg: '#fef9c3' },
  { status: 'absent',   label: 'Absent',   icon: <UserX size={16} />,       color: '#991b1b', accent: '#dc2626', bg: '#fee2e2' },
  { status: 'on_leave', label: 'On Leave', icon: <CalendarOff size={16} />, color: '#5b21b6', accent: '#7c3aed', bg: '#ede9fe' },
]

/** First names, at most three, then "+n more". */
function nameList(rows: AdminAttendanceRow[]) {
  if (rows.length === 0) return 'No one'
  const names = rows.slice(0, 3).map(r => r.employee.full_name.split(' ')[0]).join(', ')
  return rows.length > 3 ? `${names} +${rows.length - 3} more` : names
}

export default function AdminAttendancePage() {
  const today = todayISO()
  const [selectedDate, setSelectedDate] = useState(today)
  const { dayShift } = useShifts()
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<AttendanceRecord['status'] | ''>('')

  const { rows, loading, error } = useAdminAttendance(selectedDate)
  const dayRequests = useDayRequests(selectedDate)
  const { now } = useTeamNow()
  const { overview } = useWeekOverview()

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

  // "At a glance" figures for the day
  const glance = useMemo(() => {
    const ins = rows.flatMap(r => (r.record?.check_in_time ? [new Date(r.record.check_in_time)] : []))
    const avgIn = ins.length ? Math.round(ins.reduce((a, d) => a + d.getHours() * 60 + d.getMinutes(), 0) / ins.length) : null
    const expected = rows.length - summaryCounts.on_leave
    return {
      rate: expected > 0 ? (summaryCounts.present + summaryCounts.late) / expected : null,
      working: rows.filter(r => r.record?.check_in_time && !r.record.check_out_time && !r.record.break_started_at).length,
      onBreak: rows.filter(r => r.record?.break_started_at && !r.record.check_out_time).length,
      checkedOut: rows.filter(r => r.record?.check_out_time).length,
      avgIn: avgIn == null ? null : fmtTime(new Date(2000, 0, 1, Math.floor(avgIn / 60), avgIn % 60).toISOString()),
    }
  }, [rows, summaryCounts])

  // Selfie / Location columns: shown while the rule is on, or when the day has data for them
  const [rules, setRules] = useCheckInRules()
  const [rulesOpen, setRulesOpen] = useState(false)
  const showSelfie = !!rules?.selfie || rows.some(r => r.record?.selfie_path || r.record?.selfie_missing_reason)
  const showLocation = !!rules?.location || rows.some(r => r.record?.geofence_status)
  const columns = ['Employee', 'Department', 'Status', 'Check In',
    ...(showSelfie ? ['Selfie'] : []), ...(showLocation ? ['Location'] : []), 'Check Out', 'Break']

  // Signed links for the day's selfies (private bucket)
  const [selfies, setSelfies] = useState<Record<string, string>>({})
  const [reviewing, setReviewing] = useState<AdminAttendanceRow | null>(null)
  useEffect(() => {
    let cancelled = false
    setSelfies({})
    if (selfieExpired(selectedDate)) return
    const paths = rows.map(r => r.record?.selfie_path).filter(Boolean) as string[]
    selfieUrls(paths).then(urls => { if (!cancelled) setSelfies(urls) })
    return () => { cancelled = true }
  }, [rows, selectedDate])

  return (
    <div>
      {/* Page header + date nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
          Attendance
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <CheckInRulesButton rules={rules} onClick={() => setRulesOpen(true)} />
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
      </div>

      <p style={{ margin: '-1rem 0 1.5rem', color: '#64748b', fontSize: '0.875rem' }}>
        {fmtDateLabel(selectedDate)}
      </p>

      {/* Approvals waiting — same counts as the sidebar badges */}
      {now && (
        <div className="sb-app st-admin" data-theme="light">
          <PendingBar pending={now.pending} />
        </div>
      )}

      {/* Summary cards — click one to filter the table */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        {SUMMARY_CONFIG.map(({ status, label, icon, color, accent, bg }) => {
          const active = statusFilter === status
          const people = rows.filter(r => r.effectiveStatus === status)
          const share = rows.length ? Math.round((summaryCounts[status] / rows.length) * 100) : 0
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(sf => sf === status ? '' : status)}
              style={{
                textAlign: 'left',
                font: 'inherit',
                minWidth: 0,
                background: active ? bg : '#fff',
                border: `1px solid ${active ? accent : '#e2e8f0'}`,
                borderTop: `4px solid ${accent}`,
                borderRadius: 12,
                padding: '0.875rem 1.125rem 1rem',
                cursor: 'pointer',
                transition: 'all 0.15s',
                boxShadow: active ? `0 0 0 3px ${bg}` : '0 1px 3px rgba(15,23,42,0.06)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, background: bg, color: accent }}>
                  {icon}
                </span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {label}
                </span>
                {!loading && rows.length > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color, background: bg, padding: '1px 8px', borderRadius: 99 }}>
                    {share}%
                  </span>
                )}
              </div>
              <div style={{ marginTop: '0.625rem', display: 'flex', alignItems: 'baseline', gap: '0.375rem' }}>
                <span style={{ fontSize: '2.25rem', fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                  {loading ? '—' : summaryCounts[status]}
                </span>
                {!loading && <span style={{ fontSize: '0.875rem', color: '#94a3b8' }}>/ {rows.length}</span>}
              </div>
              <div
                title={people.map(r => r.employee.full_name).join(', ')}
                style={{ marginTop: '0.5rem', minHeight: '1.2em', fontSize: '0.8125rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {loading ? '' : status === 'absent' && isToday && people.length > 0 ? `Not in yet: ${nameList(people)}` : nameList(people)}
              </div>
            </button>
          )
        })}
      </div>

      {/* The day at a glance */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '0.75rem 1.125rem', marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b' }}>{isToday ? 'Right now' : 'That day'}</span>
          <Glance icon={<Percent size={14} />} label="Attendance" value={glance.rate == null ? '—' : `${Math.round(glance.rate * 100)}%`} title="Present + late ÷ everyone not on leave" />
          {isToday && <Glance icon={<LogIn size={14} />} label="Working now" value={glance.working} />}
          {isToday && <Glance icon={<Coffee size={14} />} label="On break" value={glance.onBreak} />}
          <Glance icon={<LogOut size={14} />} label="Checked out" value={glance.checkedOut} />
          <Glance icon={<Clock size={14} />} label="Avg. check-in" value={glance.avgIn ?? '—'} />
        </div>
      )}

      {overview && <WeekCards overview={overview} />}

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
          <table className="rt" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {columns.map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => (
                <AttendanceTableRow
                  key={row.employee.id}
                  row={row}
                  shift={dayShift(row.employee.id, selectedDate)}
                  tags={dayRequests.get(row.employee.id)}
                  selfieUrl={row.record?.selfie_path ? selfies[row.record.selfie_path] : undefined}
                  onSelfie={() => setReviewing(row)}
                  showSelfie={showSelfie}
                  showLocation={showLocation}
                />
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

      {reviewing?.record && (
        <SelfieReview
          employee={reviewing.employee}
          record={reviewing.record}
          url={reviewing.record.selfie_path ? selfies[reviewing.record.selfie_path] : undefined}
          onClose={() => setReviewing(null)}
        />
      )}

      {rulesOpen && (
        <CheckInRulesDrawer
          onChange={changes => setRules(r => ({ selfie: false, location: false, ...r, ...changes }))}
          onClose={() => setRulesOpen(false)}
        />
      )}
    </div>
  )
}

const shortDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** Last 7 days trend, late streaks and what's coming up. Independent of the date being viewed. */
function WeekCards({ overview }: { overview: WeekOverview }) {
  const { today, days, lateStreaks, upcoming } = overview
  const kinds = Object.keys(KIND_META) as DayKind[]
  const inDays = (d: string) => {
    const n = Math.round((new Date(d + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
    return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
  }
  return (
    <div className="sb-app st-admin" data-theme="light">
      <div className="st-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', marginBottom: '1.5rem' }}>
        <section className="st-card">
          <div className="st-card-head">
            <h2>Last {TREND_DAYS} days</h2>
            <p>People per day · hover a day for details</p>
          </div>
          <WeekColumns
            today={today}
            days={days.map(d => ({ date: d.date, off: d.off, values: { on_time: d.on_time, late: d.late, leave: d.leave, absent: d.absent } }))}
          />
          <ul className="st-legend" style={{ marginTop: 8 }}>
            {kinds.map(k => <li key={k}><span className="st-swatch" style={{ background: KIND_META[k].color }} />{KIND_META[k].label}</li>)}
          </ul>
        </section>

        <section className="st-card">
          <div className="st-card-head">
            <h2>Running late</h2>
            <p>Late {LATE_STREAK_MIN}+ times in the last {TREND_DAYS} days · worth a friendly word</p>
          </div>
          {lateStreaks.length === 0 ? (
            <p className="st-now-none"><CircleCheck size={14} style={{ verticalAlign: '-2px', color: 'var(--green)' }} /> No one — punctuality looks good</p>
          ) : (
            <ul className="st-now-list">
              {lateStreaks.map(({ person, dates }) => (
                <li key={person.id}>
                  <Link to={`/admin/employees/${person.id}/stats`} style={{ display: 'contents', color: 'inherit', textDecoration: 'none' }}>
                    <EmployeeAvatar employee={person} size={26} />
                    <span className="st-now-name">
                      {person.full_name}
                      <small>{dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })).join(', ')}</small>
                    </span>
                  </Link>
                  <em style={{ color: '#854d0e', background: '#fef9c3', padding: '1px 8px', borderRadius: 99, fontWeight: 600 }}>{dates.length}× late</em>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="st-card">
          <div className="st-card-head">
            <h2>Coming up</h2>
            <p>Holidays, birthdays and work anniversaries · next {UPCOMING_DAYS} days</p>
          </div>
          {upcoming.length === 0 ? (
            <p className="st-now-none">Nothing in the next {UPCOMING_DAYS} days</p>
          ) : (
            <ul className="st-now-list">
              {upcoming.slice(0, 6).map(u => (
                <li key={`${u.kind}-${u.date}-${u.person?.id ?? u.label}`}>
                  {u.person ? <EmployeeAvatar employee={u.person} size={26} /> : (
                    <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#eff6ff', color: '#1d4ed8', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <CalendarOff size={14} />
                    </span>
                  )}
                  <span className="st-now-name">
                    {u.person ? u.person.full_name : u.label}
                    <small>{u.kind === 'birthday' ? '🎂 Birthday' : u.kind === 'anniversary' ? `🎉 ${u.label}` : 'Public holiday'} · {shortDay(u.date)}</small>
                  </span>
                  <em>{inDays(u.date)}</em>
                </li>
              ))}
              {upcoming.length > 6 && <li><span className="st-now-none">+{upcoming.length - 6} more</span></li>}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function Glance({ icon, label, value, title }: { icon: ReactNode; label: string; value: ReactNode; title?: string }) {
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: '#64748b' }}>
      <span style={{ color: '#94a3b8', display: 'inline-flex' }}>{icon}</span>
      {label}
      <b style={{ color: '#0f172a', fontSize: '0.9375rem', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </span>
  )
}

function AttendanceTableRow({ row, shift, tags, selfieUrl, onSelfie, showSelfie, showLocation }: {
  row: AdminAttendanceRow
  shift: Shift | null
  tags?: string[]
  selfieUrl: string | undefined
  onSelfie: () => void
  showSelfie: boolean
  showLocation: boolean
}) {
  const colors = STATUS_COLORS[row.effectiveStatus]
  const topUp = minBreakTopUp(row.record, shift)
  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
      <td style={{ ...tdStyle, fontWeight: 500, color: '#1e293b' }}>
        {row.employee.full_name}
        {tags?.map(t => (
          <span key={t} style={{ display: 'inline-block', marginLeft: 6, padding: '1px 8px', borderRadius: 99, background: '#eff6ff', color: '#1d4ed8', fontSize: '0.6875rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{t}</span>
        ))}
      </td>
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
      {showSelfie && (
        <td style={{ ...tdStyle, paddingTop: '0.375rem', paddingBottom: '0.375rem' }}>
          <SelfieCell record={row.record} url={selfieUrl} onOpen={onSelfie} />
        </td>
      )}
      {showLocation && <td style={tdStyle}><LocationCell record={row.record} /></td>}
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

/** Approved one-day shift changes and permissions on a date, as short tags per employee (migration 042). */
function useDayRequests(date: string) {
  const [tags, setTags] = useState<Map<string, string[]>>(new Map())
  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('shift_changes').select('employee_id, shift:shifts!shift_id(name)').eq('date', date).eq('status', 'approved'),
      supabase.from('permission_requests').select('employee_id, start_time, end_time').eq('date', date).eq('status', 'approved'),
    ]).then(([c, p]) => {
      if (cancelled) return
      const m = new Map<string, string[]>()
      const add = (id: string, t: string) => m.set(id, [...(m.get(id) ?? []), t])
      for (const r of (c.data ?? []) as unknown as { employee_id: string; shift: { name: string } | null }[]) add(r.employee_id, `${r.shift?.name ?? 'Shift'} shift today`)
      for (const r of (p.data ?? []) as { employee_id: string; start_time: string; end_time: string }[]) add(r.employee_id, `Permission ${fmtPermissionTime(r)}`)
      setTags(m)
    })
    return () => { cancelled = true }
  }, [date])
  return tags
}
