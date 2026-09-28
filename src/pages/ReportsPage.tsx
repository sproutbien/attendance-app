import { useState } from 'react'
import type { CSSProperties } from 'react'
import AppLayout from '../components/AppLayout'
import { MonthGrid, MonthPicker, CalendarLegend } from '../components/MonthCalendar'
import { useAuth } from '../contexts/AuthContext'
import { useMonthCalendar } from '../hooks/useMonthCalendar'
import { MARK_STYLES, currentYearMonth, monthDates } from '../lib/calendar'
import type { DayMark } from '../lib/calendar'

const COUNTED: DayMark[] = ['present', 'late', 'leave', 'leave_pending', 'holiday', 'absent']

export default function ReportsPage() {
  const { employee } = useAuth()
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const { holidays, markFor, loading, error } = useMonthCalendar(yearMonth, employee?.id)

  const myMark = (date: string) => markFor(employee!.id, date)
  const counts = new Map<DayMark, number>()
  if (!loading && employee) {
    for (const d of monthDates(yearMonth)) {
      const m = myMark(d)
      counts.set(m, (counts.get(m) ?? 0) + 1)
    }
  }

  return (
    <AppLayout>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-strong, #1e293b)' }}>My Calendar</h2>
          <MonthPicker yearMonth={yearMonth} onChange={setYearMonth} />
        </div>

        {error ? (
          <p style={{ margin: 0, color: '#ef4444' }}>{error}</p>
        ) : loading || !employee ? (
          <p style={{ margin: 0, color: 'var(--text-faint, #94a3b8)' }}>Loading…</p>
        ) : (
          <>
            <MonthGrid yearMonth={yearMonth} markFor={myMark} noteFor={d => holidays.get(d)} />

            <div style={{ marginTop: '1rem' }}>
              <CalendarLegend marks={['leave', 'leave_pending', 'holiday', 'present', 'late', 'absent', 'sunday']} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem', marginTop: '1.25rem' }}>
              {COUNTED.map(m => {
                const s = MARK_STYLES[m]
                const strong = m === 'leave' || m === 'holiday'
                return (
                  <div key={m} style={{
                    background: s.bg,
                    border: s.border,
                    borderRadius: 10,
                    padding: '0.625rem 0.75rem',
                  }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: s.text, lineHeight: 1 }}>{counts.get(m) ?? 0}</div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 500, color: s.text, opacity: strong ? 0.9 : 0.8, marginTop: '0.25rem' }}>{s.label}</div>
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
  borderRadius: 16,
  padding: '1.5rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}
