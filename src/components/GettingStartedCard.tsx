import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { AlertTriangle, BadgeCheck, Check, ChevronDown, FileText, Hourglass, ListChecks, Paperclip, Plus, RotateCcw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useOnboarding } from '../hooks/useOnboarding'
import { LEAVE_DOC_ACCEPT, leaveDocProblem } from '../lib/leaveDocs'
import { fmtHolidayDay } from '../lib/holidays'
import { DOC_CATEGORIES, canRemoveOwn, notStartedYet, openEmployeeDocument, progress, verificationState } from '../lib/onboarding'
import type { EmployeeDocument, OnboardingTask } from '../types'
import { useBranding } from '../contexts/BrandingContext'

type Data = ReturnType<typeof useOnboarding>

/**
 * Employee Dashboard: their onboarding steps, collapsed to one line.
 *   steps left / HR wants a file again → pulses until done
 *   all done → "HR is reviewing"
 *   HR verified → notice with Done, then the card goes for good (migration 039)
 * Before the joining date it also welcomes them.
 */
export default function GettingStartedCard() {
  const { employee } = useAuth()
  const { branding } = useBranding()
  const data = useOnboarding(employee?.id)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (data.loading || !employee) return null

  const mine = data.tasks.filter(t => t.assignee === 'employee')
  const p = progress(mine)
  const state = verificationState(data.tasks, data.docs, data.review)
  const early = notStartedYet(employee)
  const firstName = employee.full_name.split(' ')[0]
  const welcome = early && (
    <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: 'var(--text, #2c4234)', lineHeight: 1.5 }}>
      Welcome to {branding.company_name}, {firstName}! You start on <b>{fmtHolidayDay(employee.joining_date!)}</b>. Check-in opens that day.
    </p>
  )

  if (state === 'verified' && !data.review!.seen_at) {
    return (
      <div className="sb-card" role="status" style={{ marginBottom: '1.25rem', flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px solid color-mix(in srgb, var(--ok, #2e9b2a) 45%, transparent)' }}>
        <BadgeCheck size={24} style={{ color: 'var(--ok, #2e9b2a)', flexShrink: 0 }} />
        <span style={{ flex: '1 1 220px', fontSize: 14, color: 'var(--text-strong, #10261a)' }}>
          <b>HR has verified all your documents.</b>{' '}
          <span style={{ color: 'var(--text-muted, #5b6f61)' }}>You’re all set!</span>
        </span>
        <button type="button" className="sb-btn-primary" disabled={busy} style={{ minHeight: 40, padding: '0 1.25rem' }}
          onClick={async () => { setBusy(true); await data.dismissVerified(); setBusy(false) }}>
          Done
        </button>
      </div>
    )
  }
  if (state === 'none' || state === 'verified') {
    return early ? <div className="sb-card" style={{ marginBottom: '1.25rem' }}>{welcome}</div> : null
  }

  // Re-send requests with no matching step of their own (e.g. HR uploaded it) get one
  const flagged = data.docs.filter(d => d.resend_reason)
  const extra = DOC_CATEGORIES
    .filter(c => flagged.some(d => d.category === c) && !mine.some(t => t.document_category === c))
    .map((c): OnboardingTask => ({
      id: `resend-${c}`, employee_id: employee.id, title: `Re-send your ${c}`, details: null, assignee: 'employee',
      document_category: c, action: null, sort_order: 0, done_at: null, done_by: null, created_at: '',
    }))

  const head = {
    todo:   { icon: <ListChecks size={20} />, title: 'Complete your joining steps', chip: `${p.done} of ${p.total} done` },
    resend: { icon: <AlertTriangle size={20} style={{ color: 'var(--amber, #c27a0e)' }} />, title: `HR asked you to re-send ${flagged.length === 1 ? 'a document' : `${flagged.length} documents`}`, chip: 'Action needed' },
    ready:  { icon: <Hourglass size={20} />, title: 'Thanks! HR is reviewing your documents.', chip: 'With HR' },
  }[state]
  const pulse = state === 'todo' ? ' sb-attention' : state === 'resend' ? ' sb-attention is-amber' : ''

  return (
    <div className={`sb-card${pulse}`} style={{ marginBottom: '1.25rem' }}>
      <button type="button" className="sb-card-head" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ margin: 0, padding: 0, border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left', width: '100%', color: 'inherit' }}>
        {head.icon}
        <h2 style={{ flex: 1, minWidth: 0 }}>{head.title}</h2>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span className="sb-chip" style={state === 'resend' ? { background: 'var(--amber-soft, #fbefd3)' } : undefined}>{head.chip}</span>
          <ChevronDown size={18} style={{ color: 'var(--text-muted, #5b6f61)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </span>
      </button>
      {open && (
        <div style={{ marginTop: '0.875rem' }}>
          {welcome}
          {state === 'ready' && (
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: 'var(--text-muted, #5b6f61)' }}>
              You’ll see a message here once HR has checked them.
            </p>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {[...extra, ...mine].map(t => <Step key={t.id} task={t} data={data} />)}
          </ul>
        </div>
      )}
    </div>
  )
}

function Step({ task: t, data }: { task: OnboardingTask; data: Data }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const done = !!t.done_at
  const files = t.document_category ? data.docs.filter(d => d.category === t.document_category) : []
  const resend = files.some(d => d.resend_reason)

  async function upload(files: FileList | null) {
    const picked = Array.from(files ?? [])
    const problem = picked.map(leaveDocProblem).find(Boolean)
    if (problem) return setError(problem)
    if (!picked.length) return
    setBusy(true)
    const errors = await data.upload(t.document_category!, picked)
    setBusy(false)
    setError(errors[0] ?? null)
  }

  async function toggle() {
    setBusy(true)
    setError(await data.setDone(t.id, !done))
    setBusy(false)
  }

  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 0', borderTop: '1px solid var(--border-soft, #edf3ea)', flexWrap: 'wrap' }}>
      <span aria-hidden="true" style={{ ...tick, ...(done ? tickDone : null) }}>{done && <Check size={14} strokeWidth={3} />}</span>
      <span style={{ flex: '1 1 200px', minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '0.9375rem', fontWeight: 600, color: done ? 'var(--text-faint, #93a397)' : 'var(--text-strong, #10261a)' }}>
          {t.title}
        </span>
        {t.details && <span style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-muted, #5b6f61)' }}>{t.details}</span>}
        {files.length > 0 && (
          <ul style={{ listStyle: 'none', margin: '0.375rem 0 0', padding: 0, display: 'grid', gap: 4 }}>
            {files.map(d => <FileRow key={d.id} doc={d} data={data} onError={setError} />)}
          </ul>
        )}
        {error && <span style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--red, #b42318)' }}>{error}</span>}
      </span>
      {t.action === 'leave_policy' ? (
        done ? <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--green, #3d7f1f)' }}>Read</span>
          : <Link to="/leave-policy" style={{ ...btn, textDecoration: 'none' }}>Read it</Link>
      ) : t.document_category ? (
        <>
          <button type="button" onClick={() => input.current?.click()} disabled={busy} style={resend ? btnAmber : done ? btnQuiet : btn}>
            {resend ? <RotateCcw size={15} /> : done ? <Plus size={15} /> : <Paperclip size={15} />}{' '}
            {busy ? 'Uploading…' : resend ? 'Upload again' : done ? 'Add file' : 'Upload'}
          </button>
          <input ref={input} type="file" multiple accept={LEAVE_DOC_ACCEPT} hidden onChange={e => { upload(e.target.files); e.target.value = '' }} />
        </>
      ) : (
        <button type="button" onClick={toggle} disabled={busy} aria-pressed={done} style={done ? btnQuiet : btn}>
          {done ? 'Undo' : 'Mark done'}
        </button>
      )}
    </li>
  )
}

/** One uploaded file: name, View, Remove while it's their own upload from the last day, or HR's re-send reason. */
function FileRow({ doc, data, onError }: {
  doc: EmployeeDocument
  data: Data
  onError: (message: string | null) => void
}) {
  const { employee } = useAuth()
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    onError(null)
    const error = await data.removeOwn(doc)
    if (error) { onError(error); setBusy(false) }   // on success the row disappears
  }

  return (
    <li style={{ fontSize: '0.8125rem', color: 'var(--text, #2c4234)', minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <FileText size={14} style={{ flexShrink: 0, color: 'var(--text-muted, #5b6f61)' }} />
        <span title={doc.file_name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, textDecoration: doc.resend_reason ? 'line-through' : 'none' }}>{doc.file_name}</span>
        <button type="button" onClick={async () => onError(await openEmployeeDocument(doc))} style={linkBtn}>View</button>
        {!doc.resend_reason && !data.review && canRemoveOwn(doc, employee?.id) && (
          <button type="button" onClick={remove} disabled={busy} aria-label={`Remove ${doc.file_name}`} style={{ ...linkBtn, color: 'var(--red, #b42318)' }}>
            {busy ? 'Removing…' : 'Remove'}
          </button>
        )}
      </span>
      {doc.resend_reason && (
        <span style={{ display: 'block', marginTop: 2, padding: '4px 8px', borderRadius: 8, background: 'var(--amber-soft, #fbefd3)', color: 'var(--text-strong, #10261a)' }}>
          <b>HR:</b> {doc.resend_reason}
        </span>
      )}
    </li>
  )
}

const tick: CSSProperties = {
  width: 22, height: 22, flexShrink: 0, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: '2px solid var(--border, #e2ebdf)', color: '#fff',
}
const tickDone: CSSProperties = { background: 'var(--green, #3d7f1f)', borderColor: 'var(--green, #3d7f1f)' }
const btn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '0 0.875rem', borderRadius: 10,
  border: '1px solid var(--green, #3d7f1f)', background: 'var(--green-soft, #e6f2e1)', color: 'var(--green-dark, #1d5a1f)',
  fontWeight: 700, fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit',
}
const btnQuiet: CSSProperties = { ...btn, border: '1px solid var(--border, #e2ebdf)', background: 'transparent', color: 'var(--text-muted, #5b6f61)' }
const btnAmber: CSSProperties = { ...btn, border: '1px solid var(--amber, #c27a0e)', background: 'var(--amber-soft, #fbefd3)', color: 'var(--text-strong, #10261a)' }
const linkBtn: CSSProperties = {
  flexShrink: 0, padding: '2px 4px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: '0.8125rem', fontWeight: 600, color: 'var(--green-dark, #1d5a1f)', textDecoration: 'underline', textUnderlineOffset: 2,
}
