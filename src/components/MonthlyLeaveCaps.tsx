import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useHolidayDates, useLeaveMonthCaps } from '../hooks/useLeaveBalances'
import { currentYearMonth, monthLabel } from '../lib/calendar'
import { daysLabel } from '../lib/leave'

/** Last day of a "YYYY-MM" month, as "YYYY-MM-DD". */
function monthEnd(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

/** Admin: limit paid Casual + Earned days per employee in holiday-heavy months. */
export default function MonthlyLeaveCaps() {
  const thisMonth = currentYearMonth()
  const { caps, loading, save, remove } = useLeaveMonthCaps(`${thisMonth}-01`)
  const [month, setMonth] = useState('')
  const [maxDays, setMaxDays] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  // Public holidays in the listed months and the one being added
  const lastMonth = [month, ...caps.map(c => c.month.slice(0, 7))].filter(Boolean).sort().pop() ?? thisMonth
  const holidays = useHolidayDates(`${thisMonth}-01`, monthEnd(lastMonth))
  const holidaysIn = (ym: string) => [...holidays].filter(d => d.startsWith(ym)).length

  const existing = caps.find(c => c.month.startsWith(month))

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(maxDays)
    if (!month) return setStatus('Pick a month.')
    if (maxDays === '' || !(n >= 0) || n * 2 !== Math.floor(n * 2)) return setStatus('Enter 0 or more, in half days.')
    const err = await save({ month: `${month}-01`, max_days: n, note: note.trim() || null })
    if (err) return setStatus(err)
    setStatus('Saved')
    setMonth('')
    setMaxDays('')
    setNote('')
  }

  return (
    <div style={{ ...card, marginTop: '1.5rem' }}>
      <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>Monthly limits</h2>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#64748b', lineHeight: 1.5 }}>
        For months with many public holidays, limit how many paid Casual + Earned days each employee can take that month.
        Days over the limit become Loss of Pay. Sick Leave isn’t limited, and leave already approved keeps its paid days.
      </p>

      <form onSubmit={add} style={{ ...row, marginBottom: '1rem' }}>
        <label style={label}>
          Month
          <input type="month" min={thisMonth} value={month} onChange={e => { setMonth(e.target.value); setStatus(null) }} style={{ ...input, width: 150 }} />
        </label>
        <label style={label}>
          Max days
          <input type="number" min={0} step={0.5} value={maxDays} onChange={e => { setMaxDays(e.target.value); setStatus(null) }} style={input} />
        </label>
        <label style={{ ...label, flex: '1 1 180px' }}>
          Note
          <input value={note} maxLength={80} placeholder="e.g. Onam and Diwali" onChange={e => { setNote(e.target.value); setStatus(null) }} style={{ ...input, width: '100%', minWidth: 0 }} />
        </label>
        <button type="submit" style={btn}>{existing ? 'Update' : 'Add'}</button>
        {month && (
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8', flexBasis: '100%' }}>
            {monthLabel(month)}: {holidaysIn(month)} public holiday{holidaysIn(month) === 1 ? '' : 's'}
            {existing && <> · current limit {daysLabel(existing.max_days)}</>}
          </span>
        )}
        {status && <span style={{ fontSize: '0.8125rem', color: status === 'Saved' ? '#166534' : '#dc2626', flexBasis: '100%' }}>{status}</span>}
      </form>

      {loading ? <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p>
        : caps.length === 0 ? <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.875rem' }}>No limits for this month or later.</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {caps.map(c => {
              const ym = c.month.slice(0, 7)
              const h = holidaysIn(ym)
              return (
                <div key={c.month} style={{ ...row, fontSize: '0.875rem', color: '#475569' }}>
                  <b style={{ color: '#1e293b', minWidth: 140 }}>{monthLabel(ym)}</b>
                  <span>Max <b style={{ color: '#1e293b' }}>{daysLabel(c.max_days)}</b> Casual + Earned</span>
                  <span style={{ color: '#94a3b8' }}>{h} public holiday{h === 1 ? '' : 's'}{c.note && ` · ${c.note}`}</span>
                  <button
                    type="button"
                    onClick={async () => setStatus(await remove(c.month))}
                    style={{ ...btn, marginLeft: 'auto', background: 'transparent', color: '#dc2626', border: '1px solid #fecaca' }}
                  >
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}

const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '0.75rem 1rem', border: '1px solid #e2e8f0', borderRadius: 12 }
const label: CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: '#475569' }
const input: CSSProperties = { width: 72, padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.875rem', fontFamily: 'inherit' }
const btn: CSSProperties = { padding: '0.375rem 0.875rem', borderRadius: 8, border: 'none', background: 'var(--brand-600)', color: '#fff', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer' }
