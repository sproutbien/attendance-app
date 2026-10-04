import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { CalendarCheck, CalendarDays, ChartColumn, ChartLine, Clock, FilePen, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Users, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { LEAVE_CHANGED } from '../hooks/useLeaveQueue'
import { initials, useSidebarCollapsed } from '../lib/sidebar'

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

const NAV = [
  { to: '/admin/attendance',  label: 'Attendance',  Icon: Clock },
  { to: '/admin/leave',       label: 'Leave',       Icon: CalendarCheck, badge: 'leave' },
  { to: '/admin/corrections', label: 'Corrections', Icon: FilePen,       badge: 'corrections' },
  { to: '/admin/employees',   label: 'Employees',   Icon: Users },
  { to: '/admin/reports',     label: 'Reports',     Icon: ChartColumn },
  { to: '/admin/team-stats',  label: 'Team Stats',  Icon: ChartLine },
  { to: '/admin/calendar',    label: 'Calendar',    Icon: CalendarDays },
] as const

/** Admin shell: a sidebar on desktop (collapsible to icons), a top bar with a menu panel on phones. */
export default function AdminLayout() {
  const { employee, signOut } = useAuth()
  const attention = useAttentionCounts()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const side = useSidebarCollapsed('sb.adminSidebarCollapsed')
  const totalAttention = attention.leave + attention.corrections

  // Phone menu closes when a page is picked
  useEffect(() => { setMenuOpen(false) }, [pathname])

  return (
    <div className={`admin-shell${side.collapsed ? ' is-collapsed' : ''}`}>
      <aside className="admin-side st-no-print">
        <div className="admin-side-brand">
          <img src="/logo.jpg" alt="Sproutbien" />
          <span className="admin-chip">Admin</span>
        </div>
        <nav aria-label="Admin">
          {NAV.map(n => {
            const count = 'badge' in n ? attention[n.badge] : 0
            return (
              <NavLink key={n.to} to={n.to} title={n.label} aria-label={count > 0 ? `${n.label}, ${count} need attention` : undefined}>
                <n.Icon size={20} strokeWidth={2} aria-hidden="true" />
                <span className="admin-side-label">{n.label}</span>
                {count > 0 && <span className="admin-side-badge">{count}</span>}
                {count > 0 && <span className="admin-side-dot" />}
              </NavLink>
            )
          })}
        </nav>
        <div className="admin-side-foot">
          <div className="admin-side-user" title={employee?.full_name}>
            <span className="admin-side-initials">{initials(employee?.full_name)}</span>
            <span className="admin-side-who">
              <strong>{employee?.full_name}</strong>
              <span>Admin</span>
            </span>
          </div>
          <button type="button" className="admin-side-btn" onClick={signOut} title="Sign out">
            <LogOut size={20} aria-hidden="true" />
            <span className="admin-side-label">Sign out</span>
          </button>
          <button type="button" className="admin-side-btn admin-side-collapse" onClick={side.toggle}
            aria-label={side.collapsed ? 'Expand menu' : 'Collapse menu'} title={side.collapsed ? 'Expand menu' : 'Collapse menu'}>
            {side.collapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
            <span className="admin-side-label">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="admin-body">
        <header className="st-no-print admin-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <img src="/logo.jpg" alt="Sproutbien" style={{ height: 32, display: 'block' }} />
            <span className="admin-chip">Admin</span>
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
        </header>

        {menuOpen && (
          <div className="admin-menu st-no-print">
            <nav>
              {NAV.map(n => (
                <NavLink key={n.to} to={n.to} style={menuLinkStyle}>
                  {n.label}{'badge' in n && <Badge count={attention[n.badge]} />}
                </NavLink>
              ))}
            </nav>
            <div className="admin-menu-foot">
              <span>{employee?.full_name}</span>
              <button onClick={signOut}>Sign out</button>
            </div>
          </div>
        )}

        <div className="admin-main" style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem', background: '#f0fdf4', minHeight: '100vh', boxSizing: 'border-box' }}>
          <Outlet />
        </div>
      </div>
    </div>
  )
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
