import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useHolidays } from '../../hooks/useHolidays'
import { useHolidayChoices, useLeaveOnDates } from '../../hooks/useHolidayChoices'
import ChoiceHolidays, { RecountNote } from '../../components/ChoiceHolidays'
import { MonthGrid, MonthPicker, CalendarLegend } from '../../components/MonthCalendar'
import { currentYearMonth, daysInMonth, isSunday, monthLabel, suggestedWorkingDays } from '../../lib/calendar'

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function AdminCalendarPage() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const { holidays, loading, error, saving, save, remove } = useHolidays(yearMonth)
  const choices = useHolidayChoices(yearMonth)
  // Choice holiday dates (e.g. Onam: 27 or 28 Aug) and the days everyone takes for them
  const choiceDateName = new Map(choices.choices.flatMap(c => c.dates.map(d => [d.date, c.name] as const)))
  const choiceDays = choices.choices.reduce((n, c) => n + c.pick_count, 0)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  // Leave already on these days is recounted when a holiday is added or removed
  const onLeave = useLeaveOnDates([date, ...holidays.map(h => h.date)])
  const leaveOn = (d: string) => onLeave.filter(l => l.start_date <= d && l.end_date >= d)

  const byDate = new Map(holidays.map(h => [h.date, h.name]))
  const monthStart = `${yearMonth}-01`
  const monthEnd = `${yearMonth}-${String(daysInMonth(yearMonth)).padStart(2, '0')}`
  const editing = date !== '' && byDate.has(date)

  function changeMonth(ym: string) {
    setYearMonth(ym)
    setDate('')
    setName('')
    setFormError(null)
  }

  function pickDay(d: string) {
    setDate(d)
    setName(byDate.get(d) ?? '')
    setFormError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const err = await save(date, name.trim())
    if (err) { setFormError(err); return }
    setDate('')
    setName('')
  }

  async function handleRemove(d: string) {
    setRemoving(d)
    const err = await remove(d)
    setRemoving(null)
    if (err) setFormError(err)
    else if (d === date) { setDate(''); setName('') }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>Calendar</h1>
        <MonthPicker yearMonth={yearMonth} onChange={changeMonth} />
      </div>
      <p style={{ margin: '0 0 1.25rem', color: '#64748b', fontSize: '0.875rem' }}>
        Public holidays appear in blue on every employee's calendar.
        {!loading && !choices.loading && ` ${monthLabel(yearMonth)}: ${holidays.length} holiday${holidays.length !== 1 ? 's' : ''}${choiceDays ? ` + ${choiceDays} choice holiday day${choiceDays === 1 ? '' : 's'} each` : ''}, ${suggestedWorkingDays(yearMonth, byDate.keys(), choiceDays)} working days.`}
      </p>

      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Month grid */}
        <div style={{ ...card, flex: '2 1 460px' }}>
          {error ? (
            <div style={{ color: '#ef4444' }}>{error}</div>
          ) : loading ? (
            <div style={{ color: '#94a3b8' }}>Loading…</div>
          ) : (
            <>
              <MonthGrid
                yearMonth={yearMonth}
                markFor={d => byDate.has(d) ? 'holiday' : isSunday(d) ? 'sunday' : 'none'}
                noteFor={d => byDate.get(d) ?? (choiceDateName.has(d) ? `${choiceDateName.get(d)} (choice)` : undefined)}
                onDayClick={pickDay}
              />
              <div style={{ marginTop: '0.875rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <CalendarLegend marks={['holiday', 'sunday']} />
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Click a day to add or rename its holiday.</span>
              </div>
            </>
          )}
        </div>

        {/* Add / edit + list */}
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <form onSubmit={handleSubmit} style={card}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
              {editing ? 'Rename holiday' : 'Add holiday'}
            </h2>
            <label style={labelStyle}>Date</label>
            <input
              type="date"
              value={date}
              min={monthStart}
              max={monthEnd}
              onChange={e => pickDay(e.target.value)}
              required
              style={{ ...inputStyle, marginBottom: '0.875rem' }}
            />
            <label style={labelStyle}>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Gandhi Jayanti"
              required
              maxLength={80}
              style={{ ...inputStyle, marginBottom: '1rem' }}
            />
            {date && !editing && leaveOn(date).length > 0 && <RecountNote leave={leaveOn(date)} what="this day" />}
            {formError && (
              <div style={{ marginBottom: '0.875rem', padding: '0.625rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: '0.8125rem' }}>
                {formError}
              </div>
            )}
            <button
              type="submit"
              disabled={saving || !date || !name.trim()}
              style={{
                padding: '0.5rem 1.25rem',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: saving || !date || !name.trim() ? 'not-allowed' : 'pointer',
                opacity: saving || !date || !name.trim() ? 0.5 : 1,
                fontFamily: 'inherit',
              }}
            >
              {saving ? 'Saving…' : editing ? 'Save name' : 'Add holiday'}
            </button>
          </form>

          <div style={card}>
            <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
              Holidays in {monthLabel(yearMonth)}
            </h2>
            {loading ? (
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.875rem' }}>Loading…</p>
            ) : holidays.length === 0 ? (
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.875rem' }}>No public holidays this month.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {holidays.map(h => (
                  <li key={h.date} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.625rem', background: '#eff6ff', borderRadius: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#1d4ed8' }}>{h.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {fmtDate(h.date)}{isSunday(h.date) && ' · falls on a Sunday'}
                      </div>
                      {leaveOn(h.date).length > 0 && (
                        <div style={{ fontSize: '0.75rem', color: '#92400e' }}>{leaveOverNote(leaveOn(h.date).map(l => l.full_name))}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemove(h.date)}
                      disabled={removing === h.date}
                      style={{
                        background: 'none', border: '1px solid #fecaca', color: '#dc2626',
                        borderRadius: 6, padding: '0.25rem 0.625rem', fontSize: '0.75rem',
                        cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      {removing === h.date ? 'Cancelling…' : 'Cancel holiday'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        <ChoiceHolidays yearMonth={yearMonth} data={choices} />
      </div>
    </div>
  )
}

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: '1.25rem',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 500,
  marginBottom: '0.375rem',
  color: '#374151',
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: '0.875rem',
  outline: 'none',
  boxSizing: 'border-box',
  color: '#1e293b',
  fontFamily: 'inherit',
}

/** Under a public holiday: who has leave over it, and what cancelling the holiday does to that leave. */
function leaveOverNote(names: string[]) {
  const people = [...new Set(names)]
  const who = people.length <= 3
    ? people.join(people.length === 2 ? ' and ' : ', ')
    : `${people.slice(0, 3).join(', ')} and ${people.length - 3} more`
  return people.length === 1
    ? `${who} has leave over this date. Cancelling the holiday adds a day to their leave (from their balance, or as Loss of Pay).`
    : `${who} have leave over this date. Cancelling the holiday adds a day to each of their leaves (from their balance, or as Loss of Pay).`
}
