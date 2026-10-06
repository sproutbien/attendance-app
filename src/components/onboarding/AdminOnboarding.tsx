import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { BadgeCheck, Check, FileText, Paperclip, RotateCcw, X } from 'lucide-react'
import type { useOnboarding } from '../../hooks/useOnboarding'
import { DOC_CATEGORIES, deleteEmployeeDocument, openEmployeeDocument, progress, verificationState } from '../../lib/onboarding'
import { LEAVE_DOC_ACCEPT, fmtBytes, leaveDocProblem } from '../../lib/leaveDocs'
import { fmtDate } from '../../lib/employees'
import { card, errorBox, ghostBtn, hintStyle, inputStyle, modalStyle, overlayStyle, primaryBtn } from '../employees/styles'
import type { DocCategory, Employee, EmployeeDocument, OnboardingTask } from '../../types'

type Data = ReturnType<typeof useOnboarding>

/** Admin, employee profile: the onboarding checklist. */
export function OnboardingCard({ employee, data }: { employee: Employee; data: Data }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newFor, setNewFor] = useState<OnboardingTask['assignee']>('admin')
  const [showDone, setShowDone] = useState(false)
  const p = progress(data.tasks)
  const firstName = employee.full_name.split(' ')[0]

  async function act(fn: () => Promise<string | null>) {
    setBusy(true)
    setError(await fn())
    setBusy(false)
  }

  return (
    <section style={card}>
      <Head title="Onboarding" aside={p.total ? `${p.done} of ${p.total} done` : undefined} />
      {data.loading ? <p style={muted}>Loading…</p>
        : p.total === 0 ? (
          <>
            <p style={{ ...muted, margin: '0 0 0.75rem' }}>No onboarding checklist for {firstName}.</p>
            <button onClick={() => act(data.start)} disabled={busy} style={primaryBtn}>Start onboarding</button>
            <p style={hintStyle}>Copies the checklist on the Employees page (Checklist button). {firstName} sees their steps on their Dashboard.</p>
          </>
        ) : (
          <>
            <div style={{ height: 8, borderRadius: 99, background: '#e2e8f0', overflow: 'hidden', marginBottom: '0.875rem' }}>
              <div style={{ width: `${(p.done / p.total) * 100}%`, height: '100%', background: 'var(--brand-600)' }} />
            </div>
            <Verification employee={employee} data={data} />
            {p.complete && !showDone ? (
              <p style={{ margin: 0, fontSize: '0.875rem', color: '#166534' }}>
                <Check size={16} style={{ verticalAlign: '-3px' }} /> All done.{' '}
                <button onClick={() => setShowDone(true)} style={linkBtn}>Show steps</button>
              </p>
            ) : (
              (['employee', 'admin'] as const).map(who => {
                const list = data.tasks.filter(t => t.assignee === who)
                if (!list.length) return null
                return (
                  <div key={who} style={{ marginBottom: '0.75rem' }}>
                    <div style={groupLabel}>{who === 'employee' ? `${firstName}’s steps` : 'Admin steps'}</div>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {list.map(t => (
                        <TaskRow key={t.id} task={t} busy={busy}
                          onToggle={() => act(() => data.setDone(t.id, !t.done_at))}
                          onRemove={() => act(() => data.removeTask(t.id))} />
                      ))}
                    </ul>
                  </div>
                )
              })
            )}
            {(!p.complete || showDone) && (
              <form
                onSubmit={e => { e.preventDefault(); if (newTitle.trim()) act(async () => { const err = await data.addTask(newTitle.trim(), newFor); if (!err) setNewTitle(''); return err }) }}
                style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}
              >
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Add a step for this person…" maxLength={120}
                  aria-label="New step" style={{ ...inputStyle, flex: '1 1 180px', width: 'auto', fontSize: '0.875rem', padding: '0.4375rem 0.625rem' }} />
                <select value={newFor} onChange={e => setNewFor(e.target.value as OnboardingTask['assignee'])} aria-label="Who does it"
                  style={{ ...inputStyle, width: 'auto', fontSize: '0.875rem', padding: '0.4375rem 0.5rem' }}>
                  <option value="admin">Admin</option>
                  <option value="employee">{firstName}</option>
                </select>
                <button type="submit" disabled={busy || !newTitle.trim()} style={ghostBtn}>Add</button>
              </form>
            )}
          </>
        )}
      {error && <div style={{ ...errorBox, marginTop: '0.75rem', marginBottom: 0 }}>{error}</div>}
    </section>
  )
}

/** Status of the employee's documents, and Pass verification once they're ready (migration 039). */
function Verification({ employee, data }: { employee: Employee; data: Data }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = verificationState(data.tasks, data.docs, data.review)
  if (state === 'none') return null
  const firstName = employee.full_name.split(' ')[0]
  const resends = data.docs.filter(d => d.resend_reason).length

  async function act(fn: () => Promise<string | null>) {
    setBusy(true)
    const err = await fn()
    setError(err)
    setBusy(false)
    if (!err) setAsking(false)
  }

  const s = {
    todo:     { pill: `Waiting for ${firstName}`, bg: '#f1f5f9', fg: '#475569', text: `${firstName} still has steps to finish. You can pass verification once they’re done.` },
    resend:   { pill: 'Re-send requested', bg: '#fef3c7', fg: '#92400e', text: `Waiting for ${firstName} to re-send ${resends === 1 ? 'a document' : `${resends} documents`}.` },
    ready:    { pill: 'Ready for review', bg: 'var(--brand-100)', fg: 'var(--brand-800)', text: 'Check the documents. Then pass verification, or ask for anything that needs re-sending.' },
    verified: { pill: 'Verified', bg: '#dcfce7', fg: '#166534', text: `Verified on ${data.review ? fmtDate(new Date(data.review.verified_at)) : ''}.${data.review?.seen_at ? ` ${firstName} has seen it.` : ` ${firstName} sees a message on their Dashboard.`}` },
  }[state]

  return (
    <div style={{ padding: '0.75rem', marginBottom: '0.875rem', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 99, background: s.bg, color: s.fg, fontSize: '0.75rem', fontWeight: 600 }}>
          {state === 'verified' && <BadgeCheck size={13} />}{s.pill}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {state === 'verified' ? (
            <button onClick={() => act(data.undoVerification)} disabled={busy} style={linkBtn}>Undo verification</button>
          ) : (
            <button onClick={() => { setError(null); setAsking(true) }} disabled={state !== 'ready' || busy}
              title={state === 'ready' ? undefined : 'Available once every step is done and nothing is waiting to be re-sent'}
              style={{ ...primaryBtn, padding: '0.375rem 0.875rem', fontSize: '0.8125rem', opacity: state === 'ready' ? 1 : 0.45, cursor: state === 'ready' ? 'pointer' : 'not-allowed' }}>
              Pass verification
            </button>
          )}
        </span>
      </div>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: '#475569' }}>{s.text}</p>
      {error && !asking && <p style={{ ...hintStyle, color: '#dc2626' }}>{error}</p>}
      {asking && (
        <Confirm
          title={`Pass verification for ${employee.full_name}?`}
          body={`This confirms you’ve checked all their documents. ${firstName} will see “HR has verified all your documents” on their Dashboard.`}
          confirmLabel="Yes, pass verification" busy={busy} error={error}
          onConfirm={() => act(data.passVerification)} onCancel={() => { setAsking(false); setError(null) }}
        />
      )}
    </div>
  )
}

/** Small confirmation dialog. */
function Confirm({ title, body, confirmLabel, busy, error, onConfirm, onCancel, children }: {
  title: string; body: string; confirmLabel: string; busy: boolean; error: string | null
  onConfirm: () => void; onCancel: () => void; children?: React.ReactNode
}) {
  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget && !busy) onCancel() }}>
      <form role="dialog" aria-modal="true" aria-labelledby="confirm-title" onSubmit={e => { e.preventDefault(); onConfirm() }} style={{ ...modalStyle, maxWidth: 440 }}>
        <h2 id="confirm-title" style={{ margin: '0 0 0.5rem', fontSize: '1.0625rem', fontWeight: 700, color: '#1e293b' }}>{title}</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#475569', lineHeight: 1.5 }}>{body}</p>
        {children}
        {error && <div style={{ ...errorBox, marginTop: '0.75rem' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
          <button type="button" onClick={onCancel} disabled={busy} style={{ ...ghostBtn, padding: '0.5rem 1rem' }}>Cancel</button>
          <button type="submit" disabled={busy} autoFocus={!children} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : confirmLabel}</button>
        </div>
      </form>
    </div>
  )
}

function TaskRow({ task: t, busy, onToggle, onRemove }: { task: OnboardingTask; busy: boolean; onToggle: () => void; onRemove: () => void }) {
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', padding: '0.4375rem 0', borderBottom: '1px solid #f1f5f9' }}>
      <input type="checkbox" checked={!!t.done_at} onChange={onToggle} disabled={busy} aria-label={t.title}
        style={{ width: 18, height: 18, marginTop: 1, accentColor: 'var(--brand-600)', flexShrink: 0, cursor: 'pointer' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.875rem', color: t.done_at ? '#94a3b8' : '#1e293b', textDecoration: t.done_at ? 'line-through' : 'none' }}>{t.title}</div>
        {(t.details || t.document_category) && (
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            {t.document_category && <span style={docTag}><Paperclip size={11} /> {t.document_category}</span>}
            {t.details}
          </div>
        )}
      </div>
      <button onClick={onRemove} disabled={busy} aria-label={`Remove “${t.title}”`} title="Remove this step" style={iconBtn}><X size={14} /></button>
    </li>
  )
}

/** Admin, employee profile: HR documents by category. */
export function DocumentsCard({ employee, data }: { employee: Employee; data: Data }) {
  const input = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<DocCategory>('Offer letter')
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
  const [resending, setResending] = useState<EmployeeDocument | null>(null)
  const [reason, setReason] = useState('')
  const [resendError, setResendError] = useState<string | null>(null)
  const firstName = employee.full_name.split(' ')[0]

  async function sendRequest(d: EmployeeDocument) {
    if (!reason.trim()) return setResendError('Say what needs fixing, so they know what to send.')
    setBusy(true)
    const err = await data.requestResend(d.id, reason.trim())
    setBusy(false)
    setResendError(err)
    if (!err) { setResending(null); setReason('') }
  }

  async function withdraw(d: EmployeeDocument) {
    setBusy(true)
    const err = await data.withdrawResend(d.id)
    setBusy(false)
    setProblems(err ? [err] : [])
  }

  async function add(files: FileList | null) {
    const picked = Array.from(files ?? [])
    const bad = picked.map(leaveDocProblem).filter((p): p is string => !!p)
    const good = picked.filter(f => !leaveDocProblem(f))
    setProblems(bad)
    if (!good.length) return
    setBusy(true)
    const errors = await data.upload(category, good)
    setBusy(false)
    if (errors.length) setProblems(p => [...p, ...errors])
  }

  async function remove(d: EmployeeDocument) {
    setBusy(true)
    const err = await deleteEmployeeDocument(d)
    setBusy(false)
    setConfirming(null)
    setProblems(err ? [err] : [])
    data.refresh()
  }

  const groups = DOC_CATEGORIES.map(c => ({ category: c, docs: data.docs.filter(d => d.category === c) })).filter(g => g.docs.length)

  return (
    <section style={card}>
      <Head title="Documents" aside={`${data.docs.length} file${data.docs.length === 1 ? '' : 's'}`} />
      {data.loading ? <p style={muted}>Loading…</p>
        : groups.length === 0 ? <p style={{ ...muted, margin: '0 0 0.75rem' }}>No documents for {employee.full_name.split(' ')[0]} yet.</p>
        : groups.map(g => (
          <div key={g.category} style={{ marginBottom: '0.625rem' }}>
            <div style={groupLabel}>{g.category}</div>
            {g.docs.map(d => (
              <div key={d.id} style={{ padding: '0.3125rem 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <button onClick={async () => { const e = await openEmployeeDocument(d); if (e) setProblems([e]) }} title={`Open ${d.file_name}`}
                  style={{ ...iconBtn, color: 'var(--brand-700)', display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, fontSize: '0.875rem', textAlign: 'left' }}>
                  <FileText size={15} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name}</span>
                </button>
                <span style={{ color: '#94a3b8', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{fmtBytes(d.size_bytes)} · {fmtDate(new Date(d.uploaded_at))}</span>
                {confirming === d.id ? (
                  <>
                    <button onClick={() => remove(d)} disabled={busy} style={{ ...ghostBtn, color: '#dc2626', borderColor: '#fecaca', padding: '0.125rem 0.5rem' }}>Remove</button>
                    <button onClick={() => setConfirming(null)} style={{ ...ghostBtn, padding: '0.125rem 0.5rem' }}>Keep</button>
                  </>
                ) : (
                  <>
                    {!d.resend_reason && (
                      <button onClick={() => { setResending(d); setReason(''); setResendError(null) }} disabled={busy}
                        aria-label={`Ask to re-send ${d.file_name}`} title="Ask to re-send" style={iconBtn}><RotateCcw size={14} /></button>
                    )}
                    <button onClick={() => setConfirming(d.id)} disabled={busy} aria-label={`Remove ${d.file_name}`} title="Remove" style={iconBtn}><X size={14} /></button>
                  </>
                )}
              </div>
              {d.resend_reason && (
                <div style={{ marginTop: 4, padding: '0.375rem 0.625rem', borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: '0.8125rem' }}>
                  <b>Re-send requested:</b> {d.resend_reason}{' '}
                  <button onClick={() => withdraw(d)} disabled={busy} style={{ ...linkBtn, color: '#92400e' }}>Withdraw</button>
                </div>
              )}
              </div>
            ))}
          </div>
        ))}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
        <select value={category} onChange={e => setCategory(e.target.value as DocCategory)} aria-label="Document type"
          style={{ ...inputStyle, width: 'auto', fontSize: '0.875rem', padding: '0.4375rem 0.5rem' }}>
          {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => input.current?.click()} disabled={busy} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Paperclip size={14} /> {busy ? 'Uploading…' : 'Upload'}
        </button>
        <span style={{ ...hintStyle, margin: 0 }}>PDF, PNG, JPEG or Word · 10 MB each</span>
      </div>
      <input ref={input} type="file" multiple accept={LEAVE_DOC_ACCEPT} hidden onChange={e => { add(e.target.files); e.target.value = '' }} />
      {problems.map(p => <p key={p} style={{ ...hintStyle, color: '#dc2626' }}>{p}</p>)}
      {data.docs.length > 0 && (
        <p style={{ ...hintStyle, marginTop: '0.625rem' }}>
          <RotateCcw size={11} style={{ verticalAlign: '-1px' }} /> asks {firstName} to send a document again.
        </p>
      )}
      {resending && (
        <Confirm
          title={`Ask ${firstName} to re-send this ${resending.category}?`}
          body={`${resending.file_name} stays here until ${firstName} uploads a new one, which replaces it.`}
          confirmLabel="Send request" busy={busy} error={resendError}
          onConfirm={() => sendRequest(resending)} onCancel={() => setResending(null)}
        >
          <label htmlFor="resend-reason" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.375rem' }}>What needs fixing?</label>
          <textarea id="resend-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={200} rows={3} autoFocus
            placeholder="e.g. The photo is blurry. Please upload a clearer scan."
            style={{ ...inputStyle, resize: 'vertical', fontSize: '0.875rem' }} />
          <p style={hintStyle}>{firstName} sees this on their Dashboard.</p>
        </Confirm>
      )}
    </section>
  )
}

function Head({ title, aside }: { title: string; aside?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
      <h2 style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-600)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</h2>
      {aside && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{aside}</span>}
    </div>
  )
}

const muted: CSSProperties = { margin: 0, color: '#94a3b8', fontSize: '0.875rem' }
const groupLabel: CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: '#64748b', margin: '0.25rem 0 0.125rem' }
const iconBtn: CSSProperties = { padding: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', display: 'inline-flex', fontFamily: 'inherit' }
const linkBtn: CSSProperties = { padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--brand-700)', textDecoration: 'underline', fontSize: 'inherit', fontFamily: 'inherit' }
const docTag: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 6, padding: '0 6px', borderRadius: 99, background: '#f1f5f9', color: '#475569' }
