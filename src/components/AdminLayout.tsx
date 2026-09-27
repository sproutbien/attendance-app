import { NavLink, Outlet } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function AdminLayout() {
  const { employee, signOut } = useAuth()

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <header style={{
        background: '#14532d',
        padding: '0 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 56,
        position: 'sticky',
        top: 0,
        zIndex: 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <img src="/logo.jpg" alt="Sproutbien" style={{ height: 32, display: 'block' }} />
          <span style={{
            fontSize: '0.625rem',
            background: 'rgba(187,247,208,0.15)',
            color: '#bbf7d0',
            padding: '2px 8px',
            borderRadius: 4,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            border: '1px solid rgba(187,247,208,0.25)',
          }}>
            Admin
          </span>
          <nav style={{ display: 'flex', gap: '0.125rem' }}>
            <NavLink to="/admin/attendance" style={navStyle}>Attendance</NavLink>
            <NavLink to="/admin/leave"      style={navStyle}>Leave</NavLink>
            <NavLink to="/admin/employees"  style={navStyle}>Employees</NavLink>
            <NavLink to="/admin/reports"    style={navStyle}>Reports</NavLink>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.8125rem' }}>
            {employee?.full_name}
          </span>
          <button
            onClick={signOut}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6,
              padding: '0.3125rem 0.75rem',
              cursor: 'pointer',
              fontSize: '0.8125rem',
              color: 'rgba(255,255,255,0.75)',
              fontFamily: 'inherit',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem', background: '#f0fdf4', minHeight: 'calc(100vh - 56px)' }}>
        <Outlet />
      </div>
    </div>
  )
}

function navStyle({ isActive }: { isActive: boolean }): CSSProperties {
  return {
    textDecoration: 'none',
    padding: '0.3125rem 0.75rem',
    borderRadius: 6,
    fontSize: '0.875rem',
    fontWeight: isActive ? 600 : 400,
    color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
    background: isActive ? 'rgba(255,255,255,0.14)' : 'transparent',
    letterSpacing: '-0.01em',
  }
}
