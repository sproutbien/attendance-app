import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Check, FileText, Paperclip, X } from 'lucide-react'
import type { useOnboarding } from '../../hooks/useOnboarding'
import { DOC_CATEGORIES, deleteEmployeeDocument, openEmployeeDocument, progress } from '../../lib/onboarding'
import { LEAVE_DOC_ACCEPT, fmtBytes, leaveDocProblem } from '../../lib/leaveDocs'
import { fmtDate } from '../../lib/employees'
import { card, errorBox, ghostBtn, hintStyle, inputStyle, primaryBtn } from '../employees/styles'
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
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3125rem 0', fontSize: '0.875rem' }}>
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
                  <button onClick={() => setConfirming(d.id)} disabled={busy} aria-label={`Remove ${d.file_name}`} style={iconBtn}><X size={14} /></button>
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
