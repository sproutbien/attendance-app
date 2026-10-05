import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useLeaveTypes } from '../hooks/useLeaveBalances'
import { fmtDays } from '../lib/leave'
import type { LeaveType } from '../types'

/** Admin: yearly quota and carry-forward cap per paid leave type. */
export default function LeaveTypeSettings() {
  const { types, loading, update } = useLeaveTypes()

  return (
    <div style={card}>
      <h2 style={{ margin: '0 0 0.375rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>Leave types</h2>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#64748b', lineHeight: 1.5 }}>
        Paid leave is credited monthly (yearly quota ÷ 12) from 1 April, or from the joining month.
        At the end of March, unused days carry into the next year up to the cap; the rest lapse.
        Sundays and public holidays inside a leave aren’t counted. Days beyond the balance become Loss of Pay when approved.
      </p>
      {loading ? <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {types.filter(t => t.is_paid).map(t => <TypeRow key={t.code} type={t} onSave={update} />)}
          {types.filter(t => !t.is_paid).map(t => (
            <div key={t.code} style={{ ...row, color: '#64748b', fontSize: '0.875rem' }}>
              <b style={{ color: '#1e293b', minWidth: 140 }}>{t.name}</b> Unpaid, no limit. Also used automatically for days beyond a paid balance.
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TypeRow({ type: t, onSave }: {
  type: LeaveType
  onSave: (code: string, changes: Pick<LeaveType, 'yearly_quota' | 'carry_forward_cap'>) => Promise<string | null>
}) {
  const [quota, setQuota] = useState(String(t.yearly_quota))
  const [cap, setCap] = useState(String(t.carry_forward_cap))
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => { setQuota(String(t.yearly_quota)); setCap(String(t.carry_forward_cap)) }, [t])

  const dirty = Number(quota) !== t.yearly_quota || Number(cap) !== t.carry_forward_cap

  async function save() {
    const q = Number(quota), c = Number(cap)
    if (!(q >= 0) || !(c >= 0)) return setStatus('Enter 0 or more.')
    const err = await onSave(t.code, { yearly_quota: q, carry_forward_cap: c })
    setStatus(err ?? 'Saved')
  }

  return (
    <div style={row}>
      <b style={{ color: '#1e293b', minWidth: 140 }}>{t.name}</b>
      <label style={label}>
        Days per year
        <input type="number" min={0} step={0.5} value={quota} onChange={e => { setQuota(e.target.value); setStatus(null) }} style={input} />
      </label>
      <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>= {fmtDays(Number(quota) / 12)} / month</span>
      <label style={label}>
        Carry-forward cap
        <input type="number" min={0} step={0.5} value={cap} onChange={e => { setCap(e.target.value); setStatus(null) }} style={input} />
      </label>
      <button onClick={save} disabled={!dirty} style={{ ...btn, opacity: dirty ? 1 : 0.5, cursor: dirty ? 'pointer' : 'default' }}>Save</button>
      {status && <span style={{ fontSize: '0.8125rem', color: status === 'Saved' ? '#166534' : '#dc2626' }}>{status}</span>}
    </div>
  )
}

const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '0.75rem 1rem', border: '1px solid #e2e8f0', borderRadius: 12 }
const label: CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: '#475569' }
const input: CSSProperties = { width: 72, padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.875rem', fontFamily: 'inherit' }
const btn: CSSProperties = { padding: '0.375rem 0.875rem', borderRadius: 8, border: 'none', background: 'var(--brand-600)', color: '#fff', fontWeight: 600, fontSize: '0.8125rem' }
