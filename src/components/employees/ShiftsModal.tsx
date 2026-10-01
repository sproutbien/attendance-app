import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ShiftInput, useShifts } from '../../hooks/useShifts'
import { fmtClock, shiftHours, toInput } from '../../lib/shifts'
import type { Shift } from '../../types'
import { dangerBtn, errorBox, ghostBtn, hintStyle, inputStyle, modalStyle, overlayStyle, primaryBtn, tableStyle, tdStyle, thStyle } from './styles'

const EMPTY: ShiftInput = {
  name: '', start_time: '09:30', end_time: '17:30', late_after: '09:40', half_day_after: '11:30', split_time: '13:30',
}

const TIME_FIELDS: { key: keyof Omit<ShiftInput, 'name'>; label: string; hint: string }[] = [
  { key: 'start_time',     label: 'Start',          hint: 'Full-day leave for today can be requested until an hour after this.' },
  { key: 'late_after',     label: 'Late after',     hint: 'Checking in after this is Late.' },
  { key: 'half_day_after', label: 'Half day after', hint: 'Checking in after this makes the morning a half-day leave.' },
  { key: 'split_time',     label: 'Mid-shift split', hint: 'Morning and afternoon half days meet here: check-in opens / auto check-out.' },
  { key: 'end_time',       label: 'End',            hint: '' },
]

/** Admin: create and edit shifts, pick the default. */
export default function ShiftsModal({ shifts: s, employeeIds, onClose }: {
  shifts: ReturnType<typeof useShifts>
  employeeIds: string[]             // current staff, for usage counts
  onClose: () => void
}) {
  const [editing, setEditing] = useState<{ id: string | null; form: ShiftInput } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function act(op: Promise<string | null>, after?: () => void) {
    setBusy(true)
    setError(null)
    const err = await op
    setBusy(false)
    if (err) setError(err)
    else after?.()
  }

  function startEdit(shift: Shift | null) {
    setError(null)
    setEditing(shift
      ? { id: shift.id, form: { name: shift.name, start_time: toInput(shift.start_time), end_time: toInput(shift.end_time), late_after: toInput(shift.late_after), half_day_after: toInput(shift.half_day_after), split_time: toInput(shift.split_time) } }
      : { id: null, form: EMPTY })
  }

  function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const f = { ...editing.form, name: editing.form.name.trim() }
    const { start_time: a, late_after: b, half_day_after: c, split_time: d, end_time: z } = f
    if (!(a <= b && b <= c && c <= d && a < d && d < z)) {
      setError('Times must be in order: Start ≤ Late after ≤ Half day after ≤ Split < End.')
      return
    }
    act(editing.id ? s.update(editing.id, f) : s.create(f), () => setEditing(null))
  }

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ ...modalStyle, maxWidth: 820 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>Shifts</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>
        <p style={{ ...hintStyle, fontSize: '0.8125rem', margin: '0 0 1rem' }}>
          Each employee's late, half-day and leave timings follow their shift. Anyone without a shift is on the default.
          Editing a shift's times applies from now on; days already recorded keep their status.
        </p>

        {error && <div style={errorBox}>{error}</div>}

        {editing ? (
          <form onSubmit={handleSave} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ marginBottom: '0.875rem' }}>
              <label style={label}>Shift name</label>
              <input
                value={editing.form.name} required maxLength={40} autoFocus placeholder="e.g. Late shift"
                onChange={e => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })}
                style={{ ...inputStyle, maxWidth: 280 }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
              {TIME_FIELDS.map(t => (
                <div key={t.key}>
                  <label style={label}>{t.label}</label>
                  <input
                    type="time" required value={editing.form[t.key]}
                    onChange={e => setEditing({ ...editing, form: { ...editing.form, [t.key]: e.target.value } })}
                    style={inputStyle}
                  />
                  {t.hint && <p style={hintStyle}>{t.hint}</p>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.875rem' }}>
              <button type="button" onClick={() => { setEditing(null); setError(null) }} style={ghostBtn}>Cancel</button>
              <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Saving…' : editing.id ? 'Save shift' : 'Add shift'}
              </button>
            </div>
          </form>
        ) : (
          <button onClick={() => startEdit(null)} style={{ ...primaryBtn, marginBottom: '1rem' }}>+ Add shift</button>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {['Shift', 'Hours', 'Late after', 'Half day after', 'Split', 'Staff', ''].map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {s.shifts.map(shift => {
                const used = s.usage(shift.id, employeeIds)
                return (
                  <tr key={shift.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: '#1e293b' }}>
                      {shift.name}
                      {shift.is_default && <span style={defaultTag}>Default</span>}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{shiftHours(shift)}</td>
                    <td style={tdStyle}>{fmtClock(shift.late_after)}</td>
                    <td style={tdStyle}>{fmtClock(shift.half_day_after)}</td>
                    <td style={tdStyle}>{fmtClock(shift.split_time)}</td>
                    <td style={{ ...tdStyle, color: '#64748b' }}>{used}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => startEdit(shift)} disabled={busy} style={ghostBtn}>Edit</button>
                      {!shift.is_default && (
                        <>
                          <button onClick={() => act(s.setDefault(shift.id))} disabled={busy} style={{ ...ghostBtn, marginLeft: '0.375rem' }}>Make default</button>
                          <button
                            onClick={() => act(s.remove(shift.id))}
                            disabled={busy || used > 0}
                            title={used > 0 ? 'Move these employees to another shift first' : undefined}
                            style={{ ...dangerBtn, marginLeft: '0.375rem', opacity: used > 0 ? 0.4 : 1, cursor: used > 0 ? 'not-allowed' : 'pointer' }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const label = { display: 'block', fontSize: '0.8125rem', fontWeight: 500, marginBottom: '0.3125rem', color: '#374151' } as const
const defaultTag = {
  marginLeft: 8, padding: '1px 8px', borderRadius: 99, background: '#dcfce7', color: '#166534', fontSize: '0.6875rem', fontWeight: 700,
} as const
