import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type Manager = { full_name: string; designation: string | null; photo_path: string | null; email: string; phone: string | null }
export type ContactDraft = { phone: string | null; ec_name: string; ec_relation: string; ec_phone: string }

/** Employee: their reporting manager, and saving their own contact details (migration 040). */
export function useMyProfile(employeeId: string | undefined) {
  const [manager, setManager] = useState<Manager | null>(null)

  useEffect(() => {
    if (!employeeId) return
    supabase.rpc('my_reporting_manager').then(({ data }) => setManager(((data ?? []) as Manager[])[0] ?? null))
  }, [employeeId])

  async function saveContact(c: ContactDraft) {
    const { error } = await supabase.rpc('update_my_contact', {
      p_phone: c.phone, p_ec_name: c.ec_name, p_ec_relation: c.ec_relation, p_ec_phone: c.ec_phone,
    })
    return error?.message ?? null
  }

  return { manager, saveContact }
}
