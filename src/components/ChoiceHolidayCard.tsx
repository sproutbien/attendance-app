import { useState } from 'react'
import type { CSSProperties } from 'react'
import { PartyPopper } from 'lucide-react'
import { useMyHolidayChoices } from '../hooks/useHolidayChoices'
import type { MyHolidayChoice } from '../hooks/useHolidayChoices'
import { fmtHolidayDay } from '../lib/holidays'

/** Employee: choose the date(s) for choice holidays (e.g. Onam: 27 or 28 Aug). Renders nothing when there are none. */
export default function ChoiceHolidayCard({ onChanged }: { onChanged?: () => void }) {
  const { choices, choose } = useMyHolidayChoices()
  if (choices.length === 0) return null
  return (
    <div className="sb-card" style={{ marginBottom: '1.25rem' }}>
      <div className="sb-card-head">
        <PartyPopper size={18} />
        <h2>{choices.some(c => c.open && !c.chosen) ? 'Choose your holiday' : 'Your holidays'}</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {choices.map(c => (
          <ChoiceRow key={c.id + c.my_dates.join()} choice={c} onChoose={async dates => {
            const err = await choose(c.id, dates)
            if (!err) onChanged?.()
            return err
          }} />
        ))}
      </div>
    </div>
  )
}

function ChoiceRow({ choice: c, onChoose }: { choice: MyHolidayChoice; onChoose: (dates: string[]) => Promise<string | null> }) {
  const [selected, setSelected] = useState<string[]>(c.chosen ? c.my_dates : [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const defaults = c.dates.filter(d => d.is_default).map(d => fmtHolidayDay(d.date)).join(' and ')
  const days = `${c.pick_count} day${c.pick_count === 1 ? '' : 's'}`
  const changed = selected.length === c.pick_count && [...selected].sort().join() !== [...(c.chosen ? c.my_dates : [])].sort().join()

  function toggle(date: string) {
    setError(null)
    if (selected.includes(date)) return setSelected(selected.filter(d => d !== date))
    // Choosing one day: tapping another swaps it
    setSelected(c.pick_count === 1 ? [date] : selected.length < c.pick_count ? [...selected, date] : selected)
  }

  async function save() {
    setSaving(true)
    setError(await onChoose(selected))
    setSaving(false)
  }

  if (!c.open) {
    return (
      <div style={{ fontSize: '0.875rem', color: 'var(--text, #2c4234)' }}>
        <b style={{ color: 'var(--text-strong, #10261a)' }}>{c.name}</b>: your holiday is{' '}
        <b style={{ color: 'var(--blue, #1f5fbf)' }}>{c.my_dates.map(fmtHolidayDay).join(' and ')}</b>
        {!c.chosen && <span style={{ color: 'var(--text-muted, #5b6f61)' }}> (the default — no choice was made by {fmtHolidayDay(c.choose_by)})</span>}.
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontSize: '0.875rem', color: 'var(--text, #2c4234)', marginBottom: '0.625rem', lineHeight: 1.5 }}>
        <b style={{ color: 'var(--text-strong, #10261a)' }}>{c.name}</b>: take {days} off from these dates.{' '}
        {c.chosen
          ? <>You chose <b style={{ color: 'var(--blue, #1f5fbf)' }}>{c.my_dates.map(fmtHolidayDay).join(' and ')}</b>. You can change it until {fmtHolidayDay(c.choose_by)}.</>
          : <>Choose by <b>{fmtHolidayDay(c.choose_by)}</b>. If you don’t, you’ll get {defaults}.</>}
      </div>
      <div role="group" aria-label={`${c.name} dates`} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        {c.dates.map(d => {
          const on = selected.includes(d.date)
          const full = d.max_people != null && d.taken >= d.max_people && !on
          return (
            <button
              key={d.date}
              type="button"
              aria-pressed={on}
              disabled={full}
              onClick={() => toggle(d.date)}
              style={chip(on, full)}
            >
              {fmtHolidayDay(d.date)}
              {full && <span style={{ fontWeight: 500 }}> · full</span>}
              {!full && d.max_people != null && (
                <span style={{ fontWeight: 500, opacity: 0.8 }}> · {d.max_people - d.taken - (on ? 1 : 0)} left</span>
              )}
            </button>
          )
        })}
        {changed && (
          <button type="button" onClick={save} disabled={saving} style={saveBtn}>
            {saving ? 'Saving…' : c.chosen ? 'Change' : 'Confirm'}
          </button>
        )}
      </div>
      {error && <div style={{ marginTop: '0.5rem', fontSize: '0.8125rem', color: 'var(--red, #b42318)' }}>{error}</div>}
    </div>
  )
}

function chip(on: boolean, full: boolean): CSSProperties {
  return {
    padding: '0.4375rem 0.875rem',
    borderRadius: 999,
    border: `1px solid ${on ? 'var(--blue, #1f5fbf)' : 'var(--border, #e2ebdf)'}`,
    background: on ? 'var(--blue, #1f5fbf)' : 'var(--surface, #fff)',
    color: on ? '#fff' : full ? 'var(--text-faint, #93a397)' : 'var(--text-strong, #10261a)',
    fontWeight: 600,
    fontSize: '0.8125rem',
    cursor: full ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
  }
}

const saveBtn: CSSProperties = {
  padding: '0.4375rem 1rem',
  borderRadius: 8,
  border: 'none',
  background: 'var(--green-btn-1, #2f8a2a)',
  color: '#fff',
  fontWeight: 600,
  fontSize: '0.8125rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
