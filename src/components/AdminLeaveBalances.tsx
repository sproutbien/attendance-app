import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/calendar'
import { fmtDays, leaveYearLabel, leaveYearOf } from '../lib/leave'
import { useLeaveBalances } from '../hooks/useLeaveBalances'
import LeaveBalanceCards from './LeaveBalanceCards'
import type { Employee, LeaveAdjustment, LeaveBalance, LeaveTypeCode } from '../types'

type Row = { employee: Pick<Employee, 'id' | 'full_name' | 'department' | 'joining_date'>; balances: LeaveBalance[] }

const COLUMNS: { code: LeaveTypeCode; label: string }[] = [
  { code: 'casual', label: 'Casual' },
  { code: 'sick', label: 'Sick' },
  { code: 'earned', label: 'Earned' },
  { code: 'lop', label: 'LOP taken' },
]

/** Admin: every active employee's balances this leave year, with manual adjustments. */
export default function AdminLeaveBalances() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<Row['employee'] | null>(null)
  const year = leaveYearOf(localDate())

  const load = useCallback(async () => {
    const { data: employees, error } = await supabase
      .from('employees')
      .select('id, full_name, department, joining_date')
      .eq('status', 'active')
      .order('full_name')
    if (error) { setError(error.message); setLoading(false); return }
    const results = await Promise.all((employees ?? []).map(async e => {
      const { data } = await supabase.rpc('leave_balances', { p_employee: e.id })
      return { employee: e, balances: ((data ?? []) as LeaveBalance[]).map(b => ({ ...b, available: b.available == null ? null : Number(b.available), used: Number(b.used) })) }
    }))
    setRows(results)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>Available balances</h2>
        <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>Leave year {leaveYearLabel(year)} · as of today</span>
      </div>

      {error ? <p style={{ color: '#dc2626', margin: 0 }}>{error}</p>
        : loading ? <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr>
                  <th style={th}>Employee</th>
                  {COLUMNS.map(c => <th key={c.code} style={{ ...th, textAlign: 'center' }}>{c.label}</th>)}
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ employee: e, balances }) => (
                  <tr key={e.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{e.full_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {e.department ?? '—'}{e.joining_date && <> · joined {new Date(e.joining_date + 'T00:00:00').toLocaleDateString([], { month: 'short', year: 'numeric' })}</>}
                      </div>
                    </td>
                    {COLUMNS.map(c => {
                      const b = balances.find(x => x.leave_type === c.code)
                      const value = c.code === 'lop' ? b?.used : b?.available
                      return (
                        <td key={c.code} style={{ ...td, textAlign: 'center', fontWeight: 600, color: c.code === 'lop' && value ? '#b91c1c' : value != null && value < 0 ? '#b91c1c' : '#1e293b' }}>
                          {fmtDays(value)}
                        </td>
                      )
                    })}
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button onClick={() => setAdjusting(e)} style={smallBtn}>Details / adjust</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {adjusting && (
        <AdjustDialog
          employee={adjusting}
          year={year}
          onClose={() => setAdjusting(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

function AdjustDialog({ employee, year, onClose, onSaved }: {
  employee: Row['employee']
  year: number
  onClose: () => void
  onSaved: () => void
}) {
  const balances = useLeaveBalances(employee.id)
  const [history, setHistory] = useState<LeaveAdjustment[]>([])
  const [type, setType] = useState<LeaveTypeCode>('casual')
  const [days, setDays] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from('leave_adjustments')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('leave_year', year)
      .order('created_at', { ascending: false })
    setHistory(data ?? [])
  }, [employee.id, year])

  useEffect(() => { loadHistory() }, [loadHistory])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const n = Number(days)
    if (!n || Math.round(n * 2) !== n * 2) return setError('Enter a non-zero number of days in steps of 0.5 (use a minus sign to deduct).')
    if (!reason.trim()) return setError('Give a reason for the adjustment.')
    setSaving(true)
    const { error } = await supabase.from('leave_adjustments').insert({
      employee_id: employee.id, leave_type: type, leave_year: year, days: n, reason: reason.trim(),
    })
    setSaving(false)
    if (error) return setError(error.message)
    setDays('')
    setReason('')
    balances.refresh()
    loadHistory()
    onSaved()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 640, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 700, color: '#1e293b' }}>{employee.full_name}</h2>
          <button onClick={onClose} style={smallBtn}>Close</button>
        </div>

        <LeaveBalanceCards balances={balances.balances} loading={balances.loading} error={balances.error} compact />

        <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '0.625rem', marginBottom: '1rem' }}>
          <select value={type} onChange={e => setType(e.target.value as LeaveTypeCode)} style={input} aria-label="Leave type">
            <option value="casual">Casual Leave</option>
            <option value="sick">Sick Leave</option>
            <option value="earned">Earned Leave</option>
          </select>
          <input type="number" step="0.5" value={days} onChange={e => setDays(e.target.value)} placeholder="+2 or -1" style={input} aria-label="Days" />
          <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (e.g. opening balance, comp-off for Sunday work)" style={{ ...input, gridColumn: '1 / -1' }} aria-label="Reason" />
          {error && <p style={{ gridColumn: '1 / -1', margin: 0, color: '#dc2626', fontSize: '0.875rem' }}>{error}</p>}
          <button type="submit" disabled={saving} style={{ ...primaryBtn, gridColumn: '1 / -1', justifySelf: 'end' }}>
            {saving ? 'Saving…' : 'Add adjustment'}
          </button>
        </form>

        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', fontWeight: 600, color: '#475569' }}>Adjustments in {leaveYearLabel(year)}</h3>
        {history.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#94a3b8' }}>None yet.</p>
        ) : (
          history.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0', borderTop: '1px solid #f1f5f9', fontSize: '0.875rem' }}>
              <span style={{ color: '#475569' }}>
                <b style={{ color: a.days > 0 ? '#166534' : '#b91c1c' }}>{a.days > 0 ? '+' : ''}{fmtDays(Number(a.days))}</b>{' '}
                {a.leave_type} — {a.reason}
              </span>
              <span style={{ color: '#94a3b8', flexShrink: 0 }}>{new Date(a.created_at).toLocaleDateString()}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const th: CSSProperties = { textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }
const td: CSSProperties = { padding: '0.625rem 0.75rem', verticalAlign: 'middle' }
const input: CSSProperties = { padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
const smallBtn: CSSProperties = { padding: '0.3125rem 0.75rem', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#374151', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer', whiteSpace: 'nowrap' }
const primaryBtn: CSSProperties = { padding: '0.5rem 1.125rem', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }
