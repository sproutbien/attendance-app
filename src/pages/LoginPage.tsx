import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session) {
    navigate('/dashboard', { replace: true })
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
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

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #052e16 0%, #14532d 100%)',
      padding: '1rem',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 12,
        padding: '2.5rem',
        width: '100%',
        maxWidth: 400,
        boxShadow: '0 24px 48px rgba(0,0,0,0.35)',
      }}>
        {/* Brand */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ marginBottom: '0.625rem' }}>
            <img src="/logo.jpg" alt="Sproutbien" style={{ height: 40, display: 'block' }} />
          </div>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', margin: 0, letterSpacing: '-0.01em' }}>
            Attendance Tracker — Sign in to continue
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              color: '#dc2626',
              fontSize: '0.875rem',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '0.6875rem',
              background: submitting ? '#16a34a' : '#15803d',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: '0.9375rem',
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              letterSpacing: '-0.01em',
            }}
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 500,
  marginBottom: '0.375rem',
  color: '#374151',
  letterSpacing: '-0.01em',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.75rem',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  fontSize: '0.9375rem',
  outline: 'none',
  boxSizing: 'border-box',
  color: '#0f172a',
  background: '#f8fafc',
}
