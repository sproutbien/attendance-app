import type { CSSProperties } from 'react'
import { MARK_STYLES, isSunday, localDate, monthDates } from '../lib/calendar'
import type { DayMark } from '../lib/calendar'

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** Admin view: one row per employee, one column per day of the month */
export default function AttendanceCalendarGrid({ yearMonth, employees, holidays, holidayFor, markFor }: {
  yearMonth: string
  employees: { id: string; full_name: string }[]
  holidays: Map<string, string>                                        // public holidays (column headings)
  holidayFor?: (employeeId: string, date: string) => string | undefined // incl. their choice holidays
  markFor: (employeeId: string, date: string) => DayMark
}) {
  const dates = monthDates(yearMonth)
  const today = localDate()

  return (
    <>
    <p className="phone-only" style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>Swipe sideways to see the whole month →</p>
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: '0.75rem' }}>
        <thead>
          <tr>
            <th style={{ ...nameCell, background: '#fff', zIndex: 2 }} />
            {dates.map(date => {
              const holiday = holidays.get(date)
              return (
                <th
                  key={date}
                  title={holiday ? `Public holiday — ${holiday}` : undefined}
                  style={{
                    minWidth: 28, padding: '0.25rem 0', borderRadius: 6, fontWeight: 600,
                    background: holiday ? '#dbeafe' : 'transparent',
                    color: holiday ? '#1d4ed8' : isSunday(date) ? '#94a3b8' : '#64748b',
                    outline: date === today ? '2px solid var(--brand-600)' : undefined,
                  }}
                >
                  <div style={{ fontSize: '0.625rem', fontWeight: 500 }}>
                    {WEEKDAY_INITIALS[new Date(date + 'T00:00:00').getDay()]}
                  </div>
                  {Number(date.slice(8))}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {employees.map(emp => (
            <tr key={emp.id}>
              <td style={nameCell} title={emp.full_name}>{emp.full_name}</td>
              {dates.map(date => {
                const mark = markFor(emp.id, date)
                const s = MARK_STYLES[mark]
                const holiday = holidayFor ? holidayFor(emp.id, date) : holidays.get(date)
                return (
                  <td
                    key={date}
                    title={`${emp.full_name} · ${date}${s.label ? ` · ${s.label}` : ''}${holiday ? ` (${holiday})` : ''}`}
                    style={{
                      height: 28, minWidth: 28, padding: 0, borderRadius: 6, boxSizing: 'border-box',
                      textAlign: 'center', fontWeight: 700, fontSize: '0.625rem',
                      background: mark === 'none' ? '#fff' : s.bg,
                      color: s.text,
                      border: s.border ?? (mark === 'none' ? '1px solid #f1f5f9' : '1px solid transparent'),
                    }}
                  >
                    {s.code}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}

const nameCell: CSSProperties = {
  position: 'sticky', left: 0, zIndex: 1,
  background: '#fff', textAlign: 'left',
  padding: '0 0.75rem 0 0.25rem',
  fontWeight: 600, fontSize: '0.8125rem', color: '#1e293b',
  maxWidth: 160, minWidth: 120,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
