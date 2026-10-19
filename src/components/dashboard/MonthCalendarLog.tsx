import { useEffect, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { TRACKING_START, localDate, monthDates, monthLabel, shiftMonth } from '../../lib/calendar'
import type { DayMark } from '../../lib/calendar'
import { isCorrectable } from '../../lib/corrections'
import { fmtDays } from '../../lib/stats'
import type { useMonthCalendar } from '../../hooks/useMonthCalendar'
import type { AttendanceRecord } from '../../types'

export const MARK_LABELS: Record<DayMark, string> = {
  present: 'Present', late: 'Late', absent: 'Absent', leave: 'On Leave', half_leave: 'Half-day leave', leave_pending: 'Leave pending',
  holiday: 'Holiday', choice_holiday: 'Choice holiday', sunday: 'Weekly off', none: 'Not checked in',
}

export type LogRow = {
  date: string
  mark: DayMark
  note?: string
  rec?: AttendanceRecord
  worked: number | null   // null → no complete work span to show
  brk: number
  topUp: number           // added to reach the shift's minimum break
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** 26100 → "7h 15m" */
function hm(seconds: number) {
  const m = Math.round(seconds / 60)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

function clockOf(iso: string | null | undefined, short = false) {
  if (!iso) return ''
  const s = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return short ? s.replace(/ [AP]M$/, '') : s
}

/** What the day is called: the holiday's name for holidays, else the status */
function labelOf(r: LogRow) {
  return (r.mark === 'holiday' || r.mark === 'choice_holiday') && r.note ? r.note : MARK_LABELS[r.mark]
}

/** Big line in a calendar cell */
function cellMain(r: LogRow) {
  if (r.worked != null && r.rec?.check_in_time) return hm(r.worked)
  return { sunday: 'Off', absent: 'Absent', leave: 'Leave', leave_pending: 'Leave?', holiday: 'Holiday', choice_holiday: 'Holiday', half_leave: 'Half day', none: '', present: '', late: '' }[r.mark]
}

/** Phone version of the big line: "7.8h" fits a narrow cell */
function cellShort(r: LogRow) {
  if (r.worked != null && r.rec?.check_in_time) return `${(Math.round(r.worked / 360) / 10).toFixed(1).replace(/\.0$/, '')}h`
  return cellMain(r)
}

/** Small line in a calendar cell */
function cellSub(r: LogRow, today: string) {
  if (r.rec?.check_in_time) {
    const out = r.rec.check_out_time ? clockOf(r.rec.check_out_time, true) : r.date === today ? 'now' : '?'
    return `${clockOf(r.rec.check_in_time, true)} – ${out}`
  }
  if (r.mark === 'holiday' || r.mark === 'choice_holiday') return r.note ?? ''
  if (r.mark === 'none') return 'Not checked in'
  return ''
}

const DAY_NOTES: Partial<Record<DayMark, string>> = {
  sunday: 'Sunday is your weekly off.',
  leave: 'You were on approved leave.',
  leave_pending: 'Your leave request for this day is waiting for approval.',
  half_leave: 'Half of this day was approved leave.',
  absent: 'No check-in was recorded for this day.',
  none: 'You haven’t checked in yet.',
}

export default function MonthCalendarLog({ yearMonth, onMonthChange, maxMonth, rows, calendar, pendingCorrections, onCorrect }: {
  yearMonth: string
  onMonthChange: (ym: string) => void
  maxMonth: string
  rows: LogRow[]
  calendar: ReturnType<typeof useMonthCalendar>
  pendingCorrections: Set<string>
  onCorrect: (date: string, rec?: AttendanceRecord) => void
}) {
  const today = localDate()
  const isThisMonth = yearMonth === maxMonth
  const byDate = new Map(rows.map(r => [r.date, r]))

  // Selected day: today in the current month, else the month's latest day with something to show
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => { setPicked(null) }, [yearMonth])
  const selected = (picked && byDate.get(picked)) || byDate.get(today) || rows[0] || null

  const dates = monthDates(yearMonth)
  const lead = (new Date(dates[0] + 'T00:00:00').getDay() + 6) % 7   // Monday-first
  const trail = (7 - ((lead + dates.length) % 7)) % 7

  // Month summary
  const count = (...marks: DayMark[]) => rows.filter(r => marks.includes(r.mark)).length
  const leave = count('leave') + count('half_leave') * 0.5
  const workedDays = rows.filter(r => r.worked != null && r.rec?.check_in_time && r.date !== today)
  const total = rows.reduce((n, r) => n + (r.worked ?? 0), 0)
  const avg = workedDays.length ? workedDays.reduce((n, r) => n + (r.worked ?? 0), 0) / workedDays.length : 0
  const chips = [
    { n: count('present'), label: 'present', cls: 's-present' },
    { n: count('late'), label: 'late', cls: 's-late' },
    { n: leave, label: 'leave', cls: 's-leave' },
    { n: count('absent'), label: 'absent', cls: 's-absent' },
    { n: count('holiday', 'choice_holiday'), label: count('holiday', 'choice_holiday') === 1 ? 'holiday' : 'holidays', cls: 's-holiday' },
  ].filter(c => c.n > 0)

  return (
    <section className="sb-log sb-callog">
      <div className="sb-log-head">
        <CalendarDays size={20} strokeWidth={2} />
        <h2>{isThisMonth ? 'This Month’s Log' : 'Monthly Log'}</h2>
        <div className="sb-monthnav">
          <button onClick={() => onMonthChange(shiftMonth(yearMonth, -1))} disabled={yearMonth <= TRACKING_START.slice(0, 7)} aria-label="Previous month">
            <ChevronLeft size={18} strokeWidth={2.4} />
          </button>
          <span>{monthLabel(yearMonth)}</span>
          <button onClick={() => onMonthChange(shiftMonth(yearMonth, 1))} disabled={isThisMonth} aria-label="Next month">
            <ChevronRight size={18} strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {calendar.error ? (
        <p className="sb-empty">{calendar.error}</p>
      ) : calendar.loading ? (
        <p className="sb-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="sb-empty">No days to show for this month yet.</p>
      ) : (
        <>
          <div className="sb-cal-summary">
            {chips.map(c => <span key={c.label} className={`sb-cal-chip ${c.cls}`}>{fmtDays(c.n)} {c.label}</span>)}
            <span className="sb-cal-total">Worked <b>{hm(total)}</b>{avg > 0 && <> · avg <b>{hm(avg)}</b> a day</>}</span>
          </div>

          <div className="sb-cal-wrap">
            <div className="sb-cal">
              {WEEKDAYS.map(w => <span key={w} className="sb-cal-wd">{w}</span>)}
              {Array.from({ length: lead }, (_, i) => <span key={`lead${i}`} />)}
              {dates.map(date => {
                const r = byDate.get(date)
                const day = Number(date.slice(8))
                if (!r) return <span key={date} className="sb-cal-cell is-empty"><b>{day}</b></span>
                const cls = [
                  'sb-cal-cell', `s-${r.mark}`,
                  date === today ? 'is-today' : '',
                  selected?.date === date ? 'is-picked' : '',
                ].filter(Boolean).join(' ')
                return (
                  <button
                    key={date}
                    type="button"
                    className={cls}
                    onClick={() => setPicked(date)}
                    aria-pressed={selected?.date === date}
                    aria-label={`${day} ${monthLabel(yearMonth)}, ${labelOf(r)}${r.worked != null && r.rec?.check_in_time ? `, ${hm(r.worked)}` : ''}`}
                  >
                    <span className="sb-cal-top"><b>{day}</b><i /></span>
                    <span className="sb-cal-main">{cellMain(r)}</span>
                    <span className="sb-cal-main is-short">{cellShort(r)}</span>
                    <span className="sb-cal-sub">{cellSub(r, today)}</span>
                  </button>
                )
              })}
              {Array.from({ length: trail }, (_, i) => <span key={`trail${i}`} />)}
            </div>

            {selected && (
              <DayDetails
                row={selected}
                today={today}
                pending={pendingCorrections.has(selected.date)}
                onCorrect={() => onCorrect(selected.date, selected.rec)}
              />
            )}
          </div>
        </>
      )}
    </section>
  )
}

function DayDetails({ row, today, pending, onCorrect }: { row: LogRow; today: string; pending: boolean; onCorrect: () => void }) {
  const d = new Date(row.date + 'T00:00:00')
  const rec = row.rec
  const cameIn = !!rec?.check_in_time
  const minutes = (iso: string) => { const t = new Date(iso); return t.getHours() * 60 + t.getMinutes() }

  // Day bar on a 7 AM – 9 PM scale (stretched if the day ran outside it)
  let bar: { left: number; width: number; from: number; to: number } | null = null
  if (cameIn) {
    const inM = minutes(rec!.check_in_time!)
    const outM = rec!.check_out_time ? minutes(rec!.check_out_time) : row.date === today ? minutes(new Date().toISOString()) : inM
    const from = Math.min(420, Math.floor(inM / 60) * 60), to = Math.max(1260, Math.ceil(outM / 60) * 60)
    bar = { left: (inM - from) / (to - from) * 100, width: Math.max(1, (outM - inM) / (to - from) * 100), from, to }
  }
  const hourLabel = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}` }

  return (
    <aside className="sb-cal-day" aria-live="polite">
      <div>
        <div className="sb-cal-day-wd">{d.toLocaleDateString('en-US', { weekday: 'long' })}</div>
        <div className="sb-cal-day-date">{d.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}</div>
      </div>
      <span className={`sb-status s-${row.mark}`}><i />{labelOf(row)}</span>

      {cameIn ? (
        <>
          <dl className="sb-cal-facts">
            <div><dt>Checked in</dt><dd>{clockOf(rec!.check_in_time)}</dd></div>
            <div><dt>Checked out</dt><dd>{rec!.check_out_time ? clockOf(rec!.check_out_time) : row.date === today ? 'Still working' : '—'}</dd></div>
            <div>
              <dt>Break</dt>
              <dd>{row.brk + row.topUp > 0 ? hm(row.brk + row.topUp) : '—'}{row.topUp > 0 && <small className="sb-minbreak-tag" title={`You paused for ${Math.round(row.brk / 60)} min; the minimum break was applied`}>min</small>}</dd>
            </div>
            <div><dt>Worked</dt><dd>{row.worked != null ? hm(row.worked) : '—'}</dd></div>
          </dl>
          {bar && (
            <div className="sb-cal-bar">
              <span><i style={{ left: `${bar.left}%`, width: `${bar.width}%` }} /></span>
              <small><em>{hourLabel(bar.from)}</em><em>{hourLabel((bar.from + bar.to) / 2)}</em><em>{hourLabel(bar.to)}</em></small>
            </div>
          )}
          {row.mark === 'half_leave' && <p className="sb-cal-note">{DAY_NOTES.half_leave}</p>}
        </>
      ) : (
        <p className="sb-cal-note">
          {row.mark === 'holiday' || row.mark === 'choice_holiday' ? `Public holiday${row.note ? ` · ${row.note}` : ''}.` : DAY_NOTES[row.mark] ?? ''}
        </p>
      )}

      <div className="sb-cal-day-foot">
        {!isCorrectable(row.date) ? (
          <p>Corrections can be requested for the last 7 days.</p>
        ) : pending ? (
          <span className="sb-fix-pending">Correction pending</span>
        ) : (
          <button type="button" className="sb-cal-fix" onClick={onCorrect}>Request a correction</button>
        )}
      </div>
    </aside>
  )
}
