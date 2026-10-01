import { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

type AuthContextValue = {
  session: Session | null
  employee: Employee | null
  loading: boolean
  signOut: () => Promise<void>
  /** Re-reads the signed-in employee's row, e.g. after they change their photo. */
  refreshEmployee: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  // The employee row tagged with the user it was fetched for
  const [profile, setProfile] = useState<{ userId: string; employee: Employee | null } | null>(null)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setSessionReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  // Fetch here rather than inside onAuthStateChange — awaiting supabase calls there can deadlock.
  // Keyed on userId, so token refreshes don't refetch.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetchEmployee(userId).then(employee => {
      if (!cancelled) setProfile({ userId, employee })
    })
    return () => { cancelled = true }
  }, [userId])

  async function refreshEmployee() {
    if (!userId) return
    const employee = await fetchEmployee(userId)
    setProfile({ userId, employee })
  }

  const employee = profile && profile.userId === userId ? profile.employee : null
  // Loading until the session is known AND the profile for this exact user has arrived —
  // otherwise route guards briefly see a session with no employee ("Account not set up")
  const loading = !sessionReady || (userId !== null && profile?.userId !== userId)

  return (
    <AuthContext.Provider value={{
      session,
      employee,
      loading,
      signOut: () => supabase.auth.signOut(),
      refreshEmployee,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

async function fetchEmployee(userId: string): Promise<Employee | null> {
  const { data } = await supabase.from('employees').select('*').eq('id', userId).maybeSingle()
  return data ?? null
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
