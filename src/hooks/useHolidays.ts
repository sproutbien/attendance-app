import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { daysInMonth } from '../lib/calendar'

export type Holiday = { date: string; name: string }

/** Admin: list / add / remove public holidays for one month */
export function useHolidays(yearMonth: string) {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchHolidays = useCallback(async () => {
    const { data, error } = await supabase
      .from('public_holidays')
      .select('date, name')
      .gte('date', `${yearMonth}-01`)
      .lte('date', `${yearMonth}-${String(daysInMonth(yearMonth)).padStart(2, '0')}`)
      .order('date')
    return { data: (data ?? []) as Holiday[], error: error?.message ?? null }
  }, [yearMonth])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchHolidays().then(({ data, error }) => {
      if (cancelled) return
      setHolidays(data)
      setError(error)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [fetchHolidays])

  /** Adds a holiday, or renames it if the date already has one */
  async function save(date: string, name: string): Promise<string | null> {
    setSaving(true)
    const { error } = await supabase.from('public_holidays').upsert({ date, name })
    if (!error) {
      const refreshed = await fetchHolidays()
      setHolidays(refreshed.data)
    }
    setSaving(false)
    return error?.message ?? null
  }

  async function remove(date: string): Promise<string | null> {
    const { error } = await supabase.from('public_holidays').delete().eq('date', date)
    if (error) return error.message
    setHolidays(prev => prev.filter(h => h.date !== date))
    return null
  }

  return { holidays, loading, error, saving, save, remove }
}
