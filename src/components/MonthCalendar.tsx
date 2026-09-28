import type { CSSProperties } from 'react'
import { MARK_STYLES, monthDates, monthLabel, shiftMonth, weekday, localDate } from '../lib/calendar'
import type { DayMark } from '../lib/calendar'

// ── Month switcher: ‹ September 2026 › ────────────────────────

export function MonthPicker({ yearMonth, onChange, max }: {
  yearMonth: string
  onChange: (yearMonth: string) => void
  max?: string
}) {
  const nextDisabled = max != null && shiftMonth(yearMonth, 1) > max
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <button onClick={() => onChange(shiftMonth(yearMonth, -1))} style={arrowStyle(false)} aria-label="Previous month">‹</button>
      <span style={{ minWidth: 140, textAlign: 'center', fontWeight: 600, color: '#1e293b', fontSize: '0.9375rem' }}>
        {monthLabel(yearMonth)}
      </span>
      <button
        onClick={() => onChange(shiftMonth(yearMonth, 1))}
        disabled={nextDisabled}
        style={arrowStyle(nextDisabled)}
        aria-label="Next month"
      >
        ›
      </button>
    </div>
  )
}

function arrowStyle(disabled: boolean): CSSProperties {
  return {
    width: 32, height: 32, borderRadius: 8,
    border: '1px solid #d1d5db', background: '#fff',
    color: disabled ? '#cbd5e1' : '#374151',
    fontSize: '1.125rem', lineHeight: 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
  }
}

// ── Legend ────────────────────────────────────────────────────

export function CalendarLegend({ marks }: { marks: DayMark[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', fontSize: '0.75rem', color: '#64748b' }}>
      {marks.map(m => {
        const s = MARK_STYLES[m]
        return (
          <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 22, height: 18, borderRadius: 4, padding: '0 3px',
              background: s.bg, color: s.text, border: s.border ?? '1px solid transparent',
              fontSize: '0.625rem', fontWeight: 700, boxSizing: 'border-box',
            }}>
              {s.code}
            </span>
            {s.label}
          </span>
        )
      })}
    </div>
  )
}

// ── Classic 7-column month grid ───────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Short tag shown inside a day cell (cells are narrow on the employee layout)
const CELL_TAGS: Record<DayMark, string> = {
  holiday: 'HOLIDAY', leave: 'LEAVE', leave_pending: 'PENDING',
  present: 'PRESENT', late: 'LATE', absent: 'ABSENT', sunday: '', none: '',
}

export function MonthGrid({ yearMonth, markFor, noteFor, onDayClick }: {
  yearMonth: string
  markFor: (date: string) => DayMark
  noteFor?: (date: string) => string | undefined
  onDayClick?: (date: string) => void
}) {
  const dates = monthDates(yearMonth)
  const leadingBlanks = weekday(dates[0])
  const today = localDate()

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
      {WEEKDAYS.map(d => (
        <div key={d} style={{
          textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          color: d === 'Sun' ? '#94a3b8' : '#64748b', padding: '0.25rem 0',
        }}>
          {d}
        </div>
      ))}

      {Array.from({ length: leadingBlanks }, (_, i) => <div key={`blank-${i}`} />)}

      {dates.map(date => {
        const mark = markFor(date)
        const s = MARK_STYLES[mark]
        const note = noteFor?.(date)
        const strong = mark === 'holiday' || mark === 'leave'
        return (
          <div
            key={date}
            role={onDayClick ? 'button' : undefined}
            tabIndex={onDayClick ? 0 : undefined}
            onClick={onDayClick ? () => onDayClick(date) : undefined}
            onKeyDown={onDayClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDayClick(date) } } : undefined}
            title={[s.label, note].filter(Boolean).join(' — ') || undefined}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
              minHeight: 64, padding: '0.375rem', borderRadius: 8, boxSizing: 'border-box',
              background: mark === 'none' ? '#fff' : s.bg,
              border: s.border ?? (date === today ? '2px solid #16a34a' : '1px solid #e2e8f0'),
              color: strong ? '#fff' : '#1e293b',
              cursor: onDayClick ? 'pointer' : 'default',
              textAlign: 'left', fontFamily: 'inherit', overflow: 'hidden',
            }}
          >
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: strong ? '#fff' : mark === 'sunday' ? '#94a3b8' : '#1e293b' }}>
              {Number(date.slice(8))}
            </span>
            {CELL_TAGS[mark] && (
              <span style={{ fontSize: '0.625rem', fontWeight: 700, color: s.text, letterSpacing: '0.03em' }}>
                {CELL_TAGS[mark]}
              </span>
            )}
            {note && (
              <span style={{
                fontSize: '0.625rem', lineHeight: 1.2, color: strong ? 'rgba(255,255,255,0.9)' : '#64748b',
                width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {note}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
