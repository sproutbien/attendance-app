import { useEffect, useRef, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { House, CalendarDays, ChartColumn, ChevronDown, User, LogOut, Sun, Moon, Monitor } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../lib/theme'
import type { ThemeChoice } from '../lib/theme'
import '../styles/app.css'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', Icon: House },
  { to: '/leave',     label: 'Leave',     Icon: CalendarDays },
  { to: '/reports',   label: 'Reports',   Icon: ChartColumn },
]

const THEMES: Array<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { value: 'light',  label: 'Light',  Icon: Sun },
  { value: 'dark',   label: 'Dark',   Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

/** Employee shell. `wide` lets the page lay out its own full-width sections (Dashboard). */
export default function AppLayout({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const theme = useTheme()
  return (
    <div className="sb-app" data-theme={theme.dataTheme}>
      <Header theme={theme} />
      {wide ? children : <div className="sb-narrow">{children}</div>}
      <nav className="sb-tabbar" aria-label="Main">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to}><Icon size={22} strokeWidth={2} />{label}</NavLink>
        ))}
      </nav>
    </div>
  )
}

type Theme = ReturnType<typeof useTheme>

function Header({ theme }: { theme: Theme }) {
  return (
    <header className="sb-header">
      <Link to="/dashboard" className="sb-brand" aria-label="Sproutbien home">
        <img src="/logo.jpg" alt="" />
        <span className="sb-wordmark">
          <strong>SproutBien</strong>
          <span>nurturing businesses digitally</span>
        </span>
      </Link>
      <nav className="sb-nav" aria-label="Main">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to}><Icon size={24} strokeWidth={2.2} />{label}</NavLink>
        ))}
      </nav>
      <UserMenu theme={theme} />
    </header>
  )
}

function UserMenu({ theme }: { theme: Theme }) {
  const { employee, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="sb-user" ref={ref}>
      <button className="sb-user-btn" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu">
        <span className="sb-avatar"><User size={30} strokeWidth={2.2} fill="currentColor" /></span>
        <ChevronDown size={22} strokeWidth={2.4} />
      </button>
      {open && (
        <div className="sb-menu" role="menu">
          <div className="sb-menu-who">
            <strong>{employee?.full_name}</strong>
            <span>{employee?.designation ?? employee?.email}</span>
          </div>
          <div className="sb-menu-label">Theme</div>
          <div className="sb-theme-toggle">
            {THEMES.map(({ value, label, Icon }) => (
              <button key={value} aria-pressed={theme.choice === value} onClick={() => theme.setChoice(value)}>
                <Icon size={18} />{label}
              </button>
            ))}
          </div>
          <button className="sb-menu-item" role="menuitem" onClick={signOut}>
            <LogOut size={18} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
