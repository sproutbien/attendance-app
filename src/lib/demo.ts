// ── Demo build (VITE_DEMO=1): public live demo backed by a separate Supabase project ──
// Data there is wiped and re-seeded every night (supabase/demo/02_demo.sql).

export const IS_DEMO = import.meta.env.VITE_DEMO === '1'

export const DEMO_ACCOUNTS = {
  admin:    { email: 'admin@demo.sproutbien.com',    password: 'Demo@2026', label: 'Admin',    who: 'Anitha Menon · HR Manager' },
  employee: { email: 'employee@demo.sproutbien.com', password: 'Demo@2026', label: 'Employee', who: 'Arjun Nair · Software Engineer' },
} as const

export type DemoRole = keyof typeof DEMO_ACCOUNTS

/** Months of seeded history before the current one (matches demo_seed()). */
export const DEMO_HISTORY_MONTHS = Number(import.meta.env.VITE_DEMO_HISTORY_MONTHS || 0)
