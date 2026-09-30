import { useState } from 'react'
import type { CSSProperties } from 'react'
import AppLayout from '../components/AppLayout'
import { MonthGrid, MonthPicker, CalendarLegend } from '../components/MonthCalendar'
import { useAuth } from '../contexts/AuthContext'
import { useMonthCalendar } from '../hooks/useMonthCalendar'
import { MARK_STYLES, currentYearMonth, localDate, monthDates } from '../lib/calendar'
import type { DayMark } from '../lib/calendar'

const COUNTED: DayMark[] = ['present', 'late', 'leave', 'leave_pending', 'holiday', 'absent']

export default function ReportsPage() {
  const { employee } = useAuth()
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const { holidays, markFor, statusFor, loading, error } = useMonthCalendar(yearMonth, employee?.id)

  const myMark = (date: string) => markFor(employee!.id, date)
  const counts = new Map<DayMark, number>()
  const add = (m: DayMark, n: number) => counts.set(m, (counts.get(m) ?? 0) + n)
  if (!loading && employee) {
    const today = localDate()
    for (const d of monthDates(yearMonth)) {
      const m = myMark(d)
      if (m !== 'half_leave') { add(m, 1); continue }
      // Half-day leave: half leave, half whatever happened in the other session
      add('leave', 0.5)
      const status = statusFor(employee.id, d)
      if (status === 'present' || status === 'late') add(status, 0.5)
      else if (d < today) add('absent', 0.5)
    }
  }

  return (
    <AppLayout>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-strong, #1e293b)' }}>My Calendar</h2>
          <MonthPicker yearMonth={yearMonth} onChange={setYearMonth} compact />
        </div>

        {error ? (
          <p style={{ margin: 0, fontSize: 13, color: '#ef4444' }}>{error}</p>
        ) : loading || !employee ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint, #94a3b8)' }}>Loading…</p>
        ) : (
          <>
            <MonthGrid yearMonth={yearMonth} markFor={myMark} noteFor={d => holidays.get(d)} compact />

            <div style={{ marginTop: '0.875rem' }}>
              <CalendarLegend marks={['leave', 'half_leave', 'leave_pending', 'holiday', 'present', 'late', 'absent', 'sunday']} compact />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginTop: '1rem' }}>
              {COUNTED.map(m => {
                const s = MARK_STYLES[m]
                const strong = m === 'leave' || m === 'holiday'
                return (
                  <div key={m} style={{
                    background: s.bg,
                    border: s.border,
                    borderRadius: 8,
                    padding: '0.5rem 0.625rem',
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: s.text, lineHeight: 1 }}>{counts.get(m) ?? 0}</div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: s.text, opacity: strong ? 0.9 : 0.8, marginTop: '0.25rem' }}>{s.label}</div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  )
}

const card: CSSProperties = {
  background: 'var(--surface, #fff)',
  borderRadius: 14,
  padding: '1.25rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}
