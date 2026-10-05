import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import AuthShell, { PasswordField, SubmitButton } from './AuthShell'

const MIN_LENGTH = 8

/**
 * Shown instead of the app while the account still has the temporary password
 * the admin set (employees.must_change_password, migration 033). The server
 * clears the flag when the password actually changes.
 */
export default function ChangePasswordScreen() {
  const { session, employee, signOut, refreshEmployee } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_LENGTH) return setError(`Password must be at least ${MIN_LENGTH} characters.`)
    if (password !== confirm) return setError('Passwords do not match.')

    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setSubmitting(false)
      setError(error.code === 'same_password'
        ? 'Choose a password different from the one your admin gave you.'
        : error.message)
      return
    }
    await refreshEmployee()
    setSubmitting(false)
  }

  const firstName = employee?.full_name.split(' ')[0] ?? ''

  return (
    <AuthShell>
      <form onSubmit={handleSubmit}>
        <h2 className="auth-heading">Choose your own password</h2>
        <p className="auth-subheading">
          Welcome{firstName ? `, ${firstName}` : ''}! You signed in with a temporary password from your admin.
          Set a new one only you know to continue.
        </p>
        {session?.user.email && <p className="auth-subheading" style={{ marginTop: -8 }}>{session.user.email}</p>}

        <PasswordField value={password} onChange={setPassword} placeholder="New Password" autoComplete="new-password" />
        <PasswordField value={confirm} onChange={setConfirm} placeholder="Confirm New Password" autoComplete="new-password" />

        {error && <div className="auth-msg auth-msg--error">{error}</div>}

        <SubmitButton busy={submitting}>{submitting ? 'Saving…' : 'Save and Continue'}</SubmitButton>

        <div className="auth-back">
          <button type="button" className="auth-link" onClick={signOut}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </form>
    </AuthShell>
  )
}
