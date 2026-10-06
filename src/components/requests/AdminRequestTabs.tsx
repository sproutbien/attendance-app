import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { localDate } from '../../lib/calendar'
import { TRACKED_STATUSES } from '../../lib/employees'
import { shiftHours } from '../../lib/shifts'
import { fmtDuration } from '../../lib/breaks'
import { REQUEST_STATUS, fmtMinutes, fmtPermissionTime, fmtRequestDay, permissionMinutes, permissionOutcome } from '../../lib/requests'
import type { PermissionOutcome } from '../../lib/requests'
import type { useRequestQueue, ShiftChangeRow, PermissionRow } from '../../hooks/useRequests'
import { useShifts } from '../../hooks/useShifts'
import type { AttendanceRecord, RequestStatus } from '../../types'

type Queue = ReturnType<typeof useRequestQueue>

// ── Shift changes ───────────────────────────────────────────

/** Admin, Requests page: one-day shift changes to approve, set directly, and recent history. */
export function ShiftChangesTab({ q }: { q: Queue }) {
  const shifts = useShifts()
  const name = (id: string | null) => shifts.shifts.find(s => s.id === id)?.name ?? '—'
  const pending = q.shiftChanges.filter(c => c.status === 'pending').sort((a, b) => a.date.localeCompare(b.date))
  const history = q.shiftChanges.filter(c => c.status !== 'pending')

  return (
    <>
      <div style={{ ...card, marginBottom: '1.5rem' }}>
        <h2 style={sectionTitle}>Waiting for approval</h2>
        {q.loading ? <p style={muted}>Loading…</p>
          : pending.length === 0 ? <p style={empty}>All caught up. No shift changes waiting.</p>
          : <div style={{ display: 'grid', gap: '0.875rem' }}>
              {pending.map(c => (
                <Pending key={c.id} who={c.employee?.full_name ?? '—'} dept={c.employee?.department ?? null} date={c.date}
                  what={<><b>{name(c.shift_id)}</b> shift instead of <b>{name(c.from_shift_id)}</b>{shifts.shifts.find(s => s.id === c.shift_id) && <span style={{ color: '#64748b' }}> ({shiftHours(shifts.shifts.find(s => s.id === c.shift_id)!)})</span>}</>}
                  reason={c.reason} busy={q.busy.has(c.id)} onReview={(ok, note) => q.reviewShift(c.id, ok, note)} />
              ))}
            </div>}
      </div>

      <SetShiftChange q={q} shifts={shifts} />

      <div style={card}>
        <h2 style={sectionTitle}>Recent {!q.loading && `(${history.length})`}</h2>
        {history.length === 0 ? <p style={muted}>Nothing yet.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead><tr>{['Employee', 'Day', 'Change', 'Status', 'Note'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {history.map((c: ShiftChangeRow) => (
                  <tr key={c.id}>
                    <td style={td}>{c.employee?.full_name}</td>
                    <td style={td}>{fmtRequestDay(c.date)}</td>
                    <td style={td}>{name(c.from_shift_id)} → <b>{name(c.shift_id)}</b>{c.requested_by !== c.employee_id && c.status === 'approved' && <span style={{ color: '#94a3b8' }}> (set by admin)</span>}</td>
                    <td style={td}><Status s={c.status} /></td>
                    <td style={{ ...td, color: '#64748b' }}>{c.admin_note ?? c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function SetShiftChange({ q, shifts }: { q: Queue; shifts: ReturnType<typeof useShifts> }) {
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([])
  const [f, setF] = useState({ employee: '', date: localDate(), shift: '', note: '' })
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (!open || people.length) return
    supabase.from('employees').select('id, full_name').in('status', TRACKED_STATUSES).is('deleted_at', null).order('full_name')
      .then(({ data }) => setPeople(data ?? []))
  }, [open, people.length])

  const usual = f.employee ? shifts.shiftOn(f.employee, f.date) : null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const err = await q.setShiftFor(f.employee, f.date, f.shift, f.note.trim() || 'Set by admin')
    if (err) return setError(err)
    setDone(`${people.find(p => p.id === f.employee)?.full_name} works ${shifts.shifts.find(s => s.id === f.shift)?.name} on ${fmtRequestDay(f.date)}.`)
    setF({ employee: '', date: localDate(), shift: '', note: '' })
    setOpen(false)
    shifts.reload()
  }

  return (
    <div style={{ ...card, marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 style={{ ...sectionTitle, margin: 0 }}>Change someone’s shift for a day</h2>
        {!open && <button type="button" onClick={() => { setOpen(true); setDone(null) }} style={{ ...ghost, marginLeft: 'auto' }}>Set a shift change</button>}
      </div>
      {done && !open && <p style={{ margin: '0.625rem 0 0', fontSize: '0.875rem', color: '#166534' }}>{done}</p>}
      {open && (
        <form onSubmit={save} style={{ display: 'grid', gap: '0.75rem', marginTop: '0.875rem' }}>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <label style={label}>Employee
              <select required value={f.employee} onChange={e => setF({ ...f, employee: e.target.value })} style={input}>
                <option value="">Choose…</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </label>
            <label style={label}>Day<input type="date" required min={localDate()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} style={input} /></label>
            <label style={label}>Shift that day
              <select required value={f.shift} onChange={e => setF({ ...f, shift: e.target.value })} style={input}>
                <option value="">Choose…</option>
                {shifts.shifts.filter(s => s.id !== usual?.id).map(s => <option key={s.id} value={s.id}>{s.name} · {shiftHours(s)}</option>)}
              </select>
            </label>
          </div>
          {usual && <p style={hintText}>Usual shift that day: <b>{usual.name}</b>, {shiftHours(usual)}.</p>}
          <label style={label}>Note (optional)<input value={f.note} maxLength={300} onChange={e => setF({ ...f, note: e.target.value })} placeholder="e.g. Covering the evening desk" style={input} /></label>
          {error && <div style={errorBox}>{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" disabled={q.busy.has('set')} style={primary}>{q.busy.has('set') ? 'Saving…' : 'Save shift change'}</button>
            <button type="button" onClick={() => setOpen(false)} style={ghost}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Permissions ─────────────────────────────────────────────

/** Admin, Requests page: permissions to approve, whether time was made up, and the limits. */
export function PermissionsTab({ q }: { q: Queue }) {
  const shifts = useShifts()
  const today = localDate()
  const pending = q.permissions.filter(p => p.status === 'pending').sort((a, b) => a.date.localeCompare(b.date))
  const approved = q.permissions.filter(p => p.status === 'approved')
  const others = q.permissions.filter(p => p.status === 'rejected' || p.status === 'cancelled')
  const records = useRecordsFor(approved)
  const outcome = (p: PermissionRow) => permissionOutcome(p, records.get(`${p.employee_id}|${p.date}`), shifts.dayShift(p.employee_id, p.date), today)
  const short = approved.filter(p => outcome(p).kind === 'short').length

  return (
    <>
      <Limits q={q} />
      <div style={{ ...card, marginBottom: '1.5rem' }}>
        <h2 style={sectionTitle}>Waiting for approval</h2>
        {q.loading ? <p style={muted}>Loading…</p>
          : pending.length === 0 ? <p style={empty}>All caught up. No permissions waiting.</p>
          : <div style={{ display: 'grid', gap: '0.875rem' }}>
              {pending.map(p => (
                <Pending key={p.id} who={p.employee?.full_name ?? '—'} dept={p.employee?.department ?? null} date={p.date}
                  what={<><b>{fmtPermissionTime(p)}</b> ({fmtMinutes(permissionMinutes(p))}), to be made up the same day</>}
                  reason={p.reason} busy={q.busy.has(p.id)} onReview={(ok, note) => q.reviewPermission(p.id, ok, note)} />
              ))}
            </div>}
      </div>

      <div style={{ ...card, marginBottom: '1.5rem' }}>
        <h2 style={sectionTitle}>
          Approved {!q.loading && `(${approved.length})`}
          {short > 0 && <span style={{ marginLeft: 8, padding: '2px 10px', borderRadius: 99, background: '#fef3c7', color: '#92400e', fontSize: '0.75rem' }}>{short} short of hours</span>}
        </h2>
        {approved.length === 0 ? <p style={muted}>None in the last 90 days.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead><tr>{['Employee', 'Day', 'Time out', 'Made up?', 'Reason'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {approved.map(p => (
                  <tr key={p.id}>
                    <td style={td}>{p.employee?.full_name}</td>
                    <td style={td}>{fmtRequestDay(p.date)}</td>
                    <td style={td}>{fmtPermissionTime(p)} ({fmtMinutes(permissionMinutes(p))})</td>
                    <td style={td}><Outcome o={outcome(p)} /></td>
                    <td style={{ ...td, color: '#64748b' }}>{p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ ...hintText, marginTop: '0.75rem' }}>
          “Made up” compares the hours worked that day with the shift’s hours (shift length minus its minimum break). A shortfall is only flagged here; nothing is deducted.
        </p>
      </div>

      {others.length > 0 && (
        <div style={card}>
          <h2 style={sectionTitle}>Rejected or cancelled ({others.length})</h2>
          {others.map(p => (
            <div key={p.id} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', padding: '0.375rem 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.875rem' }}>
              <span style={{ minWidth: 150 }}>{p.employee?.full_name}</span>
              <span style={{ minWidth: 90 }}>{fmtRequestDay(p.date)}</span>
              <span style={{ flex: 1 }}>{fmtPermissionTime(p)}</span>
              <Status s={p.status} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** That day's attendance record for each approved permission. */
function useRecordsFor(list: PermissionRow[]) {
  const [map, setMap] = useState<Map<string, AttendanceRecord>>(new Map())
  const key = useMemo(() => list.map(p => p.id).sort().join(), [list])
  useEffect(() => {
    if (!list.length) return
    const ids = [...new Set(list.map(p => p.employee_id))]
    const dates = [...new Set(list.map(p => p.date))]
    supabase.from('attendance_records').select('*').in('employee_id', ids).in('date', dates)
      .then(({ data }) => setMap(new Map((data ?? []).map(r => [`${r.employee_id}|${r.date}`, r as AttendanceRecord]))))
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps
  return map
}

function Limits({ q }: { q: Queue }) {
  const [editing, setEditing] = useState(false)
  const [n, setN] = useState(String(q.limits.permission_monthly_limit))
  const [h, setH] = useState(String(q.limits.permission_max_minutes / 60))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setN(String(q.limits.permission_monthly_limit)); setH(String(q.limits.permission_max_minutes / 60)) }, [q.limits])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const count = Number(n), mins = Math.round(Number(h) * 60)
    if (!(count >= 0 && count <= 31)) return setError('Permissions a month must be between 0 and 31.')
    if (!(mins >= 15 && mins <= 480)) return setError('Each permission must be between 0.25 and 8 hours.')
    const err = await q.saveLimits({ permission_monthly_limit: count, permission_max_minutes: mins })
    if (err) return setError(err)
    setEditing(false)
  }

  return (
    <div style={{ ...card, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      {!editing ? (
        <>
          <span style={{ fontSize: '0.875rem', color: '#334155' }}>
            <b>Limits:</b> {q.limits.permission_monthly_limit} permission{q.limits.permission_monthly_limit === 1 ? '' : 's'} a month per person, up to {fmtMinutes(q.limits.permission_max_minutes)} each.
          </span>
          <button type="button" onClick={() => { setEditing(true); setError(null) }} style={{ ...ghost, marginLeft: 'auto' }}>Change limits</button>
        </>
      ) : (
        <form onSubmit={save} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', width: '100%' }}>
          <label style={label}>Permissions a month<input type="number" min={0} max={31} required value={n} onChange={e => setN(e.target.value)} style={{ ...input, width: 120 }} /></label>
          <label style={label}>Hours each (max)<input type="number" min={0.25} max={8} step={0.25} required value={h} onChange={e => setH(e.target.value)} style={{ ...input, width: 120 }} /></label>
          <button type="submit" disabled={q.busy.has('limits')} style={primary}>Save</button>
          <button type="button" onClick={() => setEditing(false)} style={ghost}>Cancel</button>
          {error && <div style={{ ...errorBox, width: '100%' }}>{error}</div>}
        </form>
      )}
    </div>
  )
}

function Outcome({ o }: { o: PermissionOutcome }) {
  const s = {
    upcoming:    { t: 'Not yet',               bg: '#f1f5f9', fg: '#64748b' },
    in_progress: { t: 'Today, still working',  bg: '#eff6ff', fg: '#1d4ed8' },
    no_check_in: { t: 'No check-in that day',  bg: '#fee2e2', fg: '#991b1b' },
    made_up:     { t: 'Time made up',          bg: '#dcfce7', fg: '#166534' },
    short:       { t: o.kind === 'short' ? `Short by ${fmtDuration(o.seconds)}` : '', bg: '#fef3c7', fg: '#92400e' },
  }[o.kind]
  return <span style={{ padding: '1px 9px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>{s.t}</span>
}

// ── Shared ──────────────────────────────────────────────────

function Pending({ who, dept, date, what, reason, busy, onReview }: {
  who: string; dept: string | null; date: string; what: React.ReactNode; reason: string; busy: boolean
  onReview: (approve: boolean, note: string) => Promise<string | null>
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const act = async (ok: boolean) => { setError(null); const err = await onReview(ok, note); if (err) setError(err) }
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '0.875rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        <b style={{ color: '#1e293b' }}>{who}</b>{dept && <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>{dept}</span>}
        <span style={{ marginLeft: 'auto', fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>{fmtRequestDay(date)}</span>
      </div>
      <div style={{ fontSize: '0.875rem', color: '#334155', margin: '0.25rem 0' }}>{what}</div>
      <div style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '0.625rem' }}>Reason: {reason}</div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Note to the employee (optional)" aria-label="Note" style={{ ...input, flex: '1 1 220px', width: 'auto' }} />
        <button type="button" disabled={busy} onClick={() => act(true)} style={{ ...primary, background: '#16a34a' }}>Approve</button>
        <button type="button" disabled={busy} onClick={() => act(false)} style={{ ...ghost, color: '#dc2626', borderColor: '#fecaca' }}>Reject</button>
      </div>
      {error && <div style={{ ...errorBox, marginTop: '0.5rem' }}>{error}</div>}
    </div>
  )
}

function Status({ s }: { s: RequestStatus }) {
  const st = REQUEST_STATUS[s]
  return <span style={{ padding: '1px 9px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600, background: st.bg, color: st.fg }}>{st.label}</span>
}

const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const sectionTitle: CSSProperties = { margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }
const muted: CSSProperties = { margin: 0, color: '#94a3b8', fontSize: '0.875rem' }
const empty: CSSProperties = { margin: 0, padding: '0.75rem 0', textAlign: 'center', color: '#64748b', fontWeight: 500 }
const hintText: CSSProperties = { margin: 0, fontSize: '0.8125rem', color: '#64748b' }
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }
const th: CSSProperties = { textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }
const td: CSSProperties = { padding: '0.625rem 0.75rem', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }
const label: CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.625rem', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', background: '#fff', color: '#1e293b' }
const primary: CSSProperties = { padding: '0.5rem 1rem', background: 'var(--brand-600)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit' }
const ghost: CSSProperties = { padding: '0.5rem 0.875rem', background: '#fff', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 500, fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit' }
const errorBox: CSSProperties = { padding: '0.5rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: '0.8125rem' }
