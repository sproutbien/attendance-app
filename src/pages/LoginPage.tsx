import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import AuthShell, { PasswordField, SubmitButton } from '../components/AuthShell'

type Mode = 'login' | 'forgot'

export default function LoginPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session) return <Navigate to="/dashboard" replace />

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setSubmitting(false)
    } else {
      navigate('/dashboard', { replace: true })
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setSubmitting(false)
    if (error) setError(error.message)
    else setNotice(`If an account exists for ${email}, a password reset link is on its way. Check your inbox.`)
  }

  const emailField = (
    <div className="auth-field">
      <Mail size={22} strokeWidth={1.75} />
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Email Address"
        aria-label="Email Address"
        required
        autoComplete="email"
      />
    </div>
  )

  return (
    <AuthShell>
      {mode === 'login' ? (
        <form onSubmit={handleLogin}>
          {emailField}
          <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />

          <div className="auth-row-end">
            <button type="button" className="auth-link" onClick={() => switchMode('forgot')}>
              Forgot Password?
            </button>
          </div>

          {error && <div className="auth-msg auth-msg--error">{error}</div>}

          <SubmitButton busy={submitting}>{submitting ? 'Logging in…' : 'Log In'}</SubmitButton>
        </form>
      ) : (
        <form onSubmit={handleForgot}>
          <h2 className="auth-heading">Reset your password</h2>
          <p className="auth-subheading">Enter your email and we'll send you a link to set a new password.</p>

          {emailField}

          {error && <div className="auth-msg auth-msg--error">{error}</div>}
          {notice && <div className="auth-msg auth-msg--success">{notice}</div>}

          <SubmitButton busy={submitting}>{submitting ? 'Sending…' : 'Send Reset Link'}</SubmitButton>

          <div className="auth-back">
            <button type="button" className="auth-link" onClick={() => switchMode('login')}>
              ← Back to Log In
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  )
}
