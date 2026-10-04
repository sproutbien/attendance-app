import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useLeaveOnDates } from '../hooks/useHolidayChoices'
import type { ChoiceDraft, ChoiceEmployee, ChoicePick, LeaveOnDate, useHolidayChoices } from '../hooks/useHolidayChoices'
import { daysInMonth, localDate, monthLabel } from '../lib/calendar'
import { effectiveChoice, fmtHolidayDay } from '../lib/holidays'
import type { HolidayChoice } from '../types'

type Data = ReturnType<typeof useHolidayChoices>

/** Admin: holidays employees take on one of several dates (e.g. Onam: 27 or 28 Aug). */
export default function ChoiceHolidays({ yearMonth, data }: { yearMonth: string; data: Data }) {
  const [editing, setEditing] = useState<{ id: string | null; draft: ChoiceDraft } | null>(null)
  const today = localDate()

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>Choice holidays in {monthLabel(yearMonth)}</h2>
        {!editing && (
          <button type="button" style={{ ...btn, marginLeft: 'auto' }}
            onClick={() => setEditing({ id: null, draft: { name: '', pick_count: 1, choose_by: '', dates: [blankDate(), blankDate()] } })}>
            + New choice holiday
          </button>
        )}
      </div>
      <p style={{ margin: '0 0 1rem', fontSize: '0.8125rem', color: '#64748b', lineHeight: 1.5 }}>
        Let each employee choose which day(s) to take, e.g. Onam on 27 <i>or</i> 28 Aug. They choose on their Dashboard or Leaves page
        until the deadline; until then, and for anyone who doesn’t choose, the default applies. You can change anyone’s date at any time.
        Their day counts as a holiday only for them. Leave people already have on these dates is recounted automatically.
      </p>

      {editing && (
        <ChoiceForm
          yearMonth={yearMonth}
          initial={editing.draft}
          isNew={editing.id === null}
          onCancel={() => setEditing(null)}
          onSave={async d => {
            const err = await data.save(editing.id, d)
            if (!err) setEditing(null)
            return err
          }}
        />
      )}

      {data.error && <div style={errorBox}>{data.error}</div>}
      {data.loading ? <p style={muted}>Loading…</p>
        : data.choices.length === 0 ? (!editing && <p style={muted}>None this month.</p>)
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {data.choices.map(c => (
              <ChoiceItem
                key={c.id}
                choice={c}
                picks={data.picks.filter(p => p.choice_id === c.id)}
                employees={data.employees}
                today={today}
                onEdit={() => setEditing({ id: c.id, draft: { name: c.name, pick_count: c.pick_count, choose_by: c.choose_by, dates: c.dates } })}
                onDelete={() => data.remove(c.id)}
                onSetFor={(emp, dates) => data.setFor(c.id, emp, dates)}
              />
            ))}
          </div>
        )}
    </div>
  )
}

const blankDate = () => ({ date: '', is_default: false, max_people: null })

function ChoiceForm({ yearMonth, initial, isNew, onSave, onCancel }: {
  yearMonth: string
  initial: ChoiceDraft
  isNew: boolean
  onSave: (d: ChoiceDraft) => Promise<string | null>
  onCancel: () => void
}) {
  const [d, setD] = useState<ChoiceDraft>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const first = `${yearMonth}-01`
  const last = `${yearMonth}-${String(daysInMonth(yearMonth)).padStart(2, '0')}`
  const set = (patch: Partial<ChoiceDraft>) => { setD({ ...d, ...patch }); setError(null) }
  const onLeave = useLeaveOnDates(d.dates.map(x => x.date))
  const setDate = (i: number, patch: Partial<ChoiceDraft['dates'][number]>) =>
    set({ dates: d.dates.map((x, j) => j === i ? { ...x, ...patch } : x) })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (d.dates.some(x => !x.date)) return setError('Fill in every date, or remove the empty row.')
    setSaving(true)
    setError(await onSave({ ...d, name: d.name.trim() }))
    setSaving(false)
  }

  return (
    <form onSubmit={submit} style={{ border: '1px solid #bfdbfe', background: '#f8fbff', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.875rem' }}>
        <label style={{ ...label, flex: '1 1 180px' }}>
          Name
          <input value={d.name} maxLength={80} required placeholder="e.g. Onam" onChange={e => set({ name: e.target.value })} style={input} />
        </label>
        <label style={{ ...label, flex: '0 1 120px' }}>
          Days to take
          <input type="number" min={1} max={Math.max(1, d.dates.length - 1)} required value={d.pick_count}
            onChange={e => set({ pick_count: Number(e.target.value) })} style={input} />
        </label>
        <label style={{ ...label, flex: '0 1 170px' }}>
          Last day to choose
          <input type="date" required value={d.choose_by} max={d.dates.map(x => x.date).filter(Boolean).sort()[0]}
            onChange={e => set({ choose_by: e.target.value })} style={input} />
        </label>
      </div>

      <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>
        Dates to choose from <span style={{ fontWeight: 400, color: '#64748b' }}>(all in {monthLabel(yearMonth)})</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.625rem' }}>
        {d.dates.map((x, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <input type="date" required min={first} max={last} value={x.date}
              onChange={e => setDate(i, { date: e.target.value })} style={{ ...input, width: 160 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: '#475569' }}>
              <input type="checkbox" checked={x.is_default} onChange={e => setDate(i, { is_default: e.target.checked })} />
              Default
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: '#475569' }}>
              Max people
              <input type="number" min={1} placeholder="No limit" value={x.max_people ?? ''}
                onChange={e => setDate(i, { max_people: e.target.value === '' ? null : Number(e.target.value) })}
                style={{ ...input, width: 96 }} />
            </label>
            {d.dates.length > 2 && (
              <button type="button" onClick={() => set({ dates: d.dates.filter((_, j) => j !== i) })} style={linkBtn}>Remove</button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => set({ dates: [...d.dates, blankDate()] })} style={{ ...linkBtn, color: '#2563eb', marginBottom: '0.875rem' }}>
        + Add a date
      </button>
      {onLeave.length > 0 && <RecountNote leave={onLeave} what="these dates" />}
      <p style={{ margin: '0 0 0.875rem', fontSize: '0.75rem', color: '#64748b' }}>
        Tick {d.pick_count} default date{d.pick_count === 1 ? '' : 's'} for anyone who doesn’t choose in time.
        {!isNew && ' Changing the number of days, or removing a date, clears everyone’s choices so they choose again.'}
      </p>

      {error && <div style={errorBox}>{error}</div>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={saving} style={btn}>{saving ? 'Saving…' : isNew ? 'Add choice holiday' : 'Save changes'}</button>
        <button type="button" onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </form>
  )
}

function ChoiceItem({ choice: c, picks, employees, today, onEdit, onDelete, onSetFor }: {
  choice: HolidayChoice
  picks: ChoicePick[]
  employees: ChoiceEmployee[]
  today: string
  onEdit: () => void
  onDelete: () => Promise<string | null>
  onSetFor: (employeeId: string, dates: string[]) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = c.dates[0].date <= today
  const deadlinePassed = today > c.choose_by

  const rows = employees.map(e => {
    const own = picks.filter(p => p.employee_id === e.id)
    const eff = effectiveChoice(c, own.map(p => p.date))
    const how = eff.source === 'picked'
      ? (own[0].picked_by === e.id ? 'Chose' : 'Set by admin')
      : deadlinePassed ? 'Default' : 'Not chosen yet (default)'
    return { employee: e, dates: eff.dates, how }
  })
  const notChosen = rows.filter(r => r.how === 'Not chosen yet (default)').length

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '0.875rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <b style={{ color: '#1d4ed8', fontSize: '0.9375rem' }}>{c.name}</b>
        <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
          Take {c.pick_count} of {c.dates.length} · {deadlinePassed ? 'choices closed' : `choose by ${fmtHolidayDay(c.choose_by)}`}
          {!deadlinePassed && notChosen > 0 && <b style={{ color: '#b45309' }}> · {notChosen} haven’t chosen</b>}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button type="button" onClick={() => setOpen(!open)} style={ghostBtn}>{open ? 'Hide people' : 'People'}</button>
          {!started && <button type="button" onClick={onEdit} style={ghostBtn}>Edit</button>}
          {!started && !confirmDelete && <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...ghostBtn, color: '#dc2626', borderColor: '#fecaca' }}>Delete</button>}
          {confirmDelete && (
            <>
              <button type="button" onClick={async () => { setError(await onDelete()); setConfirmDelete(false) }} style={{ ...btn, background: '#dc2626' }}>Delete it</button>
              <button type="button" onClick={() => setConfirmDelete(false)} style={ghostBtn}>Keep</button>
            </>
          )}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.625rem' }}>
        {c.dates.map(d => {
          const off = rows.filter(r => r.dates.includes(d.date)).length
          return (
            <span key={d.date} style={{ fontSize: '0.8125rem', padding: '0.25rem 0.625rem', borderRadius: 999, background: '#eff6ff', color: '#1e3a8a' }}>
              <b>{fmtHolidayDay(d.date)}</b> · {off} off{d.max_people != null && ` (max ${d.max_people})`}{d.is_default && ' · default'}
            </span>
          )
        })}
      </div>

      {error && <div style={{ ...errorBox, marginTop: '0.625rem' }}>{error}</div>}

      {open && (
        <div style={{ marginTop: '0.875rem', overflowX: 'auto' }}>
          <table className="rt" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b' }}>
                <th style={th}>Employee</th>
                <th style={th}>Holiday</th>
                <th style={th}>How</th>
                <th style={th}>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <PersonRow key={r.employee.id + r.dates.join()} choice={c} row={r} onSet={dates => onSetFor(r.employee.id, dates)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PersonRow({ choice: c, row, onSet }: {
  choice: HolidayChoice
  row: { employee: ChoiceEmployee; dates: string[]; how: string }
  onSet: (dates: string[]) => Promise<string | null>
}) {
  const [selected, setSelected] = useState<string[]>(row.dates)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changed = selected.length === c.pick_count && [...selected].sort().join() !== [...row.dates].sort().join()
  const hasOwn = row.how === 'Chose' || row.how === 'Set by admin'

  function toggle(date: string) {
    setError(null)
    if (selected.includes(date)) return setSelected(selected.filter(d => d !== date))
    setSelected(c.pick_count === 1 ? [date] : selected.length < c.pick_count ? [...selected, date] : selected)
  }

  async function run(dates: string[]) {
    setSaving(true)
    setError(await onSet(dates))
    setSaving(false)
  }

  return (
    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
      <td style={td}>{row.employee.full_name}</td>
      <td style={{ ...td, fontWeight: 600, color: row.dates.length ? '#1d4ed8' : '#94a3b8' }}>
        {row.dates.length ? row.dates.map(fmtHolidayDay).join(', ') : '—'}
      </td>
      <td style={{ ...td, color: row.how.startsWith('Not chosen') ? '#b45309' : '#475569' }}>{row.how}</td>
      <td style={td}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
          {c.dates.map(d => (
            <button key={d.date} type="button" aria-pressed={selected.includes(d.date)} onClick={() => toggle(d.date)} style={miniChip(selected.includes(d.date))}>
              {fmtHolidayDay(d.date)}
            </button>
          ))}
          {changed && <button type="button" disabled={saving} onClick={() => run(selected)} style={{ ...btn, padding: '0.25rem 0.625rem' }}>Save</button>}
          {hasOwn && !changed && (
            <button type="button" disabled={saving} onClick={() => run([])} style={linkBtn} title="Clear their choice; the default applies">
              Reset
            </button>
          )}
        </div>
        {error && <div style={{ color: '#dc2626', fontSize: '0.75rem', marginTop: '0.25rem' }}>{error}</div>}
      </td>
    </tr>
  )
}

/** "Asha (approved, 14–19 Dec) has leave on these dates — it will be recounted." */
export function RecountNote({ leave, what }: { leave: LeaveOnDate[]; what: string }) {
  const span = (l: LeaveOnDate) => l.start_date === l.end_date
    ? fmtHolidayDay(l.start_date)
    : `${fmtHolidayDay(l.start_date)} – ${fmtHolidayDay(l.end_date)}`
  return (
    <div style={{ margin: '0 0 0.875rem', padding: '0.5rem 0.75rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e', fontSize: '0.8125rem', lineHeight: 1.5 }}>
      {leave.map(l => `${l.full_name} (${l.status}, ${span(l)})`).join(', ')} {leave.length === 1 ? 'has' : 'have'} leave on {what}.
      Saving recounts that leave automatically: a day that becomes a holiday comes off the leave (Loss of Pay first, then back
      to the balance); a day that stops being one is added back.
    </div>
  )
}

function miniChip(on: boolean): CSSProperties {
  return {
    padding: '0.1875rem 0.5rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${on ? '#2563eb' : '#cbd5e1'}`, background: on ? '#2563eb' : '#fff', color: on ? '#fff' : '#334155',
  }
}

const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const muted: CSSProperties = { margin: 0, color: '#94a3b8', fontSize: '0.875rem' }
const label: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }
const input: CSSProperties = { padding: '0.4375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', color: '#1e293b', boxSizing: 'border-box', width: '100%' }
const btn: CSSProperties = { padding: '0.4375rem 0.875rem', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit' }
const ghostBtn: CSSProperties = { padding: '0.3125rem 0.75rem', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit' }
const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, color: '#64748b', fontSize: '0.8125rem', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }
const errorBox: CSSProperties = { marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: '0.8125rem' }
const th: CSSProperties = { padding: '0.375rem 0.5rem', fontWeight: 600 }
const td: CSSProperties = { padding: '0.5rem', verticalAlign: 'top' }
