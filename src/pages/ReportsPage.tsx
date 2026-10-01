import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarCheck, CalendarDays, ChartColumn, Clock, DoorOpen, Download, Target, Timer } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { MonthGrid, MonthPicker, CalendarLegend } from '../components/MonthCalendar'
import { CheckInChart, DailyHoursChart, DayDonut, TrendChart } from '../components/stats/Charts'
import { useAuth } from '../contexts/AuthContext'
import { useMonthCalendar } from '../hooks/useMonthCalendar'
import { useMyStats } from '../hooks/useMyStats'
import { useLeaveBalances } from '../hooks/useLeaveBalances'
import { useMyShift } from '../hooks/useShifts'
import { TRACKING_START, currentYearMonth, monthLabel } from '../lib/calendar'
import { fmtHM } from '../lib/breaks'
import { fmtDays, fmtMinutes, fmtPct } from '../lib/stats'
import type { MonthStats } from '../lib/stats'
import { minutesOf, shiftHours } from '../lib/shifts'
import { LEAVE_TYPE_LABELS } from '../lib/leave'
import type { LeaveTypeCode } from '../types'
import '../styles/stats.css'

const PAID_TYPES: LeaveTypeCode[] = ['casual', 'sick', 'earned']

/** Employee: month statistics, charts, a 6-month trend and the attendance calendar. */
export default function ReportsPage() {
  const { employee } = useAuth()
  const thisMonth = currentYearMonth()
  const [params, setParams] = useSearchParams()
  const asked = params.get('month')
  const yearMonth = asked && /^\d{4}-\d{2}$/.test(asked) && asked <= thisMonth && asked >= TRACKING_START.slice(0, 7) ? asked : thisMonth
  const setMonth = (ym: string) => setParams(ym === thisMonth ? {} : { month: ym }, { replace: true })

  const { stats, loading, error } = useMyStats(yearMonth)
  const { shift } = useMyShift()
  const balances = useLeaveBalances(employee?.id)
  const calendar = useMonthCalendar(yearMonth, employee?.id)

  usePrintSetup(`Attendance report – ${monthLabel(yearMonth)} – ${employee?.full_name ?? ''}`)

  const m = stats?.month
  const prev = stats?.previous

  return (
    <AppLayout wide>
      <div className="sb-container st-page">
        {/* Shown only when printing / saving as PDF */}
        <div className="st-print-only" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '2px solid var(--green-dark)', paddingBottom: 10 }}>
            <img src="/logo.jpg" alt="" style={{ height: 34 }} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-strong)' }}>Attendance report · {monthLabel(yearMonth)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {employee?.full_name}{employee?.employee_code ? ` (${employee.employee_code})` : ''}
                {employee?.designation ? ` · ${employee.designation}` : ''}
                {` · ${shift.name} shift ${shiftHours(shift)}`}
                {` · Generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </div>
            </div>
          </div>
        </div>

        <div className="st-top st-no-print">
          <div>
            <h1>My Statistics</h1>
            <span className="st-sub">{shift.name} shift · {shiftHours(shift)}</span>
          </div>
          <div className="st-top-actions">
            <MonthPicker yearMonth={yearMonth} onChange={ym => ym >= TRACKING_START.slice(0, 7) && setMonth(ym)} max={thisMonth} compact />
            <button className="st-btn" onClick={() => window.print()} disabled={!m}>
              <Download size={15} /> Download PDF
            </button>
          </div>
        </div>

        {error ? (
          <div className="st-card"><p className="st-empty">{error}</p></div>
        ) : loading && !m ? (
          <div className="st-card"><p className="st-empty">Loading…</p></div>
        ) : m && (
          <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
            <Kpis m={m} prev={prev ?? null} />

            <div className="st-grid st-grid-2">
              <section className="st-card">
                <div className="st-card-head">
                  <h2>Day breakdown</h2>
                  <p>Working days so far, by what they were</p>
                </div>
                <DayDonut stats={m} />
              </section>

              <section className="st-card">
                <div className="st-card-head">
                  <h2>Punctuality</h2>
                  <ul className="st-legend">
                    <li><span className="st-swatch is-dot" style={{ background: 'var(--c-on-time)' }} />On time</li>
                    <li><span className="st-swatch is-dot" style={{ background: 'var(--c-late)' }} />Late</li>
                    <li><span className="st-swatch is-tick" style={{ background: 'var(--text-muted)' }} />Late after {fmtMinutes(minutesOf(shift.late_after))}</li>
                  </ul>
                </div>
                <div className="st-facts">
                  <Fact label="On-time rate" value={fmtPct(m.onTimeRate)} />
                  <Fact label="Days late" value={fmtDays(m.late)} />
                  <Fact label="Avg. check-in" value={m.avgCheckIn != null ? fmtMinutes(m.avgCheckIn) : '—'} />
                  <Fact label="Avg. check-out" value={m.avgCheckOut != null ? fmtMinutes(m.avgCheckOut) : '—'} />
                </div>
                <CheckInChart days={m.days} yearMonth={yearMonth} />
              </section>
            </div>

            <section className="st-card" style={{ marginBottom: 16 }}>
              <div className="st-card-head">
                <h2>Daily work hours</h2>
                <p>Hours worked (breaks excluded) against each day’s shift hours</p>
                <ul className="st-legend">
                  <li><span className="st-swatch" style={{ background: 'var(--c-hours)' }} />Worked</li>
                  <li><span className="st-swatch is-tick" />Shift hours</li>
                </ul>
              </div>
              <DailyHoursChart days={m.days} yearMonth={yearMonth} />
              <DailyTable m={m} />
            </section>

            <div className="st-grid st-grid-2">
              <section className="st-card">
                <div className="st-card-head">
                  <h2>Leave</h2>
                  <p>Taken in {monthLabel(yearMonth)} · balance today</p>
                </div>
                {PAID_TYPES.map(t => {
                  const b = balances.balances.find(x => x.leave_type === t)
                  return (
                    <div className="st-leave-row" key={t}>
                      <span className="st-swatch" style={{ background: 'var(--c-leave)' }} />
                      <span>{LEAVE_TYPE_LABELS[t]}</span>
                      <b>{fmtDays(m.leaveByType[t])} taken</b>
                      <em>{b?.available != null ? `${fmtDays(Number(b.available))} left` : '—'}</em>
                    </div>
                  )
                })}
                <div className="st-leave-row">
                  <span className="st-swatch" style={{ background: 'var(--c-absent)' }} />
                  <span>Loss of pay</span>
                  <b>{fmtDays(m.leaveByType.lop)} taken</b>
                  <em>unpaid</em>
                </div>
                <p className="st-note">Late check-ins that turned into a half day count as loss of pay.</p>
              </section>

              <section className="st-card">
                <div className="st-card-head">
                  <h2>Breaks</h2>
                  <p>Time on break during work hours</p>
                </div>
                <div className="st-facts" style={{ marginBottom: 0 }}>
                  <Fact label="Total breaks" value={fmtHM(m.breaks)} />
                  <Fact label="Avg. per day" value={fmtHM(m.avgBreak)} />
                  <Fact label="Days with a break" value={String(m.days.filter(d => d.breaks > 0).length)} />
                  <Fact label="Longest" value={fmtHM(Math.max(0, ...m.days.map(d => d.breaks)))} />
                </div>
              </section>
            </div>

            <section className="st-card" style={{ marginBottom: 16 }}>
              <div className="st-card-head">
                <h2>Month by month</h2>
                <p>{stats!.trend.length > 1 ? `Last ${stats!.trend.length} months · total hours worked` : 'Builds up as more months are tracked'}</p>
              </div>
              <TrendChart trend={stats!.trend} current={yearMonth} />
              <TrendTable trend={stats!.trend} current={yearMonth} />
            </section>
          </div>
        )}

        <section className="st-card st-calendar">
          <div className="st-card-head">
            <CalendarDays size={18} style={{ color: 'var(--green-dark)', alignSelf: 'center' }} />
            <h2>Calendar</h2>
          </div>
          {calendar.error ? <p className="st-empty">{calendar.error}</p>
            : calendar.loading || !employee ? <p className="st-empty">Loading…</p>
            : (
              <>
                <MonthGrid yearMonth={yearMonth} markFor={d => calendar.markFor(employee.id, d)} noteFor={d => calendar.holidays.get(d)} compact />
                <div style={{ marginTop: 14 }}>
                  <CalendarLegend marks={['leave', 'half_leave', 'leave_pending', 'holiday', 'present', 'late', 'absent', 'sunday']} compact />
                </div>
              </>
            )}
        </section>
      </div>
    </AppLayout>
  )
}

// ── KPI tiles ─────────────────────────────────────────────────

function Kpis({ m, prev }: { m: MonthStats; prev: MonthStats | null }) {
  const vsShift = m.worked - m.expected
  const prevName = prev ? new Date(prev.yearMonth + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' }) : ''
  // Averages and rates compare fairly with a full previous month; totals wouldn't
  const delta = (cur: number | null, old: number | null | undefined, fmt: (n: number) => string, upIsGood = true) => {
    if (!prev || cur == null || old == null || prev.present === 0) return null
    const d = cur - old
    if (Math.abs(d) < 1e-9) return { text: `Same as ${prevName}`, tone: '' }
    return { text: `${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))} vs ${prevName}`, tone: (d > 0) === upIsGood ? 'is-good' : 'is-bad' }
  }
  const tiles: { icon: ReactNode; label: string; value: ReactNode; delta?: { text: string; tone: string } | null }[] = [
    { icon: <Clock size={14} />, label: 'Total work hours', value: fmtHM(m.worked) },
    { icon: <ChartColumn size={14} />, label: 'Avg. hours / day', value: fmtHM(m.avgWorked),
      delta: delta(m.avgWorked, prev?.avgWorked, fmtHM) },
    { icon: <CalendarCheck size={14} />, label: 'Days present', value: <>{fmtDays(m.present)}<small>/ {fmtDays(m.workingDays - m.leave)}</small></>,
      delta: delta(m.attendanceRate, prev?.attendanceRate, n => `${Math.round(n * 100)} pts`) },
    { icon: <DoorOpen size={14} />, label: 'Leaves', value: <>{fmtDays(m.leave)}<small>day{m.leave === 1 ? '' : 's'}</small></> },
    { icon: <Timer size={14} />, label: 'On-time rate', value: fmtPct(m.onTimeRate),
      delta: delta(m.onTimeRate, prev?.onTimeRate, n => `${Math.round(n * 100)} pts`) },
    { icon: <Target size={14} />, label: 'Hours vs shift', value: m.expected ? `${vsShift >= 0 ? '+' : '−'}${fmtHM(Math.abs(vsShift))}` : '—',
      delta: m.expected ? { text: vsShift >= 0 ? 'Above shift hours' : 'Below shift hours', tone: vsShift >= 0 ? 'is-good' : 'is-bad' } : null },
  ]
  return (
    <div className="st-kpis">
      {tiles.map(t => (
        <div className="st-kpi" key={t.label}>
          <div className="st-kpi-label">{t.icon}{t.label}</div>
          <div className="st-kpi-value">{t.value}</div>
          {t.delta && <div className={`st-kpi-delta ${t.delta.tone}`}>{t.delta.text}</div>}
        </div>
      ))}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="st-fact"><span>{label}</span><b>{value}</b></div>
}

// ── Tables (the charts' numbers, readable without hovering) ──

const KIND_LABEL = { on_time: 'On time', late: 'Late', leave: 'Leave', absent: 'Absent' } as const

function DailyTable({ m }: { m: MonthStats }) {
  if (!m.days.length) return null
  return (
    <details className="st-details">
      <summary>Show day-by-day table</summary>
      <div className="st-table-wrap">
        <table className="st-table">
          <thead>
            <tr><th>Date</th><th>Status</th><th>Check-in</th><th>Check-out</th><th>Breaks</th><th>Worked</th><th>Shift</th><th>Difference</th></tr>
          </thead>
          <tbody>
            {m.days.map(d => {
              const diff = d.worked - d.expected
              return (
                <tr key={d.date}>
                  <td>{new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  <td>{d.kind ? KIND_LABEL[d.kind] : '—'}{d.half ? ' · ½ leave' : ''}</td>
                  <td>{d.checkIn != null ? fmtMinutes(d.checkIn) : '—'}</td>
                  <td>{d.checkOut != null ? fmtMinutes(d.checkOut) : '—'}</td>
                  <td>{d.breaks ? fmtHM(d.breaks) : '—'}</td>
                  <td>{d.worked ? fmtHM(d.worked) : '—'}</td>
                  <td>{d.expected ? fmtHM(d.expected) : '—'}</td>
                  <td>{d.expected && d.worked ? `${diff >= 0 ? '+' : '−'}${fmtHM(Math.abs(diff))}` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function TrendTable({ trend, current }: { trend: MonthStats[]; current: string }) {
  return (
    <div className="st-table-wrap" style={{ marginTop: 12 }}>
      <table className="st-table">
        <thead>
          <tr>
            <th>Month</th><th>Total hours</th><th>Avg. / day</th><th>Present</th><th>Attendance</th>
            <th>On time</th><th>Late</th><th>Leave</th><th>Absent</th><th>Breaks</th>
          </tr>
        </thead>
        <tbody>
          {[...trend].reverse().map(t => (
            <tr key={t.yearMonth} className={t.yearMonth === current ? 'is-current' : undefined}>
              <td>{monthLabel(t.yearMonth)}</td>
              <td>{fmtHM(t.worked)}</td>
              <td>{fmtHM(t.avgWorked)}</td>
              <td>{fmtDays(t.present)} / {fmtDays(t.workingDays - t.leave)}</td>
              <td>{fmtPct(t.attendanceRate)}</td>
              <td>{fmtPct(t.onTimeRate)}</td>
              <td>{fmtDays(t.late)}</td>
              <td>{fmtDays(t.leave)}</td>
              <td>{fmtDays(t.absent)}</td>
              <td>{fmtHM(t.breaks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** While printing: name the PDF, open collapsed tables, force the light theme. */
function usePrintSetup(title: string) {
  useEffect(() => {
    let oldTitle = document.title
    const opened: HTMLDetailsElement[] = []
    let theme: { el: HTMLElement; value: string | null } | null = null
    const before = () => {
      oldTitle = document.title
      document.title = title
      document.querySelectorAll<HTMLDetailsElement>('details.st-details:not([open])').forEach(d => { d.open = true; opened.push(d) })
      const app = document.querySelector<HTMLElement>('.sb-app')
      if (app) { theme = { el: app, value: app.getAttribute('data-theme') }; app.setAttribute('data-theme', 'light') }
    }
    const after = () => {
      document.title = oldTitle
      opened.splice(0).forEach(d => { d.open = false })
      if (theme) { theme.value == null ? theme.el.removeAttribute('data-theme') : theme.el.setAttribute('data-theme', theme.value); theme = null }
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after) }
  }, [title])
}
