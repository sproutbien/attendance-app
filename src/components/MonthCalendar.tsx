import type { CSSProperties } from 'react'
import { MARK_STYLES, monthDates, monthLabel, shiftMonth, weekday, localDate } from '../lib/calendar'
import type { DayMark } from '../lib/calendar'

// ── Month switcher: ‹ September 2026 › ────────────────────────

export function MonthPicker({ yearMonth, onChange, max, compact = false }: {
  yearMonth: string
  onChange: (yearMonth: string) => void
  max?: string
  compact?: boolean   // smaller type for the employee area
}) {
  const nextDisabled = max != null && shiftMonth(yearMonth, 1) > max
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <button onClick={() => onChange(shiftMonth(yearMonth, -1))} style={arrowStyle(false, compact)} aria-label="Previous month">‹</button>
      <span style={{ minWidth: compact ? 110 : 140, textAlign: 'center', fontWeight: compact ? 500 : 600, color: 'var(--text-strong, #1e293b)', fontSize: compact ? 13 : '0.9375rem' }}>
        {monthLabel(yearMonth)}
      </span>
      <button
        onClick={() => onChange(shiftMonth(yearMonth, 1))}
        disabled={nextDisabled}
        style={arrowStyle(nextDisabled, compact)}
        aria-label="Next month"
      >
        ›
      </button>
    </div>
  )
}

// ── Month + year drop-downs with ‹ › arrows ───────────────────

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString([], { month: 'long' }))

export function MonthYearSelect({ yearMonth, onChange, min, max }: {
  yearMonth: string
  onChange: (yearMonth: string) => void
  min: string   // 'YYYY-MM', earliest month offered
  max: string   // 'YYYY-MM', latest month offered
}) {
  const [year, month] = yearMonth.split('-').map(Number)
  const [minY, minM] = min.split('-').map(Number)
  const [maxY, maxM] = max.split('-').map(Number)
  const years = Array.from({ length: maxY - minY + 1 }, (_, i) => maxY - i)
  const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`
  // Keep the month inside min..max when the year changes
  const clamp = (v: string) => (v < min ? min : v > max ? max : v)
  const prevDisabled = yearMonth <= min
  const nextDisabled = yearMonth >= max

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
      <button onClick={() => onChange(shiftMonth(yearMonth, -1))} disabled={prevDisabled} style={arrowStyle(prevDisabled, false)} aria-label="Previous month">‹</button>
      <select aria-label="Month" value={month} onChange={e => onChange(clamp(ym(year, Number(e.target.value))))} style={selectStyle}>
        {MONTH_NAMES.map((name, i) => {
          const m = i + 1
          const out = (year === minY && m < minM) || (year === maxY && m > maxM)
          return <option key={m} value={m} disabled={out}>{name}</option>
        })}
      </select>
      <select aria-label="Year" value={year} onChange={e => onChange(clamp(ym(Number(e.target.value), month)))} style={selectStyle}>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <button onClick={() => onChange(shiftMonth(yearMonth, 1))} disabled={nextDisabled} style={arrowStyle(nextDisabled, false)} aria-label="Next month">›</button>
    </div>
  )
}

const selectStyle: CSSProperties = {
  height: 34, padding: '0 0.5rem', borderRadius: 8,
  border: '1px solid var(--border, #d1d5db)', background: 'var(--surface, #fff)',
  color: 'var(--text-strong, #1e293b)', fontSize: '0.875rem', fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer',
}

function arrowStyle(disabled: boolean, compact: boolean): CSSProperties {
  const size = compact ? 28 : 32
  return {
    width: size, height: size, borderRadius: 8,
    border: '1px solid var(--border, #d1d5db)', background: 'var(--surface, #fff)',
    color: disabled ? 'var(--text-faint, #cbd5e1)' : 'var(--text, #374151)',
    fontSize: compact ? 15 : '1.125rem', lineHeight: 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
  }
}

// ── Legend ────────────────────────────────────────────────────

export function CalendarLegend({ marks, compact = false }: { marks: DayMark[]; compact?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? '0.375rem 0.875rem' : '0.5rem 1rem', fontSize: compact ? 11 : '0.75rem', color: 'var(--text-muted, #64748b)' }}>
      {marks.map(m => {
        const s = MARK_STYLES[m]
        return (
          <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: compact ? 20 : 22, height: compact ? 16 : 18, borderRadius: 4, padding: '0 3px',
              background: s.bg, color: s.text, border: s.border ?? '1px solid transparent',
              fontSize: compact ? 9 : '0.625rem', fontWeight: 700, boxSizing: 'border-box',
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
  holiday: 'HOLIDAY', choice_holiday: 'CHOICE', leave: 'LEAVE', half_leave: 'HALF DAY', leave_pending: 'PENDING',
  present: 'PRESENT', late: 'LATE', absent: 'ABSENT', sunday: '', none: '',
}

export function MonthGrid({ yearMonth, markFor, noteFor, onDayClick, selected, compact = false }: {
  yearMonth: string
  markFor: (date: string) => DayMark
  noteFor?: (date: string) => string | undefined
  onDayClick?: (date: string) => void
  selected?: string   // the clicked day: ringed so it stands out on any background
  compact?: boolean   // smaller type and cells for the employee area
}) {
  const dates = monthDates(yearMonth)
  const leadingBlanks = weekday(dates[0])
  const today = localDate()

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
      {WEEKDAYS.map(d => (
        <div key={d} style={{
          textAlign: 'center', fontSize: compact ? 10 : '0.6875rem', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          color: d === 'Sun' ? 'var(--text-faint, #94a3b8)' : 'var(--text-muted, #64748b)', padding: '0.25rem 0',
        }}>
          {d}
        </div>
      ))}

      {Array.from({ length: leadingBlanks }, (_, i) => <div key={`blank-${i}`} />)}

      {dates.map(date => {
        const mark = markFor(date)
        const s = MARK_STYLES[mark]
        const note = noteFor?.(date)
        const strong = mark === 'holiday' || mark === 'choice_holiday' || mark === 'leave'
        const isSelected = date === selected
        return (
          <div
            key={date}
            role={onDayClick ? 'button' : undefined}
            tabIndex={onDayClick ? 0 : undefined}
            aria-pressed={onDayClick ? isSelected : undefined}
            onClick={onDayClick ? () => onDayClick(date) : undefined}
            onKeyDown={onDayClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDayClick(date) } } : undefined}
            title={[isSelected && 'Selected', s.label, note].filter(Boolean).join(' — ') || undefined}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
              minHeight: compact ? 54 : 64, padding: compact ? '0.3125rem' : '0.375rem', borderRadius: 8, boxSizing: 'border-box',
              background: mark === 'none' ? 'var(--surface, #fff)' : mark === 'sunday' ? 'var(--surface-soft, #f8fafc)' : s.bg,
              border: s.border ?? (date === today ? '2px solid var(--brand-600)' : '1px solid var(--border, #e2e8f0)'),
              color: strong ? '#fff' : '#1e293b',
              cursor: onDayClick ? 'pointer' : 'default',
              textAlign: 'left', fontFamily: 'inherit', overflow: 'hidden',
              // Outside the cell, so it shows on every colour and doesn't hide today's outline
              ...(isSelected ? { outline: '3px solid #2563eb', outlineOffset: 1, boxShadow: '0 4px 12px rgba(37, 99, 235, 0.28)', position: 'relative', zIndex: 1 } : null),
            }}
          >
            <span style={{ fontSize: compact ? 12 : '0.8125rem', fontWeight: isSelected ? 800 : 600, color: strong ? '#fff' : mark === 'sunday' ? 'var(--text-faint, #94a3b8)' : mark === 'none' ? 'var(--text-strong, #1e293b)' : '#1e293b' }}>
              {Number(date.slice(8))}
            </span>
            {CELL_TAGS[mark] && (
              <span style={{ fontSize: compact ? 8.5 : '0.625rem', fontWeight: 700, color: s.text, letterSpacing: '0.03em' }}>
                {CELL_TAGS[mark]}
              </span>
            )}
            {note && (
              <span style={{
                fontSize: compact ? 9 : '0.625rem', lineHeight: 1.2, color: strong ? 'rgba(255,255,255,0.9)' : '#64748b',
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
