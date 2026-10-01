import { useState } from 'react'
import type { FormEvent } from 'react'
import { OPTION_KIND_LABELS } from '../../lib/employees'
import type { useEmployeeOptions } from '../../hooks/useEmployeeManagement'
import type { Employee, EmployeeOption, EmployeeOptionKind } from '../../types'
import { dangerBtn, errorBox, ghostBtn, hintStyle, inputStyle, modalStyle, overlayStyle, primaryBtn } from './styles'

const KINDS: EmployeeOptionKind[] = ['department', 'work_location', 'employment_type']

/** Admin: manage the Department, Work location and Employment type dropdowns. */
export default function EmployeeListsModal({ lists, employees, onChanged, onClose }: {
  lists: ReturnType<typeof useEmployeeOptions>
  employees: Employee[]             // to show how many people use each option
  onChanged: () => void             // a rename touched employee rows
  onClose: () => void
}) {
  const [kind, setKind] = useState<EmployeeOptionKind>('department')
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const items = lists.byKind(kind)
  const usage = (o: EmployeeOption) => employees.filter(e => e[o.kind] === o.name).length

  async function act(op: Promise<string | null>, after?: () => void) {
    setBusy(true)
    setError(null)
    const err = await op
    setBusy(false)
    if (err) { setError(err); return }
    after?.()
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    act(lists.add(kind, newName), () => setNewName(''))
  }

  function handleRename(e: FormEvent) {
    e.preventDefault()
    if (!editing || !editing.name.trim()) return
    act(lists.rename(editing.id, editing.name), () => { setEditing(null); onChanged() })
  }

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ ...modalStyle, maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>Employee lists</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>

        <div role="tablist" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', background: '#f1f5f9', padding: 4, borderRadius: 10 }}>
          {KINDS.map(k => (
            <button
              key={k} role="tab" aria-selected={k === kind}
              onClick={() => { setKind(k); setEditing(null); setError(null) }}
              style={{
                flex: 1, padding: '0.4375rem 0.5rem', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.8125rem',
                fontWeight: k === kind ? 600 : 500, background: k === kind ? '#fff' : 'transparent',
                color: k === kind ? '#1e293b' : '#64748b', boxShadow: k === kind ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {OPTION_KIND_LABELS[k]}
            </button>
          ))}
        </div>

        <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Add new…" maxLength={60} style={inputStyle} />
          <button type="submit" disabled={busy || !newName.trim()} style={{ ...primaryBtn, whiteSpace: 'nowrap', opacity: busy || !newName.trim() ? 0.6 : 1 }}>Add</button>
        </form>

        {error && <div style={errorBox}>{error}</div>}

        {items.length === 0 ? (
          <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.875rem' }}>Nothing in this list yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map(o => {
              const used = usage(o)
              return (
                <li key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
                  {editing?.id === o.id ? (
                    <form onSubmit={handleRename} style={{ display: 'flex', gap: '0.5rem', flex: 1 }}>
                      <input autoFocus value={editing.name} onChange={e => setEditing({ id: o.id, name: e.target.value })} maxLength={60} style={{ ...inputStyle, padding: '0.375rem 0.625rem', fontSize: '0.875rem' }} />
                      <button type="submit" disabled={busy} style={ghostBtn}>Save</button>
                      <button type="button" onClick={() => setEditing(null)} style={ghostBtn}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: '0.875rem', color: '#1e293b' }}>
                        {o.name}
                        <span style={{ color: '#94a3b8', marginLeft: 6, fontSize: '0.8125rem' }}>
                          {used ? `${used} employee${used === 1 ? '' : 's'}` : 'unused'}
                        </span>
                      </span>
                      <button onClick={() => setEditing({ id: o.id, name: o.name })} disabled={busy} style={ghostBtn}>Rename</button>
                      <button
                        onClick={() => act(lists.remove(o.id))}
                        disabled={busy || used > 0}
                        title={used > 0 ? 'In use — move those employees first' : undefined}
                        style={{ ...dangerBtn, opacity: used > 0 ? 0.4 : 1, cursor: used > 0 ? 'not-allowed' : 'pointer' }}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p style={{ ...hintStyle, marginTop: '0.875rem' }}>Renaming updates every employee who uses that name. Only unused entries can be removed.</p>
      </div>
    </div>
  )
}
