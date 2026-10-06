import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Briefcase, Camera, FileText, KeyRound, Paperclip, Phone, ShieldAlert } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { useAuth } from '../contexts/AuthContext'
import { useMyProfile } from '../hooks/useMyProfile'
import type { ContactDraft, Manager } from '../hooks/useMyProfile'
import { useOnboarding } from '../hooks/useOnboarding'
import { useMyShift } from '../hooks/useShifts'
import { supabase } from '../lib/supabase'
import { IS_DEMO } from '../lib/demo'
import { EMPLOYEE_STATUS_COLORS, EMPLOYEE_STATUS_LABELS, fmtDate, fmtPhone, initials, normalizePhone, photoUrl, savePhoto } from '../lib/employees'
import { DOC_CATEGORIES, canRemoveOwn, openEmployeeDocument } from '../lib/onboarding'
import { LEAVE_DOC_ACCEPT, leaveDocProblem } from '../lib/leaveDocs'
import { shiftHours } from '../lib/shifts'
import type { DocCategory, EmployeeDocument } from '../types'

/** Employee: their own profile. Photo, phone and emergency contact are theirs to edit; job details are HR's. */
export default function ProfilePage() {
  const { employee } = useAuth()
  const { manager, saveContact } = useMyProfile(employee?.id)
  if (!employee) return <AppLayout medium><p>Loading…</p></AppLayout>
  return (
    <AppLayout medium>
      <Header />
      <JobCard manager={manager} />
      <ContactCard saveContact={saveContact} />
      <DocumentsCard />
      <PasswordCard />
    </AppLayout>
  )
}

function Header() {
  const { employee, refreshEmployee } = useAuth()
  const e = employee!
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photo = photoUrl(e)
  const status = EMPLOYEE_STATUS_COLORS[e.status]

  async function change(file: File | null) {
    setBusy(true)
    setError(null)
    try { await savePhoto(e, file); await refreshEmployee() } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  return (
    <section className="sb-card" style={{ marginBottom: '1rem', flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 84, height: 84, borderRadius: '50%', overflow: 'hidden', background: 'var(--green-soft, #e6f2e1)', color: 'var(--green-dark, #1d5a1f)', fontSize: 28, fontWeight: 800 }}>
          {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(e.full_name)}
        </span>
        <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-label={photo ? 'Change photo' : 'Add photo'} title={photo ? 'Change photo' : 'Add photo'}
          style={{ position: 'absolute', right: -2, bottom: -2, display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--surface, #fff)', background: 'var(--green, #3d7f1f)', color: '#fff', cursor: 'pointer' }}>
          <Camera size={15} />
        </button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) change(f) }} />
      </div>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-strong, #10261a)' }}>{e.full_name}</h1>
        <p style={{ margin: '2px 0 6px', fontSize: 14, color: 'var(--text-muted, #5b6f61)' }}>
          {[e.designation, e.employee_code].filter(Boolean).join(' · ')}
        </p>
        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: status.bg, color: status.text }}>
          {EMPLOYEE_STATUS_LABELS[e.status]}
          {e.status === 'probation' && e.probation_end_date && ` until ${fmtDate(e.probation_end_date)}`}
        </span>
        {busy && <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text-muted, #5b6f61)' }}>Saving photo…</span>}
        {photo && !busy && <button type="button" onClick={() => change(null)} style={{ ...linkBtn, marginLeft: 10 }}>Remove photo</button>}
        {error && <p style={errText}>{error}</p>}
      </div>
    </section>
  )
}

function JobCard({ manager }: { manager: Manager | null }) {
  const { employee } = useAuth()
  const e = employee!
  const { shift, loaded } = useMyShift()
  return (
    <Card icon={<Briefcase size={18} />} title="Job" aside="Managed by HR">
      <Row label="Department" value={e.department} />
      <Row label="Designation" value={e.designation} />
      <Row label="Employment type" value={e.employment_type} />
      <Row label="Work location" value={e.work_location} />
      <Row label="Joining date" value={e.joining_date ? fmtDate(e.joining_date) : null} />
      <Row label="Shift" value={loaded ? `${shift.name}, ${shiftHours(shift)}` : '…'} />
      <Row label="Reporting manager" value={manager ? (
        <span>
          {manager.full_name}{manager.designation && <span style={{ color: 'var(--text-muted, #5b6f61)' }}> · {manager.designation}</span>}
          {manager.phone && <><br /><a href={`tel:+${manager.phone}`} style={link}>{fmtPhone(manager.phone)}</a></>}
        </span>
      ) : null} />
      <p style={{ ...hint, marginTop: 10 }}>Something wrong here? Ask HR to update it.</p>
    </Card>
  )
}

function ContactCard({ saveContact }: { saveContact: (c: ContactDraft) => Promise<string | null> }) {
  const { employee, refreshEmployee } = useAuth()
  const e = employee!
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState({ phone: '', ec_name: '', ec_relation: '', ec_phone: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function start() {
    setF({
      phone: e.phone ? fmtPhone(e.phone) : '', ec_name: e.emergency_contact_name ?? '',
      ec_relation: e.emergency_contact_relation ?? '', ec_phone: e.emergency_contact_phone ?? '',
    })
    setError(null)
    setSaved(false)
    setEditing(true)
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    const phone = normalizePhone(f.phone)
    if (phone === undefined) return setError('Enter a valid phone number, e.g. +91 98765 43210.')
    setBusy(true)
    const err = await saveContact({ phone, ec_name: f.ec_name, ec_relation: f.ec_relation, ec_phone: f.ec_phone })
    if (!err) await refreshEmployee()
    setBusy(false)
    setError(err)
    if (!err) { setEditing(false); setSaved(true) }
  }

  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: ev.target.value }))

  return (
    <Card icon={<Phone size={18} />} title="Contact"
      aside={!editing ? <button type="button" onClick={start} style={linkBtn}>Edit</button> : undefined}>
      {editing ? (
        <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
          <Field label="Email (your login)"><span style={{ fontSize: 14, color: 'var(--text-muted, #5b6f61)' }}>{e.email}</span></Field>
          <Field label="Phone / WhatsApp" htmlFor="pf-phone">
            <input id="pf-phone" type="tel" value={f.phone} onChange={set('phone')} placeholder="+91 98765 43210" autoComplete="tel" style={inputStyle} />
          </Field>
          <div style={groupLabel}><ShieldAlert size={14} /> Emergency contact</div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Field label="Name" htmlFor="pf-ec-name"><input id="pf-ec-name" value={f.ec_name} onChange={set('ec_name')} maxLength={100} style={inputStyle} /></Field>
            <Field label="Relationship" htmlFor="pf-ec-rel"><input id="pf-ec-rel" value={f.ec_relation} onChange={set('ec_relation')} maxLength={50} placeholder="e.g. Mother" style={inputStyle} /></Field>
            <Field label="Phone" htmlFor="pf-ec-phone"><input id="pf-ec-phone" type="tel" value={f.ec_phone} onChange={set('ec_phone')} maxLength={30} placeholder="+91 98765 43210" style={inputStyle} /></Field>
          </div>
          {error && <p style={errText}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="sb-btn-ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="sb-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      ) : (
        <>
          <Row label="Email" value={e.email} />
          <Row label="Phone / WhatsApp" value={e.phone ? fmtPhone(e.phone) : null} />
          <div style={{ ...groupLabel, marginTop: 12 }}><ShieldAlert size={14} /> Emergency contact</div>
          <Row label="Name" value={e.emergency_contact_name} />
          <Row label="Relationship" value={e.emergency_contact_relation} />
          <Row label="Phone" value={e.emergency_contact_phone} />
          {saved && <p style={{ ...hint, color: 'var(--green-dark, #1d5a1f)', marginTop: 10 }}>Saved. HR can see the update.</p>}
        </>
      )}
    </Card>
  )
}

function DocumentsCard() {
  const { employee } = useAuth()
  const data = useOnboarding(employee!.id)
  const input = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<DocCategory>('Certificates')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const groups = DOC_CATEGORIES.map(c => ({ c, docs: data.docs.filter(d => d.category === c) })).filter(g => g.docs.length)

  async function add(files: FileList | null) {
    const picked = Array.from(files ?? [])
    const problem = picked.map(leaveDocProblem).find(Boolean)
    if (problem) return setError(problem)
    if (!picked.length) return
    setBusy('upload')
    setError((await data.upload(category, picked))[0] ?? null)
    setBusy(null)
  }

  async function remove(d: EmployeeDocument) {
    setBusy(d.id)
    setError(await data.removeOwn(d))
    setBusy(null)
  }

  return (
    <Card icon={<FileText size={18} />} title="My documents" aside={data.loading ? undefined : `${data.docs.length} file${data.docs.length === 1 ? '' : 's'}`}>
      {data.loading ? <p style={hint}>Loading…</p>
        : groups.length === 0 ? <p style={{ ...hint, marginBottom: 10 }}>No documents yet.</p>
        : groups.map(g => (
          <div key={g.c} style={{ marginBottom: 10 }}>
            <div style={groupLabel}>{g.c}</div>
            {g.docs.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 14, minWidth: 0 }}>
                <FileText size={15} style={{ flexShrink: 0, color: 'var(--text-muted, #5b6f61)' }} />
                <span title={d.file_name} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text, #2c4234)' }}>{d.file_name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-faint, #93a397)', whiteSpace: 'nowrap' }}>{fmtDate(new Date(d.uploaded_at))}</span>
                <button type="button" onClick={async () => setError(await openEmployeeDocument(d))} style={linkBtn}>View</button>
                {!d.resend_reason && !data.review && canRemoveOwn(d, employee!.id) && (
                  <button type="button" onClick={() => remove(d)} disabled={busy === d.id} aria-label={`Remove ${d.file_name}`} style={{ ...linkBtn, color: 'var(--red, #b42318)' }}>
                    {busy === d.id ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
        <select value={category} onChange={ev => setCategory(ev.target.value as DocCategory)} aria-label="Document type" style={{ ...inputStyle, width: 'auto' }}>
          {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" className="sb-btn-ghost" onClick={() => input.current?.click()} disabled={busy === 'upload'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 14 }}>
          <Paperclip size={15} /> {busy === 'upload' ? 'Uploading…' : 'Add file'}
        </button>
        <input ref={input} type="file" multiple accept={LEAVE_DOC_ACCEPT} hidden onChange={ev => { add(ev.target.files); ev.target.value = '' }} />
      </div>
      <p style={{ ...hint, marginTop: 8 }}>PDF, PNG, JPEG or Word, 10 MB each. You can remove your own upload for 24 hours; after that, ask HR.</p>
      {error && <p style={errText}>{error}</p>}
    </Card>
  )
}

function PasswordCard() {
  const { employee } = useAuth()
  const [f, setF] = useState({ current: '', next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(ev: React.FormEvent) {
    ev.preventDefault()
    if (f.next.length < 8) return setMsg({ ok: false, text: 'The new password must be at least 8 characters.' })
    if (f.next !== f.confirm) return setMsg({ ok: false, text: 'The new passwords don’t match.' })
    setBusy(true)
    setMsg(null)
    const check = await supabase.auth.signInWithPassword({ email: employee!.email, password: f.current })
    if (check.error) { setBusy(false); return setMsg({ ok: false, text: 'Your current password isn’t right.' }) }
    const { error } = await supabase.auth.updateUser({ password: f.next })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: error.code === 'same_password' ? 'Choose a password different from your current one.' : error.message })
    setF({ current: '', next: '', confirm: '' })
    setMsg({ ok: true, text: 'Password changed. Use the new one next time you sign in.' })
  }

  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: ev.target.value }))

  return (
    <Card icon={<KeyRound size={18} />} title="Password">
      {IS_DEMO ? <p style={hint}>Password changes are turned off in the demo.</p> : (
        <form onSubmit={save} style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
          <Field label="Current password" htmlFor="pw-current"><input id="pw-current" type="password" value={f.current} onChange={set('current')} autoComplete="current-password" required style={inputStyle} /></Field>
          <Field label="New password" htmlFor="pw-new"><input id="pw-new" type="password" value={f.next} onChange={set('next')} autoComplete="new-password" required style={inputStyle} /></Field>
          <Field label="Confirm new password" htmlFor="pw-confirm"><input id="pw-confirm" type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" required style={inputStyle} /></Field>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="submit" className="sb-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
            {msg && <span style={{ fontSize: 13, color: msg.ok ? 'var(--green-dark, #1d5a1f)' : 'var(--red, #b42318)' }}>{msg.text}</span>}
          </div>
        </form>
      )}
    </Card>
  )
}

function Card({ icon, title, aside, children }: { icon: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="sb-card" style={{ marginBottom: '1rem' }}>
      <div className="sb-card-head" style={{ marginBottom: 10 }}>
        {icon}<h2>{title}</h2>
        {aside && <span style={{ fontSize: 12, color: 'var(--text-faint, #93a397)' }}>{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border-soft, #edf3ea)', fontSize: 14 }}>
      <span style={{ width: 150, flexShrink: 0, color: 'var(--text-muted, #5b6f61)' }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, color: value ? 'var(--text-strong, #10261a)' : 'var(--text-faint, #93a397)', overflowWrap: 'anywhere' }}>{value || '—'}</span>
    </div>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text, #2c4234)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--border, #e2ebdf)',
  background: 'var(--surface-soft, #f1f7ee)', color: 'var(--text-strong, #10261a)', font: 'inherit', fontSize: 14,
}
const groupLabel: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--green-dark, #1d5a1f)', margin: '2px 0 4px' }
const hint: CSSProperties = { margin: 0, fontSize: 13, color: 'var(--text-muted, #5b6f61)' }
const errText: CSSProperties = { margin: '6px 0 0', fontSize: 13, color: 'var(--red, #b42318)' }
const link: CSSProperties = { color: 'var(--green-dark, #1d5a1f)', fontWeight: 600 }
const linkBtn: CSSProperties = {
  flexShrink: 0, padding: '2px 4px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 13, fontWeight: 600, color: 'var(--green-dark, #1d5a1f)', textDecoration: 'underline', textUnderlineOffset: 2,
}
