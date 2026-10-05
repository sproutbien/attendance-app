import { useState } from 'react'
import type { CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useOnboardingTemplate } from '../../hooks/useOnboarding'
import { DOC_CATEGORIES } from '../../lib/onboarding'
import { errorBox, ghostBtn, hintStyle, inputStyle, modalStyle, overlayStyle, primaryBtn } from '../employees/styles'
import type { DocCategory, OnboardingTemplateTask } from '../../types'

/** Admin: the onboarding checklist new joiners get. Changes apply to checklists started afterwards. */
export default function ChecklistTemplateModal({ onClose }: { onClose: () => void }) {
  const t = useOnboardingTemplate()
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState<OnboardingTemplateTask['assignee']>('employee')
  const [doc, setDoc] = useState<DocCategory | ''>('')

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    const err = await t.add({ title: title.trim(), details: null, assignee, document_category: doc || null })
    setError(err)
    if (!err) { setTitle(''); setDoc('') }
  }

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ ...modalStyle, maxWidth: 620 }} role="dialog" aria-modal="true" aria-labelledby="checklist-title">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 id="checklist-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>Onboarding checklist</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>
        <p style={{ ...hintStyle, fontSize: '0.8125rem', margin: '0 0 1rem' }}>
          New joiners get these steps when onboarding starts. Steps asking for a document tick themselves when it’s uploaded.
          Changes here don’t affect checklists already started; edit those on the person’s profile.
        </p>

        {t.loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : (['employee', 'admin'] as const).map(who => (
          <div key={who} style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-600)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.375rem' }}>
              {who === 'employee' ? 'New joiner does' : 'Admin does'}
            </div>
            {t.items.filter(i => i.assignee === who).map(i => (
              <TemplateRow key={i.id} item={i}
                onSave={async changes => { const e = await t.update(i.id, changes); setError(e); return !e }}
                onRemove={async () => setError(await t.remove(i.id))} />
            ))}
            {t.items.every(i => i.assignee !== who) && <p style={{ ...hintStyle, margin: 0 }}>No steps.</p>}
          </div>
        ))}

        <form onSubmit={add} style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="New step, e.g. Sign the NDA" maxLength={120} aria-label="New step"
            style={{ ...inputStyle, flex: '1 1 220px', width: 'auto', fontSize: '0.875rem' }} />
          <select value={assignee} onChange={e => setAssignee(e.target.value as OnboardingTemplateTask['assignee'])} aria-label="Who does it" style={select}>
            <option value="employee">New joiner</option>
            <option value="admin">Admin</option>
          </select>
          <select value={doc} onChange={e => setDoc(e.target.value as DocCategory | '')} aria-label="Needs a document" style={select}>
            <option value="">No document</option>
            {DOC_CATEGORIES.map(c => <option key={c} value={c}>Upload: {c}</option>)}
          </select>
          <button type="submit" disabled={!title.trim()} style={primaryBtn}>Add step</button>
        </form>
        {error && <div style={{ ...errorBox, marginTop: '0.75rem' }}>{error}</div>}
      </div>
    </div>
  )
}

function TemplateRow({ item, onSave, onRemove }: {
  item: OnboardingTemplateTask
  onSave: (changes: Partial<OnboardingTemplateTask>) => Promise<boolean>
  onRemove: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const dirty = title.trim() !== item.title && title.trim() !== ''
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0' }}>
      <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} aria-label="Step"
        style={{ ...inputStyle, flex: 1, width: 'auto', fontSize: '0.875rem', padding: '0.375rem 0.625rem' }} />
      {item.document_category && <span style={tag}>Upload: {item.document_category}</span>}
      {dirty && <button onClick={() => onSave({ title: title.trim() })} style={{ ...ghostBtn, padding: '0.25rem 0.625rem' }}>Save</button>}
      <button onClick={onRemove} aria-label={`Remove “${item.title}”`} title="Remove step"
        style={{ padding: 4, border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', display: 'inline-flex' }}>
        <X size={15} />
      </button>
    </div>
  )
}

const select: CSSProperties = { ...inputStyle, width: 'auto', fontSize: '0.875rem', padding: '0.5rem' }
const tag: CSSProperties = { fontSize: '0.75rem', color: '#475569', background: '#f1f5f9', borderRadius: 99, padding: '1px 8px', whiteSpace: 'nowrap' }
