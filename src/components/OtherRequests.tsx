import { useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowLeftRight, Timer } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useMyRequests } from '../hooks/useRequests'
import { useMyShift } from '../hooks/useShifts'
import { localDate } from '../lib/calendar'
import { shiftHours } from '../lib/shifts'
import { REQUEST_STATUS, fmtMinutes, fmtPermissionTime, fmtRequestDay, permissionMinutes } from '../lib/requests'
import type { RequestStatus } from '../types'

type Data = ReturnType<typeof useMyRequests>

/**
 * Employee, Leave page: working different hours on a day, without taking leave.
 *   Change shift for a day (e.g. Afternoon instead of Morning) · Permission (a few hours out, made up the same day)
 * Both need an admin's approval (migration 042).
 */
export default function OtherRequests() {
  const { employee } = useAuth()
  const data = useMyRequests(employee?.id)
  const [open, setOpen] = useState<'shift' | 'permission' | null>(null)
  const today = localDate()

  const rows = [
    ...data.shiftChanges.map(c => ({ kind: 'shift' as const, id: c.id, date: c.date, status: c.status, note: c.admin_note, reason: c.reason,
      title: `${data.shifts.find(s => s.id === c.shift_id)?.name ?? 'Another'} shift${c.from_shift_id ? ` instead of ${data.shifts.find(s => s.id === c.from_shift_id)?.name ?? 'usual'}` : ''}` })),
    ...data.permissions.map(p => ({ kind: 'permission' as const, id: p.id, date: p.date, status: p.status, note: p.admin_note, reason: p.reason,
      title: `Permission ${fmtPermissionTime(p)} (${fmtMinutes(permissionMinutes(p))})` })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <section className="sb-card" style={{ marginTop: '1.5rem' }}>
      <div className="sb-card-head" style={{ marginBottom: 6 }}><ArrowLeftRight size={18} /><h2>Other requests</h2></div>
      <p style={{ margin: '0 0 0.875rem', fontSize: '0.875rem', color: 'var(--text-muted, #5b6f61)', lineHeight: 1.5 }}>
        Working different hours on a day? Ask here instead of taking leave, so no leave is used.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen(open === 'shift' ? null : 'shift')} aria-expanded={open === 'shift'} style={open === 'shift' ? btnOn : btn}>
          <ArrowLeftRight size={15} /> Change shift for a day
        </button>
        <button type="button" onClick={() => setOpen(open === 'permission' ? null : 'permission')} aria-expanded={open === 'permission'} style={open === 'permission' ? btnOn : btn}>
          <Timer size={15} /> Ask for permission (a few hours)
        </button>
      </div>

      {open === 'shift' && <ShiftChangeForm data={data} today={today} onDone={() => setOpen(null)} />}
      {open === 'permission' && <PermissionForm data={data} today={today} onDone={() => setOpen(null)} />}

      {rows.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <div style={groupLabel}>My requests</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map(r => <RequestRow key={r.kind + r.id} row={r} today={today} onCancel={() => data.cancel(r.kind, r.id)} />)}
          </ul>
        </div>
      )}
    </section>
  )
}

function ShiftChangeForm({ data, today, onDone }: { data: Data; today: string; onDone: () => void }) {
  const [date, setDate] = useState(today)
  const [shiftId, setShiftId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { shift: usual, loaded } = useMyShift(date || today)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!shiftId) return setError('Choose the shift you want to work.')
    setBusy(true)
    const err = await data.requestShiftChange(date, shiftId, reason.trim())
    setBusy(false)
    if (err) return setError(err)
    onDone()
  }

  return (
    <form onSubmit={submit} style={formBox}>
      <div style={grid}>
        <Field label="Day" htmlFor="sc-date"><input id="sc-date" type="date" min={today} required value={date} onChange={e => { setDate(e.target.value); setError(null) }} style={input} /></Field>
        <Field label="Work this shift instead" htmlFor="sc-shift">
          <select id="sc-shift" required value={shiftId} onChange={e => { setShiftId(e.target.value); setError(null) }} style={input}>
            <option value="">Choose a shift…</option>
            {data.shifts.filter(s => !loaded || s.id !== usual.id).map(s => <option key={s.id} value={s.id}>{s.name} · {shiftHours(s)}</option>)}
          </select>
        </Field>
      </div>
      {loaded && <p style={hint}>Your shift that day: <b>{usual.name}</b>, {shiftHours(usual)}.</p>}
      <Field label="Reason" htmlFor="sc-reason">
        <input id="sc-reason" required maxLength={300} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Doctor’s appointment in the morning" style={input} />
      </Field>
      <p style={hint}>Your admin approves it. On the day, all the timings (late, half day, breaks) follow the new shift.</p>
      {error && <p style={errText}>{error}</p>}
      <Actions busy={busy} onCancel={onDone} />
    </form>
  )
}

function PermissionForm({ data, today, onDone }: { data: Data; today: string; onDone: () => void }) {
  const [date, setDate] = useState(today)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { shift, loaded } = useMyShift(date || today)
  const max = data.limits.permission_max_minutes
  const left = Math.max(0, data.limits.permission_monthly_limit - data.usedInMonth(date || today))
  const month = new Date(`${date || today}T00:00:00`).toLocaleDateString('en-IN', { month: 'long' })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const err = await data.requestPermission(date, start, end, reason.trim())
    setBusy(false)
    if (err) return setError(err)
    onDone()
  }

  return (
    <form onSubmit={submit} style={formBox}>
      <div style={grid}>
        <Field label="Day" htmlFor="pm-date"><input id="pm-date" type="date" min={today} required value={date} onChange={e => { setDate(e.target.value); setError(null) }} style={input} /></Field>
        <Field label="From" htmlFor="pm-start"><input id="pm-start" type="time" required value={start} onChange={e => { setStart(e.target.value); setError(null) }} style={input} /></Field>
        <Field label="To" htmlFor="pm-end"><input id="pm-end" type="time" required value={end} onChange={e => { setEnd(e.target.value); setError(null) }} style={input} /></Field>
      </div>
      <p style={hint}>
        Up to <b>{fmtMinutes(max)}</b>{loaded && <>, within your shift ({shiftHours(shift)})</>}.{' '}
        <b style={{ color: left === 0 ? 'var(--red, #b42318)' : 'inherit' }}>{left} of {data.limits.permission_monthly_limit}</b> left in {month}.
      </p>
      <Field label="Reason" htmlFor="pm-reason">
        <input id="pm-reason" required maxLength={300} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Bank work" style={input} />
      </Field>
      <p style={hint}>Make up the time the same day by checking out later. Use <b>Break</b> while you’re away.</p>
      {error && <p style={errText}>{error}</p>}
      <Actions busy={busy} onCancel={onDone} disabled={left === 0} />
    </form>
  )
}

function RequestRow({ row: r, today, onCancel }: {
  row: { kind: 'shift' | 'permission'; date: string; status: RequestStatus; note: string | null; reason: string; title: string }
  today: string
  onCancel: () => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = REQUEST_STATUS[r.status]
  const cancellable = r.status === 'pending' || (r.status === 'approved' && r.date > today)
  return (
    <li style={{ padding: '0.625rem 0', borderTop: '1px solid var(--border-soft, #edf3ea)', fontSize: '0.875rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {r.kind === 'shift' ? <ArrowLeftRight size={15} style={{ color: 'var(--text-muted, #5b6f61)', flexShrink: 0 }} /> : <Timer size={15} style={{ color: 'var(--text-muted, #5b6f61)', flexShrink: 0 }} />}
        <b style={{ color: 'var(--text-strong, #10261a)', flex: 1 }}>{fmtRequestDay(r.date)}</b>
        <span style={{ padding: '1px 9px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600, background: s.bg, color: s.fg }}>{s.label}</span>
        {cancellable && (
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(await onCancel()); setBusy(false) }} style={linkBtn}>
            {busy ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
      <div style={{ marginLeft: 23, color: 'var(--text, #2c4234)' }}>{r.title}</div>
      <div style={{ marginLeft: 23, fontSize: '0.8125rem', color: 'var(--text-muted, #5b6f61)' }}>
        {r.reason}{r.note && <> · <b>Admin:</b> {r.note}</>}
      </div>
      {error && <p style={{ ...errText, marginLeft: 23 }}>{error}</p>}
    </li>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text, #2c4234)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

function Actions({ busy, onCancel, disabled = false }: { busy: boolean; onCancel: () => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
      <button type="button" className="sb-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="submit" className="sb-btn-primary" disabled={busy || disabled}>{busy ? 'Sending…' : 'Send request'}</button>
    </div>
  )
}

const btn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '0 0.875rem', borderRadius: 10,
  border: '1px solid var(--border, #e2ebdf)', background: 'var(--surface, #fff)', color: 'var(--text-strong, #10261a)',
  fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit',
}
const btnOn: CSSProperties = { ...btn, borderColor: 'var(--green, #3d7f1f)', background: 'var(--green-soft, #e6f2e1)', color: 'var(--green-dark, #1d5a1f)' }
const formBox: CSSProperties = { display: 'grid', gap: 10, marginTop: '0.875rem', padding: '0.875rem', borderRadius: 12, background: 'var(--surface-soft, #f1f7ee)', border: '1px solid var(--border, #e2ebdf)' }
const grid: CSSProperties = { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }
const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--border, #e2ebdf)',
  background: 'var(--surface, #fff)', color: 'var(--text-strong, #10261a)', font: 'inherit', fontSize: 14,
}
const hint: CSSProperties = { margin: 0, fontSize: 13, color: 'var(--text-muted, #5b6f61)', lineHeight: 1.5 }
const errText: CSSProperties = { margin: 0, fontSize: 13, color: 'var(--red, #b42318)' }
const groupLabel: CSSProperties = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--green-dark, #1d5a1f)', marginBottom: 2 }
const linkBtn: CSSProperties = {
  padding: '2px 4px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: '0.8125rem', fontWeight: 600, color: 'var(--red, #b42318)', textDecoration: 'underline', textUnderlineOffset: 2,
}
