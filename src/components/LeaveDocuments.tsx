import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FileText, Paperclip, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  LEAVE_DOC_ACCEPT, MAX_LEAVE_DOCS, deleteLeaveDocument, fmtBytes, leaveDocDeadline, leaveDocProblem,
  leaveDocsOpen, openLeaveDocument, uploadLeaveDocuments,
} from '../lib/leaveDocs'
import type { LeaveDocument, LeaveRequest } from '../types'

/** Checks picked files against the rules, given how many are already attached. */
function pick(existing: number, picked: FileList | null) {
  const problems: string[] = []
  const accepted: File[] = []
  for (const f of Array.from(picked ?? [])) {
    const p = leaveDocProblem(f)
    if (p) problems.push(p)
    else if (existing + accepted.length >= MAX_LEAVE_DOCS) problems.push(`At most ${MAX_LEAVE_DOCS} documents per leave.`)
    else accepted.push(f)
  }
  return { accepted, problems: [...new Set(problems)] }
}

/** Request form: choose documents to upload with the request. */
export function DocumentPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [problems, setProblems] = useState<string[]>([])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => input.current?.click()} disabled={files.length >= MAX_LEAVE_DOCS} style={attachBtn}>
          <Paperclip size={14} /> Attach files
        </button>
        <span style={hint}>Optional · PDF, PNG, JPEG or Word · up to {MAX_LEAVE_DOCS} files, 10 MB each</span>
      </div>
      <input
        ref={input} type="file" multiple accept={LEAVE_DOC_ACCEPT} hidden
        onChange={e => {
          const { accepted, problems } = pick(files.length, e.target.files)
          setProblems(problems)
          if (accepted.length) onChange([...files, ...accepted])
          e.target.value = ''
        }}
      />
      {files.length > 0 && (
        <ul style={list}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} style={chip}>
              <FileText size={14} style={{ flexShrink: 0, color: 'var(--green-dark, #1d5a1f)' }} />
              <span style={chipName}>{f.name}</span>
              <span style={chipSize}>{fmtBytes(f.size)}</span>
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} style={iconBtn}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {problems.map(p => <p key={p} style={{ ...hint, color: 'var(--red, #b91c1c)', margin: '0.375rem 0 0' }}>{p}</p>)}
    </div>
  )
}

/**
 * A sick leave's documents: open, add, remove.
 * Employees: add within 30 days of requesting (pending / approved), remove their own uploads in that window.
 * Admins: add and remove any time.
 */
export function LeaveDocsPanel({ leave, docs, admin = false, onChanged }: {
  leave: Pick<LeaveRequest, 'id' | 'employee_id' | 'leave_type' | 'status' | 'requested_at'>
  docs: LeaveDocument[]
  admin?: boolean
  onChanged: () => void
}) {
  const { employee: me } = useAuth()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])

  const open = leaveDocsOpen(leave)
  const canAdd = (admin || open) && docs.length < MAX_LEAVE_DOCS
  const canRemove = (d: LeaveDocument) => admin || (open && d.uploaded_by === me?.id)
  if (!admin && docs.length === 0 && !open) return null

  async function add(picked: FileList | null) {
    const { accepted, problems } = pick(docs.length, picked)
    setProblems(problems)
    if (!accepted.length) return
    setBusy(true)
    const errors = await uploadLeaveDocuments(leave.employee_id, leave.id, accepted)
    setBusy(false)
    if (errors.length) setProblems(p => [...p, ...errors])
    onChanged()
  }

  async function remove(d: LeaveDocument) {
    setBusy(true)
    const err = await deleteLeaveDocument(d)
    setBusy(false)
    if (err) setProblems([err])
    onChanged()
  }

  async function view(d: LeaveDocument) {
    const err = await openLeaveDocument(d)
    if (err) setProblems([err])
  }

  const deadline = leaveDocDeadline(leave).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  return (
    <div style={{ marginTop: '0.375rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {docs.map(d => (
          <span key={d.id} style={chip}>
            <button type="button" onClick={() => view(d)} title={`Open ${d.file_name}`} style={{ ...iconBtn, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'inherit', minWidth: 0 }}>
              <FileText size={14} style={{ flexShrink: 0, color: 'var(--green-dark, #1d5a1f)' }} />
              <span style={chipName}>{d.file_name}</span>
            </button>
            <span style={chipSize}>{fmtBytes(d.size_bytes)}</span>
            {canRemove(d) && (
              <button type="button" onClick={() => remove(d)} disabled={busy} aria-label={`Remove ${d.file_name}`} style={iconBtn}>
                <X size={13} />
              </button>
            )}
          </span>
        ))}
        {admin && docs.length === 0 && <span style={noDocTag}>No document</span>}
        {canAdd && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy} style={{ ...attachBtn, padding: '0.25rem 0.625rem' }}>
            <Paperclip size={12} /> {busy ? 'Uploading…' : docs.length ? 'Add document' : 'Attach document'}
          </button>
        )}
      </div>
      {!admin && open && (
        <p style={{ ...hint, margin: '0.25rem 0 0' }}>
          {docs.length ? 'More documents' : 'Medical documents'} can be added until {deadline}.
        </p>
      )}
      <input ref={input} type="file" multiple accept={LEAVE_DOC_ACCEPT} hidden onChange={e => { add(e.target.files); e.target.value = '' }} />
      {problems.map(p => <p key={p} style={{ ...hint, color: 'var(--red, #b91c1c)', margin: '0.25rem 0 0' }}>{p}</p>)}
    </div>
  )
}

const attachBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
  padding: '0.375rem 0.75rem', borderRadius: 8,
  border: '1px solid var(--border, #d1d5db)', background: 'var(--surface, #fff)',
  color: 'var(--text, #374151)', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit',
}

const hint: CSSProperties = { fontSize: '0.75rem', color: 'var(--text-faint, #94a3b8)' }

const list: CSSProperties = { listStyle: 'none', margin: '0.5rem 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }

const chip: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%',
  padding: '0.25rem 0.5rem', borderRadius: 8,
  border: '1px solid var(--border, #e2e8f0)', background: 'var(--surface, #fff)',
  fontSize: '0.8125rem', color: 'var(--text-strong, #1e293b)',
}

const chipName: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }
const chipSize: CSSProperties = { color: 'var(--text-faint, #94a3b8)', fontSize: '0.75rem', whiteSpace: 'nowrap' }

const iconBtn: CSSProperties = {
  padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint, #94a3b8)',
  fontFamily: 'inherit', fontSize: 'inherit', display: 'inline-flex',
}

const noDocTag: CSSProperties = {
  padding: '1px 8px', borderRadius: 99, background: '#f1f5f9', color: '#64748b', fontSize: '0.75rem', fontWeight: 500,
}
