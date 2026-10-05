import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Desktop sidebar: icons only, opening over the page while the mouse is on it
 * (short delays so passing across doesn't flicker), while a keyboard user tabs
 * into it, or while `holdOpen` (e.g. its account menu is open).
 * Collapsing only applies on mouse devices; see the CSS.
 */
export function useHoverExpand(holdOpen = false) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function later(value: boolean, ms: number) {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setHovered(value), ms)
  }

  return {
    expanded: hovered || focused || holdOpen,
    handlers: {
      onMouseEnter: () => later(true, 120),
      onMouseLeave: () => later(false, 250),
      // Keyboard only: a mouse click also focuses, and shouldn't keep it open
      onFocus: (e: React.FocusEvent) => setFocused((e.target as HTMLElement).matches(':focus-visible')),
      onMouseDown: () => setFocused(false),
      onBlur: (e: React.FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false) },
    },
  }
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
