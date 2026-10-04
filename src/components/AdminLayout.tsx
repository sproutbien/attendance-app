import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { CalendarCheck, CalendarDays, ChartColumn, ChartLine, Clock, FilePen, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Users, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { LEAVE_CHANGED } from '../hooks/useLeaveQueue'
import { initials, useDrawer, useSidebarCollapsed } from '../lib/sidebar'

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

/** Admin shell: a sidebar on desktop (collapsible to icons); on phones the same sidebar slides out from a ☰ button. */
export default function AdminLayout() {
  const { employee, signOut } = useAuth()
  const attention = useAttentionCounts()
  const side = useSidebarCollapsed('sb.adminSidebarCollapsed')
  const drawer = useDrawer('(min-width: 901px)')
  const closeBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (drawer.open) closeBtn.current?.focus() }, [drawer.open])
  const totalAttention = attention.leave + attention.corrections

  return (
    <div className={`admin-shell${side.collapsed ? ' is-collapsed' : ''}`}>
      <aside className={`admin-side st-no-print${drawer.open ? ' is-open' : ''}`} aria-label="Menu">
        <div className="admin-side-brand">
          <img src="/logo.jpg" alt="Sproutbien" />
          <span className="admin-chip">Admin</span>
          <button type="button" ref={closeBtn} className="admin-drawer-close" onClick={drawer.hide} aria-label="Close menu">
            <X size={22} aria-hidden="true" />
          </button>
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
      {drawer.open && <div className="admin-drawer-backdrop st-no-print" onClick={drawer.hide} />}

      <div className="admin-body">
        <header className="st-no-print admin-header">
          <button type="button" className="admin-menu-btn" onClick={drawer.show} aria-label="Open menu" aria-expanded={drawer.open}>
            <Menu size={22} aria-hidden="true" />
            {totalAttention > 0 && <span className="admin-menu-dot">{totalAttention}</span>}
          </button>
          <img src="/logo.jpg" alt="Sproutbien" style={{ height: 32, display: 'block' }} />
          <span className="admin-chip">Admin</span>
        </header>

        <div className="admin-main" style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem', background: '#f0fdf4', minHeight: '100vh', boxSizing: 'border-box' }}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
