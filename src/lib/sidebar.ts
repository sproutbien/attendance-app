import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

/** Whether a sidebar is collapsed to icons, remembered in this browser (expanded if storage is unavailable). */
export function useSidebarCollapsed(key: string) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  function toggle() {
    setCollapsed(c => {
      try { localStorage.setItem(key, c ? '0' : '1') } catch { /* private window: just don't remember */ }
      return !c
    })
  }
  return { collapsed, toggle }
}

/**
 * The sidebar as a slide-out menu on phones. Closes on a page change, Esc, or when the
 * window grows past `desktopQuery` (where the sidebar is always shown); the page behind doesn't scroll while open.
 */
export function useDrawer(desktopQuery: string) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const desktop = window.matchMedia(desktopQuery)
    const onWide = () => { if (desktop.matches) setOpen(false) }
    document.addEventListener('keydown', onKey)
    desktop.addEventListener('change', onWide)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      desktop.removeEventListener('change', onWide)
      document.body.style.overflow = overflow
    }
  }, [open, desktopQuery])

  return { open, show: () => setOpen(true), hide: () => setOpen(false) }
}

/** "Anitha Menon" → "AM" */
export function initials(name: string | null | undefined) {
  return (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}
