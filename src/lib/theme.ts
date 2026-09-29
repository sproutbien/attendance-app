import { useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

// v2: the old key auto-saved 'system' for everyone, so it can't tell a real choice from the old default
const STORAGE_KEY = 'sb-theme-v2'

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* storage blocked */ }
  return 'light'
}

/** Employee-area theme: light unless the user picks dark or system. */
export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice)

  // Persist only explicit picks, so the default stays changeable
  function setChoice(next: ThemeChoice) {
    setChoiceState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* storage blocked */ }
  }

  // undefined → let the prefers-color-scheme media query decide
  const dataTheme = choice === 'system' ? undefined : choice
  return { choice, setChoice, dataTheme }
}
