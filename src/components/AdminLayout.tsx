import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { Menu, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { LEAVE_CHANGED } from '../hooks/useLeaveQueue'

/**
 * Nav badge counts: leave = pending requests + cancellations no admin has marked seen;
 * corrections = pending correction requests. Refreshes on page change and after admin actions.
 */
function useAttentionCounts() {
  const { pathname } = useLocation()
  const [counts, setCounts] = useState({ leave: 0, corrections: 0 })
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [leave, corrections] = await Promise.all([
        supabase
          .from('leave_requests')
          .select('id', { count: 'exact', head: true })
          .or('status.eq.pending,and(status.eq.cancelled,cancel_seen_at.is.null)'),
        supabase
          .from('attendance_corrections')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
      ])
      if (!cancelled) setCounts({ leave: leave.count ?? 0, corrections: corrections.count ?? 0 })
    }
    load()
    window.addEventListener(LEAVE_CHANGED, load)
    return () => { cancelled = true; window.removeEventListener(LEAVE_CHANGED, load) }
  }, [pathname])
  return counts
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span aria-label={`${count} need attention`} style={{
      marginLeft: 6, padding: '0 6px', borderRadius: 99, background: '#f87171',
      color: '#fff', fontSize: '0.6875rem', fontWeight: 700, lineHeight: '16px', display: 'inline-block',
    }}>
      {count}
    </span>
  )
}

const NAV = [
  { to: '/admin/attendance',  label: 'Attendance' },
  { to: '/admin/leave',       label: 'Leave',       badge: 'leave' },
  { to: '/admin/corrections', label: 'Corrections', badge: 'corrections' },
  { to: '/admin/employees',   label: 'Employees' },
  { to: '/admin/reports',     label: 'Reports' },
  { to: '/admin/team-stats',  label: 'Team Stats' },
  { to: '/admin/calendar',    label: 'Calendar' },
] as const

export default function AdminLayout() {
  const { employee, signOut } = useAuth()
  const attention = useAttentionCounts()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const totalAttention = attention.leave + attention.corrections

  // Phone menu closes when a page is picked
  useEffect(() => { setMenuOpen(false) }, [pathname])

  const links = (style: typeof navStyle) => NAV.map(n => (
    <NavLink key={n.to} to={n.to} style={style}>
      {n.label}{'badge' in n && <Badge count={attention[n.badge]} />}
    </NavLink>
  ))

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <header className="st-no-print admin-header" style={{
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
          <nav className="admin-nav" style={{ display: 'flex', gap: '0.125rem' }}>
            {links(navStyle)}
          </nav>
        </div>
        <button
          className="admin-menu-btn"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
          {!menuOpen && totalAttention > 0 && <span className="admin-menu-dot">{totalAttention}</span>}
        </button>
        <div className="admin-user" style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
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

      {menuOpen && (
        <div className="admin-menu st-no-print">
          <nav>{links(menuLinkStyle)}</nav>
          <div className="admin-menu-foot">
            <span>{employee?.full_name}</span>
            <button onClick={signOut}>Sign out</button>
          </div>
        </div>
      )}

      <div className="admin-main" style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem', background: '#f0fdf4', minHeight: 'calc(100vh - 56px)' }}>
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

function menuLinkStyle({ isActive }: { isActive: boolean }): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    textDecoration: 'none',
    padding: '0.8rem 1rem',
    borderRadius: 8,
    fontSize: '1rem',
    fontWeight: isActive ? 700 : 500,
    color: isActive ? '#14532d' : '#1e293b',
    background: isActive ? '#dcfce7' : 'transparent',
  }
}
