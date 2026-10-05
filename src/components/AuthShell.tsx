import { useState } from 'react'
import { ArrowRight, Eye, EyeOff, Lock } from 'lucide-react'
import { useBranding } from '../contexts/BrandingContext'
import { wordmarkParts } from '../lib/brand'
import '../styles/auth.css'

/** Background, card and brand block shared by the login / reset-password screens. */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  const { branding, logo } = useBranding()
  const [first, second] = wordmarkParts(branding.app_name)
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={logo} alt="" />
          <h1 className={`auth-wordmark${second ? '' : ' is-plain'}`}>{first}{second && <span>{second}</span>}</h1>
          {branding.product_name && <p className="auth-tagline">{branding.product_name}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

export function PasswordField({ value, onChange, placeholder = 'Password', autoComplete }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-field">
      <Lock size={22} strokeWidth={1.75} />
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        required
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="auth-eye"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <Eye size={22} strokeWidth={1.75} /> : <EyeOff size={22} strokeWidth={1.75} />}
      </button>
    </div>
  )
}

export function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" className="auth-submit" disabled={busy}>
      {children}
      <span className="auth-submit-arrow" aria-hidden="true">
        <ArrowRight size={24} strokeWidth={2.25} />
      </span>
    </button>
  )
}
