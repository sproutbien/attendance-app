import { useEffect, useRef, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { House, CalendarDays, ChartColumn, ChevronUp, User, LogOut, Sun, Moon, Monitor, Camera, Menu, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { photoUrl, savePhoto } from '../lib/employees'
import { useTheme } from '../lib/theme'
import type { ThemeChoice } from '../lib/theme'
import { useDrawer, useHoverExpand } from '../lib/sidebar'
import { sweepExpiredSelfies } from '../lib/selfies'
import '../styles/app.css'
import { useBranding } from '../contexts/BrandingContext'

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

/**
 * Employee shell: a sidebar on desktop (collapsible to icons); on phones the same sidebar slides out
 * from a ☰ button, with the pages also one tap away in a bottom tab bar.
 * `wide` lets the page lay out its own full-width sections (Dashboard); `medium` is a roomier single column (Leaves).
 */
export default function AppLayout({ children, wide = false, medium = false }: { children: React.ReactNode; wide?: boolean; medium?: boolean }) {
  const theme = useTheme()
  const { branding, icon } = useBranding()
  const [accountOpen, setAccountOpen] = useState(false)
  const side = useHoverExpand(accountOpen)
  const drawer = useDrawer('(min-width: 761px)')
  const closeBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (drawer.open) closeBtn.current?.focus() }, [drawer.open])
  useEffect(() => { sweepExpiredSelfies() }, [])   // selfies past 15 days

  return (
    <div className={`sb-app sb-shell${side.expanded ? '' : ' is-collapsed'}`} data-theme={theme.dataTheme}>
      <aside className={`sb-side st-no-print${drawer.open ? ' is-open' : ''}`} aria-label="Menu" {...side.handlers}>
        <div className="sb-side-top">
          <Link to="/dashboard" className="sb-side-brand" aria-label={`${branding.app_name} home`}>
            <img src={icon} alt="" />
            <span className="sb-wordmark sb-side-label">
              <strong>{branding.app_name}</strong>
              {branding.tagline && <span>{branding.tagline}</span>}
            </span>
          </Link>
          <button type="button" ref={closeBtn} className="sb-drawer-close" onClick={drawer.hide} aria-label="Close menu">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <nav className="sb-side-nav" aria-label="Main">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} title={label}>
              <Icon size={20} strokeWidth={2} aria-hidden="true" />
              <span className="sb-side-label">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sb-side-foot">
          <UserMenu theme={theme} onOpenChange={setAccountOpen} />
        </div>
      </aside>
      {drawer.open && <div className="sb-drawer-backdrop st-no-print" onClick={drawer.hide} />}
      <div className="sb-body">
        <Header onMenu={drawer.show} menuOpen={drawer.open} />
        {wide ? children : <div className={medium ? 'sb-narrow sb-medium' : 'sb-narrow'}>{children}</div>}
      </div>
      <nav className="sb-tabbar" aria-label="Main">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to}><Icon size={22} strokeWidth={2} />{label}</NavLink>
        ))}
      </nav>
    </div>
  )
}

type Theme = ReturnType<typeof useTheme>

/** Phones only (desktop has the sidebar): ☰ opens the sidebar as a slide-out menu */
function Header({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const { branding, icon } = useBranding()
  return (
    <header className="sb-header">
      <button type="button" className="sb-menu-btn" onClick={onMenu} aria-label="Open menu" aria-expanded={menuOpen}>
        <Menu size={24} aria-hidden="true" />
      </button>
      <Link to="/dashboard" className="sb-brand" aria-label={`${branding.app_name} home`}>
        <img src={icon} alt="" />
        <span className="sb-wordmark">
          <strong>{branding.app_name}</strong>
          {branding.tagline && <span>{branding.tagline}</span>}
        </span>
      </Link>
    </header>
  )
}

/** Account menu at the foot of the sidebar; opens upward. */
function UserMenu({ theme, onOpenChange }: { theme: Theme; onOpenChange: (open: boolean) => void }) {
  const { employee, signOut, refreshEmployee } = useAuth()
  const [open, setOpen] = useState(false)
  useEffect(() => { onOpenChange(open) }, [open])  // eslint-disable-line react-hooks/exhaustive-deps
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const photo = employee ? photoUrl(employee) : null

  async function changePhoto(file: File | null) {
    if (!employee) return
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      await savePhoto(employee, file)
      await refreshEmployee()
    } catch (e) {
      setPhotoError((e as Error).message)
    }
    setPhotoBusy(false)
  }

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
      <button className="sb-user-btn" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu"
        title={employee?.full_name}>
        <span className="sb-avatar">
          {photo ? <img src={photo} alt="" /> : <User size={20} strokeWidth={2.2} fill="currentColor" />}
        </span>
        <span className="sb-side-who">
          <strong>{employee?.full_name}</strong>
          <span>{employee?.designation ?? employee?.email}</span>
        </span>
        <ChevronUp size={18} strokeWidth={2.4} />
      </button>
      {open && (
        <div className="sb-menu sb-menu-up" role="menu">
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
          <button className="sb-menu-item" role="menuitem" disabled={photoBusy} onClick={() => fileInput.current?.click()}>
            <Camera size={18} /> {photoBusy ? 'Saving photo…' : photo ? 'Change photo' : 'Add photo'}
          </button>
          {photo && !photoBusy && (
            <button className="sb-menu-item sb-menu-item-quiet" role="menuitem" onClick={() => changePhoto(null)}>
              Remove photo
            </button>
          )}
          {photoError && <p className="sb-menu-error">{photoError}</p>}
          <input
            ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) changePhoto(f) }}
          />
          <button className="sb-menu-item" role="menuitem" onClick={signOut}>
            <LogOut size={18} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
