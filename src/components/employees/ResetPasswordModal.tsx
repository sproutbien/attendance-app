import { useState } from 'react'
import { Copy, KeyRound, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Employee } from '../../types'
import { errorBox, ghostBtn, hintStyle, inputStyle, modalStyle, overlayStyle, primaryBtn, successBox } from './styles'

const MIN_LENGTH = 8
// No look-alikes (0/O, 1/l/I) so it's easy to read out or type from a message
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ'
const DIGITS = '23456789'

/** e.g. "Kmtr-4827-Pxwa" */
export function generatePassword() {
  const pick = (set: string, n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)), v => set[v % set.length]).join('')
  return `${pick(LETTERS, 4)}-${pick(DIGITS, 4)}-${pick(LETTERS, 4)}`
}

/** Admin: give an employee a new temporary password (migration 034). */
export default function ResetPasswordModal({ employee, onDone, onClose }: {
  employee: Pick<Employee, 'id' | 'full_name' | 'email'>
  onDone: () => void
  onClose: () => void
}) {
  const [password, setPassword] = useState(generatePassword)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [copied, setCopied] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < MIN_LENGTH) { setError(`At least ${MIN_LENGTH} characters.`); return }
    setSaving(true)
    setError(null)
    const { error } = await supabase.rpc('admin_reset_password', { p_employee: employee.id, p_password: password })
    setSaving(false)
    if (error) { setError(error.message); return }
    setDone(true)
    onDone()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Email: ${employee.email}\nTemporary password: ${password}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked: they can still select it */ }
  }

  const firstName = employee.full_name.split(' ')[0]

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="reset-pw-title" style={{ ...modalStyle, maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2 id="reset-pw-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyRound size={18} /> Reset password
          </h2>
          <button onClick={onClose} disabled={saving} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>

        {done ? (
          <>
            <div style={successBox}>
              Password reset. {firstName} has been signed out and will choose their own password at the next login.
            </div>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#374151' }}>Share these with {firstName}:</p>
            <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: '0.9375rem', lineHeight: 1.7 }}>
              <div><span style={{ color: '#64748b' }}>Email:</span> {employee.email}</div>
              <div><span style={{ color: '#64748b' }}>Temporary password:</span> <strong style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.03em' }}>{password}</strong></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button type="button" onClick={copy} style={{ ...ghostBtn, padding: '0.5rem 1rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
              </button>
              <button type="button" onClick={onClose} style={primaryBtn}>Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={save}>
            <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#64748b' }}>
              {employee.full_name}’s current password stops working and they’re signed out. At the next login
              they’re asked to choose their own.
            </p>
            <label htmlFor="reset-pw" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem', color: '#374151' }}>
              Temporary password
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input id="reset-pw" type="text" value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="off" spellCheck={false} minLength={MIN_LENGTH} required
                style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }} />
              <button type="button" onClick={() => setPassword(generatePassword())} title="Generate another"
                style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <RefreshCw size={14} /> Generate
              </button>
            </div>
            <p style={hintStyle}>At least {MIN_LENGTH} characters. You’ll be able to copy it on the next step.</p>

            {error && <div style={{ ...errorBox, marginTop: '1rem' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button type="button" onClick={onClose} disabled={saving} style={{ ...ghostBtn, padding: '0.5rem 1rem' }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Resetting…' : 'Reset password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
