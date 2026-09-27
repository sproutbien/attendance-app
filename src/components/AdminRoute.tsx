import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { session, employee, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
        Loading…
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  if (!employee) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ maxWidth: 400, textAlign: 'center', padding: '2rem' }}>
          <h2 style={{ color: '#1e293b', marginBottom: '0.75rem' }}>Account not set up</h2>
          <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
            Your login worked but your account hasn't been created in the system. Contact your administrator.
          </p>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ padding: '0.625rem 1.5rem', borderRadius: 8, border: '1px solid #e2e8f0', cursor: 'pointer', background: '#fff', color: '#374151' }}
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (employee.role !== 'admin') return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
