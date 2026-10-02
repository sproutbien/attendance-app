import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, CalendarCheck, ChartColumn, Coffee, DoorOpen, Download, Timer, TriangleAlert, Users } from 'lucide-react'
import { MonthPicker } from '../../components/MonthCalendar'
import { KIND_META } from '../../components/stats/Charts'
import { BreakdownBars, MonthColumns, RankBars } from '../../components/stats/TeamCharts'
import EmployeeAvatar from '../../components/employees/EmployeeAvatar'
import { usePrintSetup } from '../../components/stats/print'
import { useTeamStats } from '../../hooks/useTeamStats'
import type { MemberStats, TeamMember } from '../../hooks/useTeamStats'
import { TRACKING_START, currentYearMonth, monthLabel } from '../../lib/calendar'
import { fmtHM } from '../../lib/breaks'
import { breakFlags, fmtDays, fmtMinutes, fmtPct, teamTotals } from '../../lib/stats'
import type { DayKind, MonthStats } from '../../lib/stats'
import '../../styles/stats.css'

type SortKey = 'name' | 'attendance' | 'onTime' | 'avgWorked' | 'worked' | 'present' | 'late' | 'leave' | 'absent' | 'vsShift' | 'checkIn' | 'minBreak'

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'name', label: 'Employee' },
  { key: 'attendance', label: 'Attendance', title: 'Days present ÷ working days (approved leave excluded)' },
  { key: 'onTime', label: 'On time' },
  { key: 'present', label: 'Present' },
  { key: 'late', label: 'Late' },
  { key: 'leave', label: 'Leave' },
  { key: 'absent', label: 'Absent' },
  { key: 'worked', label: 'Total hours' },
  { key: 'avgWorked', label: 'Avg. / day' },
  { key: 'vsShift', label: 'Vs shift', title: 'Hours worked minus shift hours on days they came in' },
  { key: 'checkIn', label: 'Avg. check-in' },
  { key: 'minBreak', label: 'Min. break days', title: 'Full days where less than the shift’s minimum break was recorded (days with no break at all in brackets)' },
]

const sortValue = (s: MemberStats, k: SortKey): number | string => {
  const m = s.month
  switch (k) {
    case 'name': return s.employee.full_name.toLowerCase()
    case 'attendance': return m.attendanceRate ?? -1
    case 'onTime': return m.onTimeRate ?? -1
    case 'avgWorked': return m.avgWorked
    case 'worked': return m.worked
    case 'present': return m.present
    case 'late': return m.late
    case 'leave': return m.leave
    case 'absent': return m.absent
    case 'vsShift': return m.expected ? m.worked - m.expected : -Infinity
    case 'checkIn': return m.avgCheckIn ?? Infinity
    case 'minBreak': return m.topUpDays + m.noBreakDays / 100
  }
}

/** Admin: compare everyone's attendance, punctuality and hours for a month. */
export default function AdminTeamStatsPage() {
  const thisMonth = currentYearMonth()
  const [params, setParams] = useSearchParams()
  const asked = params.get('month')
  const yearMonth = asked && /^\d{4}-\d{2}$/.test(asked) && asked <= thisMonth && asked >= TRACKING_START.slice(0, 7) ? asked : thisMonth
  const setMonth = (ym: string) => setParams(ym === thisMonth ? {} : { month: ym }, { replace: true })

  const [dept, setDept] = useState('')
  const [includeAdmins, setIncludeAdmins] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'attendance', asc: false })

  const { members, trendFor, loading, error } = useTeamStats(yearMonth)
  usePrintSetup(`Team attendance – ${monthLabel(yearMonth)}`)

  const include = useMemo(() => (e: TeamMember) => (includeAdmins || e.role !== 'admin') && (!dept || e.department === dept), [includeAdmins, dept])
  const departments = [...new Set((members ?? []).map(m => m.employee.department).filter((d): d is string => !!d))].sort()

  // People with working days this month (new joiners / leavers outside the month drop out)
  const shown = (members ?? []).filter(m => include(m.employee) && m.month.workingDays > 0)
  const team = teamTotals(shown.map(s => s.month))
  const prevTeam = shown.some(s => s.previous) ? teamTotals(shown.flatMap(s => (s.previous ? [s.previous] : []))) : null
  const trend = trendFor ? trendFor(include) : []

  const sorted = [...shown].sort((a, b) => {
    const va = sortValue(a, sort.key), vb = sortValue(b, sort.key)
    const c = va < vb ? -1 : va > vb ? 1 : 0
    return (sort.asc ? c : -c) || a.employee.full_name.localeCompare(b.employee.full_name)
  })
  const flagged = shown
    .map(s => ({ s, flags: breakFlags(s.month) }))
    .filter(f => f.flags.length > 0)
    .sort((a, b) => b.s.month.noBreakDays - a.s.month.noBreakDays || b.s.month.topUpDays - a.s.month.topUpDays)
  const byAttendance = [...shown].sort((a, b) => (b.month.attendanceRate ?? -1) - (a.month.attendanceRate ?? -1))
  const byHours = [...shown].sort((a, b) => b.month.avgWorked - a.month.avgWorked)
  const byOnTime = [...shown].sort((a, b) => (b.month.onTimeRate ?? -1) - (a.month.onTimeRate ?? -1))
  const maxHours = Math.max(10, ...shown.map(s => s.month.avgWorked / 3600))

  const prevName = prevTeam ? new Date(trend[trend.length - 2]?.yearMonth + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' }) : ''
  const delta = (cur: number | null, old: number | null | undefined, fmt: (n: number) => string) => {
    if (!prevTeam || prevTeam.present === 0 || cur == null || old == null) return null
    const d = cur - old
    if (Math.abs(d) < 1e-9) return { text: `Same as ${prevName}`, tone: '' }
    return { text: `${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))} vs ${prevName}`, tone: d > 0 ? 'is-good' : 'is-bad' }
  }
  const pts = (n: number) => `${Math.round(n * 100)} pts`

  const tiles: { icon: ReactNode; label: string; value: ReactNode; delta?: { text: string; tone: string } | null }[] = [
    { icon: <Users size={14} />, label: 'People', value: team.people },
    { icon: <CalendarCheck size={14} />, label: 'Attendance', value: fmtPct(team.attendanceRate), delta: delta(team.attendanceRate, prevTeam?.attendanceRate, pts) },
    { icon: <Timer size={14} />, label: 'On-time rate', value: fmtPct(team.onTimeRate), delta: delta(team.onTimeRate, prevTeam?.onTimeRate, pts) },
    { icon: <ChartColumn size={14} />, label: 'Avg. hours / day', value: fmtHM(team.avgWorked), delta: delta(team.avgWorked, prevTeam?.avgWorked, fmtHM) },
    { icon: <DoorOpen size={14} />, label: 'Leave days', value: fmtDays(team.leave) },
    { icon: <TriangleAlert size={14} />, label: 'Absences', value: <>{fmtDays(team.absent)}<small>· {fmtDays(team.late)} late</small></> },
  ]

  return (
    <div className="sb-app st-admin" data-theme="light">
      <div className="st-print-only" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '2px solid var(--green-dark)', paddingBottom: 10 }}>
          <img src="/logo.jpg" alt="" style={{ height: 34 }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-strong)' }}>Team attendance · {monthLabel(yearMonth)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {dept || 'All departments'}{includeAdmins ? ' · admins included' : ''} · {team.people} people
              {` · Generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            </div>
          </div>
        </div>
      </div>

      <div className="st-page">
        <div className="st-top st-no-print">
          <div>
            <h1>Team Stats</h1>
            <span className="st-sub">Compare attendance, punctuality and hours across the team</span>
          </div>
          <div className="st-top-actions" style={{ flexWrap: 'wrap' }}>
            <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Department" className="st-btn" style={{ fontWeight: 500 }}>
              <option value="">All departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <label className="st-btn" style={{ fontWeight: 500 }}>
              <input type="checkbox" checked={includeAdmins} onChange={e => setIncludeAdmins(e.target.checked)} style={{ margin: 0 }} />
              Include admins
            </label>
            <MonthPicker yearMonth={yearMonth} onChange={ym => ym >= TRACKING_START.slice(0, 7) && setMonth(ym)} max={thisMonth} compact />
            <button className="st-btn" onClick={() => window.print()} disabled={!shown.length}>
              <Download size={15} /> Download PDF
            </button>
          </div>
        </div>

        {error ? (
          <div className="st-card"><p className="st-empty">{error}</p></div>
        ) : loading && !members ? (
          <div className="st-card"><p className="st-empty">Loading…</p></div>
        ) : shown.length === 0 ? (
          <div className="st-card"><p className="st-empty">No one had working days in {monthLabel(yearMonth)}{dept ? ` in ${dept}` : ''}.</p></div>
        ) : (
          <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
            <div className="st-kpis">
              {tiles.map(t => (
                <div className="st-kpi" key={t.label}>
                  <div className="st-kpi-label">{t.icon}{t.label}</div>
                  <div className="st-kpi-value">{t.value}</div>
                  {t.delta && <div className={`st-kpi-delta ${t.delta.tone}`}>{t.delta.text}</div>}
                </div>
              ))}
            </div>

            {flagged.length > 0 && (
              <section className="st-card st-flags" style={{ marginBottom: 16 }}>
                <div className="st-card-head">
                  <Coffee size={18} style={{ color: '#b45309', alignSelf: 'center' }} />
                  <h2>Worth a look</h2>
                  <p>Break and timer patterns this month · the minimum break is already deducted, so this is for a friendly check-in</p>
                </div>
                <ul>
                  {flagged.map(({ s, flags }) => (
                    <li key={s.employee.id}>
                      <Link to={`/admin/employees/${s.employee.id}/stats?month=${yearMonth}`} className="st-person">
                        <EmployeeAvatar employee={s.employee} size={26} />
                        <span>{s.employee.full_name}</span>
                      </Link>
                      <span>{flags.join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="st-card" style={{ marginBottom: 16 }}>
              <div className="st-card-head">
                <h2>Day breakdown by person</h2>
                <p>Share of each person’s working days · attendance % on the right</p>
                <ul className="st-legend">
                  {(Object.keys(KIND_META) as DayKind[]).map(k => (
                    <li key={k}><span className="st-swatch" style={{ background: KIND_META[k].color }} />{KIND_META[k].label}</li>
                  ))}
                </ul>
              </div>
              <BreakdownBars rows={byAttendance.map(s => ({
                id: s.employee.id, name: s.employee.full_name, note: fmtPct(s.month.attendanceRate),
                values: { on_time: s.month.onTime, late: s.month.late, leave: s.month.leave, absent: s.month.absent },
              }))} />
            </section>

            <div className="st-grid st-grid-2">
              <section className="st-card">
                <div className="st-card-head">
                  <h2>Avg. hours per day</h2>
                  <p>Breaks excluded · line = team average</p>
                </div>
                <RankBars
                  rows={byHours.map(s => ({ id: s.employee.id, name: s.employee.full_name, value: s.month.present ? s.month.avgWorked / 3600 : null,
                    tip: <>Avg. {fmtHM(s.month.avgWorked)} a day · total {fmtHM(s.month.worked)}</> }))}
                  max={Math.ceil(maxHours)}
                  format={v => fmtHM(v * 3600)}
                  reference={team.present ? team.avgWorked / 3600 : null}
                  referenceLabel="Team"
                />
              </section>
              <section className="st-card">
                <div className="st-card-head">
                  <h2>On-time rate</h2>
                  <p>Days on time ÷ days present · line = team rate</p>
                </div>
                <RankBars
                  rows={byOnTime.map(s => ({ id: s.employee.id, name: s.employee.full_name, value: s.month.onTimeRate,
                    tip: <>{fmtPct(s.month.onTimeRate)} on time · {fmtDays(s.month.late)} late{s.month.avgCheckIn != null ? ` · avg. in ${fmtMinutes(s.month.avgCheckIn)}` : ''}</> }))}
                  max={1}
                  format={v => `${Math.round(v * 100)}%`}
                  reference={team.onTimeRate}
                  referenceLabel="Team"
                />
              </section>
            </div>

            <div className="st-grid st-grid-2">
              <section className="st-card">
                <div className="st-card-head">
                  <h2>Team attendance by month</h2>
                  <p>{trend.length > 1 ? `Last ${trend.length} months` : 'Builds up as more months are tracked'}</p>
                </div>
                <MonthColumns
                  points={trend.map(t => ({ yearMonth: t.yearMonth, value: t.totals.attendanceRate, tip: monthTip(t.yearMonth, t.totals) }))}
                  current={yearMonth} max={1} ticks={[0, 0.25, 0.5, 0.75, 1]} format={v => `${Math.round(v * 100)}%`}
                />
              </section>
              <section className="st-card">
                <div className="st-card-head">
                  <h2>Team avg. hours per day by month</h2>
                  <p>{trend.length > 1 ? `Last ${trend.length} months` : 'Builds up as more months are tracked'}</p>
                </div>
                <MonthColumns
                  points={trend.map(t => ({ yearMonth: t.yearMonth, value: t.totals.present ? t.totals.avgWorked / 3600 : null, tip: monthTip(t.yearMonth, t.totals) }))}
                  current={yearMonth} max={10} ticks={[0, 2, 4, 6, 8, 10]} format={v => `${Math.round(v * 10) / 10}h`}
                />
              </section>
            </div>

            <section className="st-card" style={{ marginBottom: 16 }}>
              <div className="st-card-head">
                <h2>Everyone, side by side</h2>
                <p>Click a column to sort · click a name for their full statistics</p>
              </div>
              <div className="st-table-wrap">
                <table className="st-table rt">
                  <thead>
                    <tr>
                      {COLUMNS.map(c => (
                        <th key={c.key} title={c.title} aria-sort={sort.key === c.key ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
                          <button
                            type="button" className="st-sort"
                            onClick={() => setSort(s => ({ key: c.key, asc: s.key === c.key ? !s.asc : c.key === 'name' || c.key === 'checkIn' || c.key === 'late' || c.key === 'absent' }))}
                          >
                            {c.label}
                            {sort.key === c.key && (sort.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(s => <MemberRow key={s.employee.id} s={s} yearMonth={yearMonth} />)}
                    <tr className="is-current">
                      <td>Team ({team.people})</td>
                      <td>{fmtPct(team.attendanceRate)}</td>
                      <td>{fmtPct(team.onTimeRate)}</td>
                      <td>{fmtDays(team.present)} / {fmtDays(team.workingDays - team.leave)}</td>
                      <td>{fmtDays(team.late)}</td>
                      <td>{fmtDays(team.leave)}</td>
                      <td>{fmtDays(team.absent)}</td>
                      <td>{fmtHM(team.worked)}</td>
                      <td>{fmtHM(team.avgWorked)}</td>
                      <td>{team.expected ? signedHM(team.worked - team.expected) : '—'}</td>
                      <td>—</td>
                      <td>{team.topUpDays}{team.noBreakDays ? ` (${team.noBreakDays})` : ''}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function MemberRow({ s, yearMonth }: { s: MemberStats; yearMonth: string }) {
  const m: MonthStats = s.month
  const e = s.employee
  return (
    <tr>
      <td>
        <Link to={`/admin/employees/${e.id}/stats?month=${yearMonth}`} className="st-person">
          <EmployeeAvatar employee={e} size={26} />
          <span>
            {e.full_name}
            <small>{[e.employee_code, e.designation].filter(Boolean).join(' · ')}</small>
          </span>
        </Link>
      </td>
      <td>{fmtPct(m.attendanceRate)}</td>
      <td>{fmtPct(m.onTimeRate)}</td>
      <td>{fmtDays(m.present)} / {fmtDays(m.workingDays - m.leave)}</td>
      <td>{fmtDays(m.late)}</td>
      <td>{fmtDays(m.leave)}</td>
      <td>{fmtDays(m.absent)}</td>
      <td>{fmtHM(m.worked)}</td>
      <td>{fmtHM(m.avgWorked)}</td>
      <td>{m.expected ? signedHM(m.worked - m.expected) : '—'}</td>
      <td>{m.avgCheckIn != null ? fmtMinutes(m.avgCheckIn) : '—'}</td>
      <td>{m.topUpDays}{m.noBreakDays ? ` (${m.noBreakDays})` : ''}</td>
    </tr>
  )
}

function monthTip(yearMonth: string, t: ReturnType<typeof teamTotals>) {
  return (
    <>
      <b>{monthLabel(yearMonth)}</b>
      <div>Attendance {fmtPct(t.attendanceRate)} · On time {fmtPct(t.onTimeRate)}</div>
      <div>Avg. {fmtHM(t.avgWorked)} a day · {t.people} people</div>
    </>
  )
}

const signedHM = (s: number) => `${s >= 0 ? '+' : '−'}${fmtHM(Math.abs(s))}`
