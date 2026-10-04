import { supabase } from './supabase'
import type { HolidayChoice } from '../types'

/**
 * Holidays between two dates: company-wide public holidays, plus each employee's
 * choice holidays (e.g. the Onam date they chose). See migration 027.
 */
export type HolidayCalendar = {
  common: Map<string, string>                     // date → name, for everyone
  personal: Map<string, Map<string, string>>      // employee → date → name
}

export const NO_HOLIDAYS: HolidayCalendar = { common: new Map(), personal: new Map() }

/** Admins get everyone's choice holidays; employees get their own. */
export async function loadHolidays(start: string, end: string): Promise<{ holidays: HolidayCalendar; error: string | null }> {
  const [pub, choice] = await Promise.all([
    supabase.from('public_holidays').select('date, name').gte('date', start).lte('date', end),
    supabase.rpc('choice_holidays_between', { p_from: start, p_to: end }),
  ])
  const personal: HolidayCalendar['personal'] = new Map()
  for (const r of (choice.data ?? []) as { employee_id: string; date: string; name: string }[]) {
    if (!personal.has(r.employee_id)) personal.set(r.employee_id, new Map())
    personal.get(r.employee_id)!.set(r.date, r.name)
  }
  return {
    holidays: { common: new Map((pub.data ?? []).map(h => [h.date, h.name])), personal },
    error: (pub.error ?? choice.error)?.message ?? null,
  }
}

/** One employee's holidays: public ones plus their own choice dates. */
export function holidaysFor(h: HolidayCalendar, employeeId: string | undefined): Map<string, string> {
  const own = employeeId ? h.personal.get(employeeId) : undefined
  return own ? new Map([...h.common, ...own]) : h.common
}

export function holidayName(h: HolidayCalendar, employeeId: string, date: string) {
  return h.common.get(date) ?? h.personal.get(employeeId)?.get(date)
}

/**
 * An employee's dates for a choice holiday right now. Mirrors choice_holiday_on() in migration 027:
 * their own complete choice, else the default dates.
 */
export function effectiveChoice(choice: HolidayChoice, picked: string[]) {
  if (picked.length === choice.pick_count) return { dates: [...picked].sort(), source: 'picked' as const }
  return { dates: choice.dates.filter(d => d.is_default).map(d => d.date), source: 'default' as const }
}

/** "Thu 27 Aug" */
export function fmtHolidayDay(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
