import { useState } from 'react'

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

/** "Anitha Menon" → "AM" */
export function initials(name: string | null | undefined) {
  return (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}
