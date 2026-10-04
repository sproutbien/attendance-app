import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { LeavePolicy } from '../types'

/** The published policy and the signed-in person's acknowledgements. */
export function useLeavePolicy(employeeId: string | undefined) {
  const [policy, setPolicy] = useState<LeavePolicy | null>(null)
  const [acks, setAcks] = useState<{ version: number; acknowledged_at: string }[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!employeeId) return
    const [p, a] = await Promise.all([
      supabase.from('leave_policy').select('additional_rules, version, published_at, published_by').maybeSingle(),
      supabase.from('leave_policy_acks').select('version, acknowledged_at').eq('employee_id', employeeId).order('version', { ascending: false }),
    ])
    setPolicy((p.data as LeavePolicy | null) ?? null)
    setAcks(a.data ?? [])
    setLoading(false)
  }, [employeeId])

  useEffect(() => { refresh() }, [refresh])

  const current = policy ? acks.find(a => a.version === policy.version) ?? null : null
  return {
    policy, loading, refresh,
    /** When they acknowledged the current version (null = not yet). */
    acknowledgedAt: current?.acknowledged_at ?? null,
    /** A published version they haven't read yet. */
    needsAck: !!policy && policy.version > 0 && !current,
    /** They read an earlier version (so this is an update, not a first read). */
    readBefore: acks.length > 0,
    acknowledge: async () => {
      const { error } = await supabase.rpc('acknowledge_leave_policy')
      await refresh()
      return error?.message ?? null
    },
  }
}

/** Admin: save the additional rules (optionally publishing), and who has read the current version. */
export function useLeavePolicyAdmin() {
  const [policy, setPolicy] = useState<LeavePolicy | null>(null)
  const [readBy, setReadBy] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('leave_policy').select('additional_rules, version, published_at, published_by').maybeSingle()
    const p = (data as LeavePolicy | null) ?? null
    setPolicy(p)
    if (p) {
      const { data: acks } = await supabase.from('leave_policy_acks').select('employee_id').eq('version', p.version)
      setReadBy(new Set((acks ?? []).map(a => a.employee_id)))
    }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function save(rules: string, publish: boolean) {
    const { error } = await supabase.rpc('save_leave_policy', { p_rules: rules, p_publish: publish })
    await refresh()
    return error?.message ?? null
  }

  return { policy, readBy, loading, save, refresh }
}
