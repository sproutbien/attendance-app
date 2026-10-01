import { useEffect } from 'react'

/** While printing: name the PDF, open collapsed tables, force the light theme. */
export function usePrintSetup(title: string) {
  useEffect(() => {
    let oldTitle = document.title
    const opened: HTMLDetailsElement[] = []
    let theme: { el: HTMLElement; value: string | null } | null = null
    const before = () => {
      oldTitle = document.title
      document.title = title
      document.querySelectorAll<HTMLDetailsElement>('details.st-details:not([open])').forEach(d => { d.open = true; opened.push(d) })
      const app = document.querySelector<HTMLElement>('.sb-app')
      if (app) { theme = { el: app, value: app.getAttribute('data-theme') }; app.setAttribute('data-theme', 'light') }
    }
    const after = () => {
      document.title = oldTitle
      opened.splice(0).forEach(d => { d.open = false })
      if (theme) { theme.value == null ? theme.el.removeAttribute('data-theme') : theme.el.setAttribute('data-theme', theme.value); theme = null }
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after) }
  }, [title])
}
