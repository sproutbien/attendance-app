import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import ChangePasswordScreen from './ChangePasswordScreen'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
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
            Your login worked, but your account hasn't been created in the system yet.
            Contact your administrator.
          </p>
        </div>
      </div>
    )
  }

  if (employee.must_change_password) return <ChangePasswordScreen />

  // Admins belong on the admin dashboard, not the employee screens
  if (employee.role === 'admin') return <Navigate to="/admin/attendance" replace />

  return <>{children}</>
}
