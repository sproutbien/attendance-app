import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { Check, FileText, ListChecks, Paperclip, Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useOnboarding } from '../hooks/useOnboarding'
import { LEAVE_DOC_ACCEPT, leaveDocProblem } from '../lib/leaveDocs'
import { fmtHolidayDay } from '../lib/holidays'
import { OWN_UPLOAD_REMOVABLE_HOURS, canRemoveOwn, notStartedYet, openEmployeeDocument, progress } from '../lib/onboarding'
import type { EmployeeDocument, OnboardingTask } from '../types'
import { useBranding } from '../contexts/BrandingContext'

/**
 * Employee Dashboard: their onboarding steps (upload documents, tick the rest).
 * Before the joining date it also welcomes them. Stays for a day after the last step
 * (so a wrong last upload can still be fixed), then goes.
 */
export default function GettingStartedCard() {
  const { employee } = useAuth()
  const { branding } = useBranding()
  const data = useOnboarding(employee?.id)
  const mine = data.tasks.filter(t => t.assignee === 'employee')
  const p = progress(mine)
  const early = notStartedYet(employee)
  const lastDone = Math.max(0, ...mine.map(t => t.done_at ? new Date(t.done_at).getTime() : 0))
  const recentlyDone = p.complete && Date.now() - lastDone < OWN_UPLOAD_REMOVABLE_HOURS * 3_600_000
  if (data.loading || (!early && (mine.length === 0 || (p.complete && !recentlyDone)))) return null

  return (
    <div className="sb-card" style={{ marginBottom: '1.25rem' }}>
      <div className="sb-card-head">
        <ListChecks size={20} />
        <h2>{early ? `Welcome to ${branding.company_name}, ${employee!.full_name.split(' ')[0]}!` : 'Getting started'}</h2>
        {mine.length > 0 && <span className="sb-chip">{p.complete ? 'All done 🎉' : `${p.done} of ${p.total} done`}</span>}
      </div>
      {early && (
        <p style={{ margin: '0 0 0.875rem', fontSize: '0.875rem', color: 'var(--text, #2c4234)', lineHeight: 1.5 }}>
          You start on <b>{fmtHolidayDay(employee!.joining_date!)}</b>. Check-in opens that day.
          {mine.length > 0 && !p.complete && ' Until then, please finish the steps below.'}
        </p>
      )}
      {mine.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {mine.map(t => <Step key={t.id} task={t} data={data} />)}
        </ul>
      )}
    </div>
  )
}

function Step({ task: t, data }: { task: OnboardingTask; data: ReturnType<typeof useOnboarding> }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const done = !!t.done_at
  const files = t.document_category ? data.docs.filter(d => d.category === t.document_category) : []

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
          <button type="button" onClick={() => input.current?.click()} disabled={busy} style={done ? btnQuiet : btn}>
            {done ? <Plus size={15} /> : <Paperclip size={15} />} {busy ? 'Uploading…' : done ? 'Add file' : 'Upload'}
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

/** One uploaded file: name, View, and Remove while it's their own upload from the last day. */
function FileRow({ doc, data, onError }: {
  doc: EmployeeDocument
  data: ReturnType<typeof useOnboarding>
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
    <li style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--text, #2c4234)', minWidth: 0 }}>
      <FileText size={14} style={{ flexShrink: 0, color: 'var(--text-muted, #5b6f61)' }} />
      <span title={doc.file_name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{doc.file_name}</span>
      <button type="button" onClick={async () => onError(await openEmployeeDocument(doc))} style={linkBtn}>View</button>
      {canRemoveOwn(doc, employee?.id) && (
        <button type="button" onClick={remove} disabled={busy} aria-label={`Remove ${doc.file_name}`} style={{ ...linkBtn, color: 'var(--red, #b42318)' }}>
          {busy ? 'Removing…' : 'Remove'}
        </button>
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
const linkBtn: CSSProperties = {
  flexShrink: 0, padding: '2px 4px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: '0.8125rem', fontWeight: 600, color: 'var(--green-dark, #1d5a1f)', textDecoration: 'underline', textUnderlineOffset: 2,
}
