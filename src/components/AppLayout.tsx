import { NavLink } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { employee, signOut } = useAuth()

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <header style={{
        background: '#fff',
        padding: '0 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 56,
        position: 'sticky',
        top: 0,
        zIndex: 10,
        boxShadow: '0 1px 0 #e2e8f0, 0 2px 8px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <span style={{ fontWeight: 700, color: '#14532d', fontSize: '1.0625rem', letterSpacing: '-0.02em', flexShrink: 0 }}>
            Sproutbien
          </span>
          <nav style={{ display: 'flex', gap: '0.125rem' }}>
            <NavLink to="/dashboard" style={navStyle}>Dashboard</NavLink>
            <NavLink to="/leave"     style={navStyle}>Leave</NavLink>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <span style={{ color: '#64748b', fontSize: '0.8125rem' }}>
            {employee?.full_name}
          </span>
          <button
            onClick={signOut}
            style={{
              background: 'none',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '0.3125rem 0.75rem',
              cursor: 'pointer',
              fontSize: '0.8125rem',
              color: '#64748b',
              fontFamily: 'inherit',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1.25rem' }}>
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
    color: isActive ? '#1d4ed8' : '#64748b',
    background: isActive ? '#eff6ff' : 'transparent',
    letterSpacing: '-0.01em',
  }
}
