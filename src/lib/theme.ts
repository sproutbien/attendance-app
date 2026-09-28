import { useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'sb-theme'

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* storage blocked */ }
  return 'system'
}

/** Employee-area theme: follows the device unless the user picks light/dark. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, choice) } catch { /* storage blocked */ }
  }, [choice])

  // undefined → let the prefers-color-scheme media query decide
  const dataTheme = choice === 'system' ? undefined : choice
  return { choice, setChoice, dataTheme }
}
