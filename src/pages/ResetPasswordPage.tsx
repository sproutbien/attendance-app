import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import AuthShell, { PasswordField, SubmitButton } from '../components/AuthShell'

const MIN_LENGTH = 8

/** Error Supabase appends to the redirect URL when the recovery link is bad or expired. */
function readLinkError(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search)
  const desc = params.get('error_description')
  return desc ? desc.replace(/\+/g, ' ') : null
}

/**
 * Landing page for the "reset password" email link. supabase-js exchanges the token in the
 * URL for a recovery session on load, so once a session exists the user can set a new password.
 */
export default function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [linkError] = useState(readLinkError)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_LENGTH) return setError(`Password must be at least ${MIN_LENGTH} characters.`)
    if (password !== confirm) return setError('Passwords do not match.')

    setSubmitting(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (error) setError(error.message)
    else setDone(true)
  }

  let body: React.ReactNode
  if (done) {
    body = (
      <>
        <div className="auth-msg auth-msg--success">Your password has been updated.</div>
        <form onSubmit={e => { e.preventDefault(); navigate('/dashboard', { replace: true }) }}>
          <SubmitButton busy={false}>Continue</SubmitButton>
        </form>
      </>
    )
  } else if (loading && !linkError) {
    body = <p className="auth-subheading">Verifying your reset link…</p>
  } else if (!session) {
    body = (
      <>
        <div className="auth-msg auth-msg--error">
          {linkError ?? 'This password reset link is invalid or has expired.'} Please request a new one.
        </div>
        <div className="auth-back">
          <Link to="/login" className="auth-link">← Back to Log In</Link>
        </div>
      </>
    )
  } else {
    body = (
      <form onSubmit={handleSubmit}>
        <h2 className="auth-heading">Set a new password</h2>
        <p className="auth-subheading">for {session.user.email}</p>

        <PasswordField value={password} onChange={setPassword} placeholder="New Password" autoComplete="new-password" />
        <PasswordField value={confirm} onChange={setConfirm} placeholder="Confirm New Password" autoComplete="new-password" />

        {error && <div className="auth-msg auth-msg--error">{error}</div>}

        <SubmitButton busy={submitting}>{submitting ? 'Updating…' : 'Update Password'}</SubmitButton>
      </form>
    )
  }

  return <AuthShell>{body}</AuthShell>
}
