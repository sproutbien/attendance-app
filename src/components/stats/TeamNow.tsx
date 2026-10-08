import { Link } from 'react-router-dom'
import { CalendarClock, CalendarX, CircleCheck, ClipboardCheck, FilePen, Hourglass } from 'lucide-react'
import type { ReactNode } from 'react'
import EmployeeAvatar from '../employees/EmployeeAvatar'
import { isSunday } from '../../lib/calendar'
import { holidayName } from '../../lib/holidays'
import { LEAVE_TYPE_LABELS, addDays } from '../../lib/leave'
import { WEEK_DAYS } from '../../hooks/useTeamNow'
import type { TeamNow, WeekLeave } from '../../hooks/useTeamNow'
import type { TeamMember } from '../../hooks/useTeamStats'

// Admin Team Stats: "right now" cards — they ignore the month picker.

const dayName = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

const onDate = (l: WeekLeave, d: string) => l.start_date <= d && l.end_date >= d

/** Today's head count, who's on leave today, and leave / holidays over the next six days. */
export function WhosOut({ now, people }: { now: TeamNow; people: TeamMember[] }) {
  const { today } = now
  const employed = (e: TeamMember, d: string) => (!e.joining_date || e.joining_date <= d) && (!e.last_working_day || e.last_working_day >= d)
  const byId = new Map(people.map(p => [p.id, p]))
  const leavesOn = (d: string) => now.leaves.filter(l => onDate(l, d) && byId.has(l.employee_id) && employed(byId.get(l.employee_id)!, d))

  // Today
  const staff = people.filter(p => employed(p, today))
  const publicHoliday = now.holidays.common.get(today)
  const offToday = isSunday(today) ? 'Sunday' : publicHoliday
  const outToday = leavesOn(today)
  const fullOut = new Set(outToday.filter(l => l.duration === 'full' && l.status === 'approved').map(l => l.employee_id))
  const inNow = staff.filter(p => now.checkedIn.has(p.id))
  const notIn = staff.filter(p => !now.checkedIn.has(p.id) && !fullOut.has(p.id) && !holidayName(now.holidays, p.id, today))

  // Rest of the week
  const upcoming = Array.from({ length: WEEK_DAYS - 1 }, (_, i) => addDays(today, i + 1)).map(d => ({
    date: d, holiday: now.holidays.common.get(d), leaves: leavesOn(d),
  })).filter(d => d.holiday || (d.leaves.length > 0 && !isSunday(d.date)))

  return (
    <section className="st-card st-now st-no-print">
      <div className="st-card-head">
        <h2>Who’s out</h2>
        <p>Today, {dayName(today)} · next {WEEK_DAYS - 1} days</p>
      </div>

      {offToday ? (
        <p className="st-now-off"><CalendarX size={15} /> {offToday} — no one is due in today</p>
      ) : (
        <div className="st-facts st-now-facts">
          <div className="st-fact"><span>In</span><b>{inNow.length}<small> / {staff.length - fullOut.size}</small></b></div>
          <div className="st-fact"><span>On leave</span><b>{outToday.filter(l => l.status === 'approved').length}</b></div>
          <div className="st-fact"><span>Not in yet</span><b>{notIn.length}</b></div>
        </div>
      )}

      {!offToday && notIn.length > 0 && (
        <p className="st-now-missing" title={notIn.map(p => p.full_name).join(', ')}>
          <b>Not in yet:</b> {notIn.map(p => p.full_name.split(' ')[0]).join(', ')}
        </p>
      )}

      <h3 className="st-now-h">On leave today</h3>
      {outToday.length === 0 ? (
        <p className="st-now-none">No one</p>
      ) : (
        <ul className="st-now-list">
          {outToday.map(l => <LeaveRow key={l.id} l={l} person={byId.get(l.employee_id)!} />)}
        </ul>
      )}

      <h3 className="st-now-h">Coming up</h3>
      {upcoming.length === 0 ? (
        <p className="st-now-none">No leave or holidays this week</p>
      ) : (
        <ul className="st-now-days">
          {upcoming.map(d => (
            <li key={d.date}>
              <span className="st-now-date">{dayName(d.date)}</span>
              <span className="st-now-who">
                {d.holiday && <span className="st-now-tag is-holiday">{d.holiday}</span>}
                {d.leaves.map(l => (
                  <span key={l.id} className={`st-now-tag${l.status === 'pending' ? ' is-pending' : ''}`}
                    title={`${byId.get(l.employee_id)!.full_name} · ${leaveText(l)}`}>
                    {byId.get(l.employee_id)!.full_name.split(' ')[0]}{l.duration === 'half' ? ' ½' : ''}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {now.leaves.some(l => l.status === 'pending') && (
        <p className="st-note"><span className="st-now-tag is-pending">Dashed</span> = not approved yet</p>
      )}
    </section>
  )
}

function leaveText(l: WeekLeave) {
  const type = LEAVE_TYPE_LABELS[l.leave_type]
  const half = l.duration === 'half' ? ` · ${l.half_day_session === 'morning' ? 'morning' : 'afternoon'} off` : ''
  return `${type}${half}${l.status === 'pending' ? ' · awaiting approval' : ''}`
}

function LeaveRow({ l, person }: { l: WeekLeave; person: TeamMember }) {
  const back = l.end_date > l.start_date ? `back ${dayName(addDays(l.end_date, 1))}` : null
  return (
    <li className={l.status === 'pending' ? 'is-pending' : undefined}>
      <EmployeeAvatar employee={person} size={26} />
      <span className="st-now-name">
        {person.full_name}
        <small>{leaveText(l)}</small>
      </span>
      {back && <em>{back}</em>}
    </li>
  )
}

/** Approvals waiting on an admin, as a slim bar of links. Same counts as the sidebar badges. */
export function PendingBar({ pending }: { pending: TeamNow['pending'] }) {
  const items: { to: string; icon: ReactNode; label: string; n: number }[] = [
    { to: '/admin/leave', icon: <CalendarClock size={15} />, label: 'leave request', n: pending.leave },
    { to: '/admin/leave', icon: <CalendarX size={15} />, label: 'cancelled leave', n: pending.cancelled },
    { to: '/admin/corrections', icon: <FilePen size={15} />, label: 'correction', n: pending.corrections },
    { to: '/admin/corrections', icon: <ClipboardCheck size={15} />, label: 'shift change', n: pending.shiftChanges },
    { to: '/admin/corrections', icon: <Hourglass size={15} />, label: 'permission', n: pending.permissions },
  ]
  const waiting = items.filter(i => i.n > 0)
  return (
    <section className="st-pending st-no-print" aria-label="Waiting for approval">
      <h2>Waiting for approval</h2>
      {waiting.length === 0 ? (
        <span className="st-pending-clear"><CircleCheck size={15} /> All caught up</span>
      ) : (
        <ul>
          {waiting.map(i => (
            <li key={i.label}>
              <Link to={i.to}>{i.icon}<b>{i.n}</b> {i.label}{i.n === 1 || i.label === 'cancelled leave' ? '' : 's'}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
