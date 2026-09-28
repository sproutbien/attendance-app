import { NavLink } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { employee, signOut } = useAuth()

  return (
    <div style={{ minHeight: '100vh', background: '#f0fdf4' }}>
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
        boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <img src="/logo.jpg" alt="Sproutbien" style={{ height: 32, display: 'block', flexShrink: 0 }} />
          <nav style={{ display: 'flex', gap: '0.125rem' }}>
            <NavLink to="/dashboard" style={navStyle}>Dashboard</NavLink>
            <NavLink to="/leave"     style={navStyle}>Leave</NavLink>
            <NavLink to="/reports"   style={navStyle}>Reports</NavLink>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8125rem' }}>
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

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1.25rem', minHeight: 'calc(100vh - 56px)' }}>
        {children}
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
