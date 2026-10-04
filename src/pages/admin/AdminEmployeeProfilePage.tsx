import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Camera, ChartColumn } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { profileUpdates, useEmployeeManagement, useEmployeeOptions, useHrNotes } from '../../hooks/useEmployeeManagement'
import type { EmployeeFormData } from '../../hooks/useEmployeeManagement'
import { BLOCKED_STATUSES, fmtDate, fmtPhone, savePhoto } from '../../lib/employees'
import { shiftHours } from '../../lib/shifts'
import { useShifts } from '../../hooks/useShifts'
import EmployeeAvatar from '../../components/employees/EmployeeAvatar'
import StatusBadge from '../../components/employees/StatusBadge'
import EmployeeFormModal from '../../components/employees/EmployeeFormModal'
import { DocumentsCard, OnboardingCard } from '../../components/onboarding/AdminOnboarding'
import { useOnboarding } from '../../hooks/useOnboarding'
import { daysUntil, notStartedYet, relativeDays } from '../../lib/onboarding'
import { supabase } from '../../lib/supabase'
import { card, errorBox, ghostBtn, hintStyle, inputStyle, primaryBtn, successBox } from '../../components/employees/styles'
import type { Employee } from '../../types'

/** Admin: one employee's full profile, photo and HR notes. */
export default function AdminEmployeeProfilePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { employee: me } = useAuth()
  const { employees, loading, saving, error, setError, updateEmployee, refetch } = useEmployeeManagement()
  const lists = useEmployeeOptions()
  const shifts = useShifts()
  const [editing, setEditing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const onboarding = useOnboarding(id)

  const e = employees.find(x => x.id === id)

  if (loading) return <div style={{ ...card, color: '#94a3b8', padding: '2rem' }}>Loading…</div>
  if (!e) {
    return (
      <div style={card}>
        <p style={{ margin: '0 0 1rem', color: '#64748b' }}>Employee not found.</p>
        <Link to="/admin/employees" style={{ color: '#16a34a' }}>← Back to employees</Link>
      </div>
    )
  }

  const manager = e.reporting_manager_id ? employees.find(x => x.id === e.reporting_manager_id) : null
  const reports = employees.filter(x => x.reporting_manager_id === e.id && !x.deleted_at)
  const former = BLOCKED_STATUSES.includes(e.status)
  const designations = [...new Set(employees.map(x => x.designation).filter((d): d is string => !!d))].sort()

  function show(msg: string) {
    setFlash(msg)
    setTimeout(() => setFlash(null), 4000)
  }

  async function handleSave(data: EmployeeFormData) {
    if (!(await updateEmployee(id, profileUpdates(data)))) return
    if (data.shift) {
      const err = await shifts.assign(id, data.shift.id, data.shift.from)
      if (err) { setError(`Profile saved, but the shift wasn't changed: ${err}`); return }
    }
    setEditing(false)
    show('Profile updated.')
  }

  const shift = shifts.shiftOn(id)
  const upcoming = shifts.upcomingFor(id)

  return (
    <div>
      <button onClick={() => navigate('/admin/employees')} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: '1rem' }}>
        <ArrowLeft size={16} /> Employees
      </button>

      {flash && <div style={successBox}>{flash}</div>}

      {/* Header */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <PhotoPicker employee={e} dim={former} onChanged={async () => { await refetch(); show('Photo updated.') }} />
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>{e.full_name}</h1>
            <StatusBadge status={e.status} />
          </div>
          <div style={{ color: '#64748b', fontSize: '0.875rem', marginTop: 4 }}>
            <strong style={{ color: '#475569' }}>{e.employee_code}</strong>
            {e.designation && <> · {e.designation}</>}
            {e.department && <> · {e.department}</>}
          </div>
          {former && <div style={{ color: '#dc2626', fontSize: '0.8125rem', marginTop: 6 }}>Login blocked — not included in attendance or leave.</div>}
          {e.status === 'on_notice' && e.last_working_day && (
            <div style={{ color: '#92400e', fontSize: '0.8125rem', marginTop: 6 }}>Last working day {fmtDate(e.last_working_day)}.</div>
          )}
          {notStartedYet(e) && (
            <div style={{ color: '#1d4ed8', fontSize: '0.8125rem', marginTop: 6 }}>
              Joins {fmtDate(e.joining_date!)} ({relativeDays(daysUntil(e.joining_date!))}). Can log in to finish onboarding; check-in opens that day.
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to={`/admin/employees/${e.id}/stats`} style={{ ...ghostBtn, padding: '0.5rem 0.875rem', fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            <ChartColumn size={16} /> Statistics
          </Link>
          <button onClick={() => { setError(null); setEditing(true) }} style={primaryBtn}>Edit profile</button>
        </div>
      </div>

      {!former && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', alignItems: 'start', marginBottom: '1.5rem' }}>
          <OnboardingCard employee={e} data={onboarding} />
          <DocumentsCard employee={e} data={onboarding} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
        <InfoCard title="Job">
          <Row label="Employment type" value={e.employment_type} />
          <Row label="Department" value={e.department} />
          <Row label="Designation" value={e.designation} />
          <Row label="Work location" value={e.work_location} />
          <Row label="Shift" value={shift && (
            <>
              {shift.name} · {shiftHours(shift)}
              {upcoming && <div style={{ color: '#92400e', fontSize: '0.75rem', fontWeight: 500 }}>→ {upcoming.shift.name} from {fmtDate(upcoming.from)}</div>}
            </>
          )} />
          <Row label="Reporting manager" value={manager ? <Link to={`/admin/employees/${manager.id}`} style={link}>{manager.full_name}</Link> : null} />
          <Row label="Role" value={e.role === 'admin' ? 'Admin' : 'Employee'} />
        </InfoCard>

        <InfoCard title="Employment">
          <Row label="Status" value={<StatusBadge status={e.status} />} />
          <Row label="Date of joining" value={e.joining_date && fmtDate(e.joining_date)} />
          {(e.status === 'probation' || e.probation_end_date) && (
            <Row label="Probation ends" value={
              <ProbationValue employee={e} onConfirmed={async () => { await refetch(); show(`${e.full_name} is now Active. Noted in HR notes.`) }} />
            } />
          )}
          {(e.last_working_day || e.status === 'on_notice') && <Row label="Last working day" value={e.last_working_day && fmtDate(e.last_working_day)} />}
          <Row label="Monthly gross salary" value={e.monthly_salary != null ? `₹${e.monthly_salary.toLocaleString('en-IN')}` : null} />
          <Row label="Account created" value={fmtDate(new Date(e.created_at))} />
        </InfoCard>

        <InfoCard title="Contact">
          <Row label="Email" value={<a href={`mailto:${e.email}`} style={link}>{e.email}</a>} />
          <Row label="Phone / WhatsApp" value={e.phone && fmtPhone(e.phone)} />
        </InfoCard>

        <InfoCard title="Emergency contact">
          <Row label="Name" value={e.emergency_contact_name} />
          <Row label="Relationship" value={e.emergency_contact_relation} />
          <Row label="Phone" value={e.emergency_contact_phone} />
        </InfoCard>

        <InfoCard title={`Direct reports (${reports.length})`}>
          {reports.length === 0 ? (
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.875rem' }}>Nobody reports to {e.full_name.split(' ')[0]}.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {reports.map(r => (
                <li key={r.id} style={{ padding: '0.375rem 0' }}>
                  <Link to={`/admin/employees/${r.id}`} style={{ ...link, display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <EmployeeAvatar employee={r} size={28} />
                    <span>{r.full_name}<span style={{ color: '#94a3b8' }}>{r.designation ? ` · ${r.designation}` : ''}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </InfoCard>

        <HrNotes key={`${e.id}-${e.status}`} employee={e} adminId={me?.id ?? ''} />
      </div>

      {editing && (
        <EmployeeFormModal
          existing={e}
          isSelf={e.id === me?.id}
          employees={employees}
          options={{ department: lists.byKind('department'), work_location: lists.byKind('work_location'), employment_type: lists.byKind('employment_type') }}
          shifts={shifts.shifts}
          currentShift={shift}
          upcomingShift={upcoming}
          designations={designations}
          saving={saving}
          error={error}
          onSave={handleSave}
          onClose={() => { setEditing(false); setError(null) }}
        />
      )}
    </div>
  )
}

/** Probation end date; while on probation, a Confirm button that makes them Active. */
function ProbationValue({ employee: e, onConfirmed }: { employee: Employee; onConfirmed: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const n = e.probation_end_date ? daysUntil(e.probation_end_date) : null

  async function confirm() {
    setBusy(true)
    const { error } = await supabase.rpc('confirm_probation', { p_employee: e.id })
    setBusy(false)
    setAsking(false)
    if (error) setErr(error.message)
    else onConfirmed()
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <span>
        {e.probation_end_date ? fmtDate(e.probation_end_date) : 'Not set'}
        {e.status === 'probation' && n !== null && <span style={{ color: n < 0 ? '#b45309' : '#94a3b8', fontWeight: 400 }}> · {relativeDays(n)}</span>}
      </span>
      {e.status === 'probation' && (asking ? (
        <span style={{ display: 'flex', gap: 6 }}>
          <button onClick={confirm} disabled={busy} style={{ ...primaryBtn, padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}>Make Active</button>
          <button onClick={() => setAsking(false)} style={{ ...ghostBtn, padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>Cancel</button>
        </span>
      ) : (
        <button onClick={() => setAsking(true)} style={{ ...ghostBtn, padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}>Confirm probation</button>
      ))}
      {err && <span style={{ color: '#dc2626', fontSize: '0.75rem', fontWeight: 400 }}>{err}</span>}
    </span>
  )
}

function PhotoPicker({ employee, dim, onChanged }: { employee: Employee; dim: boolean; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function apply(file: File | null) {
    setBusy(true)
    setErr(null)
    try {
      await savePhoto(employee, file)
      onChanged()
    } catch (x) {
      setErr((x as Error).message)
    }
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <button
        onClick={() => input.current?.click()} disabled={busy} aria-label="Change photo"
        style={{ position: 'relative', padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: '50%', opacity: busy ? 0.5 : 1 }}
      >
        <EmployeeAvatar employee={employee} size={84} dim={dim} />
        <span style={{ position: 'absolute', right: 0, bottom: 0, background: '#16a34a', color: '#fff', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>
          <Camera size={14} />
        </span>
      </button>
      {employee.photo_path && (
        <button onClick={() => apply(null)} disabled={busy} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}>
          Remove photo
        </button>
      )}
      {err && <span style={{ color: '#dc2626', fontSize: '0.75rem', maxWidth: 140, textAlign: 'center' }}>{err}</span>}
      <input
        ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden
        onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) apply(f) }}
      />
    </div>
  )
}

function HrNotes({ employee, adminId }: { employee: Employee; adminId: string }) {
  const { notes, updatedAt, loading, save } = useHrNotes(employee.id)
  const [draft, setDraft] = useState<string | null>(null)   // null = not editing
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave() {
    if (draft === null) return
    setBusy(true)
    const e = await save(draft, adminId)
    setBusy(false)
    setErr(e)
    if (!e) setDraft(null)
  }

  return (
    <InfoCard title="HR notes" aside="Admins only">
      {loading ? <p style={{ margin: 0, color: '#94a3b8' }}>Loading…</p>
        : draft !== null ? (
          <>
            <textarea value={draft} onChange={ev => setDraft(ev.target.value)} rows={6} autoFocus style={{ ...inputStyle, resize: 'vertical', fontSize: '0.875rem' }} />
            {err && <div style={{ ...errorBox, marginTop: '0.5rem' }}>{err}</div>}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.625rem' }}>
              <button onClick={() => { setDraft(null); setErr(null) }} style={ghostBtn}>Cancel</button>
              <button onClick={handleSave} disabled={busy} style={{ ...primaryBtn, padding: '0.375rem 0.875rem', fontSize: '0.8125rem', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.875rem', color: notes ? '#1e293b' : '#94a3b8', lineHeight: 1.5 }}>
              {notes || 'No notes yet.'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem' }}>
              <span style={hintStyle}>{updatedAt ? `Updated ${fmtDate(new Date(updatedAt))}` : ''}</span>
              <button onClick={() => setDraft(notes)} style={ghostBtn}>{notes ? 'Edit' : 'Add notes'}</button>
            </div>
          </>
        )}
    </InfoCard>
  )
}

function InfoCard({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
        <h2 style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</h2>
        {aside && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.4375rem 0', borderBottom: '1px solid #f8fafc', fontSize: '0.875rem' }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ color: value ? '#1e293b' : '#cbd5e1', fontWeight: 500, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value || '—'}</span>
    </div>
  )
}

const link: CSSProperties = { color: '#15803d', textDecoration: 'none' }
