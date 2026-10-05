import { Link, Navigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useBranding } from '../../contexts/BrandingContext'
import BrandingEditor from '../../components/branding/BrandingEditor'

/** Superadmin: the app's name, logo and colours, and what the customer's admins may change. */
export default function BrandingPage() {
  const { session, employee, superadmin, loading, signOut } = useAuth()
  const { branding, icon } = useBranding()

  if (loading) return <div style={{ padding: '2rem', color: '#94a3b8' }}>Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  if (!superadmin) return <Navigate to="/" replace />

  return (
    <div style={{ minHeight: '100vh', background: 'var(--brand-50)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0 1.25rem', height: 60, background: 'var(--brand-side)', color: '#fff' }}>
        <img src={icon} alt="" style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', background: '#fff' }} />
        <strong style={{ fontSize: '0.9375rem' }}>{branding.app_name}</strong>
        <span className="admin-chip">Superadmin</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {employee && (
            <Link to={employee.role === 'admin' ? '/admin/attendance' : '/dashboard'} style={{ color: '#fff', fontSize: '0.8125rem' }}>Back to the app</Link>
          )}
          <button onClick={signOut} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.375rem 0.75rem', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: '0.8125rem' }}>
            <LogOut size={14} /> Sign out
          </button>
        </span>
      </header>
      <BrandingEditor scope="superadmin" />
    </div>
  )
}
