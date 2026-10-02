import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import AuthShell, { PasswordField, SubmitButton } from '../components/AuthShell'
import { DEMO_ACCOUNTS, IS_DEMO, type DemoRole } from '../lib/demo'

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
  const [params] = useSearchParams()
  const autoLogin = useRef(false)

  // Demo: the landing page links to /login?as=admin or ?as=employee
  useEffect(() => {
    const as = params.get('as')
    if (!IS_DEMO || loading || session || autoLogin.current) return
    if (as === 'admin' || as === 'employee') {
      autoLogin.current = true
      void demoLogin(as)
    }
  }, [loading, session])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!loading && session) return <Navigate to="/dashboard" replace />

  async function demoLogin(role: DemoRole) {
    const acc = DEMO_ACCOUNTS[role]
    setEmail(acc.email)
    setPassword(acc.password)
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email: acc.email, password: acc.password })
    if (error) {
      setError(error.message)
      setSubmitting(false)
    } else {
      navigate(role === 'admin' ? '/admin/attendance' : '/dashboard', { replace: true })
    }
  }

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

          {IS_DEMO ? (
            <div className="auth-demo">
              <p className="auth-demo-title">Live demo · data resets every night</p>
              <div className="auth-demo-buttons">
                {(Object.keys(DEMO_ACCOUNTS) as DemoRole[]).map(role => (
                  <button key={role} type="button" className="auth-demo-btn" disabled={submitting} onClick={() => demoLogin(role)}>
                    <strong>Try as {DEMO_ACCOUNTS[role].label}</strong>
                    <span>{DEMO_ACCOUNTS[role].who}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="auth-row-end">
              <button type="button" className="auth-link" onClick={() => switchMode('forgot')}>
                Forgot Password?
              </button>
            </div>
          )}

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
