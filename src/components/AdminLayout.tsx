import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import type { CSSProperties } from 'react'
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

export default function AdminLayout() {
  const { employee, signOut } = useAuth()
  const attention = useAttentionCounts()

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <header className="st-no-print" style={{
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
            <NavLink to="/admin/leave"      style={navStyle}>Leave<Badge count={attention.leave} /></NavLink>
            <NavLink to="/admin/corrections" style={navStyle}>Corrections<Badge count={attention.corrections} /></NavLink>
            <NavLink to="/admin/employees"  style={navStyle}>Employees</NavLink>
            <NavLink to="/admin/reports"    style={navStyle}>Reports</NavLink>
            <NavLink to="/admin/team-stats" style={navStyle}>Team Stats</NavLink>
            <NavLink to="/admin/calendar"   style={navStyle}>Calendar</NavLink>
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
