import { supabase } from './supabase'
import { localDate } from './calendar'
import { repeatBetween } from './celebrations'
import type { Employee } from '../types'

/**
 * Mail to employees (migration 049, Edge Function employee-mail).
 * One message with merge fields; each person gets their own copy.
 * The merge rules here are mirrored in supabase/functions/employee-mail/index.ts — keep them in step.
 */

export type MailKind = 'update' | 'greeting'

export type MailTemplate = { id: string; name: string; kind: MailKind; subject: string; body: string }

export type MailCampaign = {
  id: string
  kind: MailKind
  subject: string
  body: string
  sent_by: string | null
  total: number
  sent_count: number
  failed_count: number
  skipped_count: number
  created_at: string
  finished_at: string | null
}

export type MailRecipient = {
  id: string
  campaign_id: string
  employee_id: string | null
  full_name: string
  email: string
  status: 'pending' | 'sent' | 'failed' | 'skipped'
  error: string | null
  sent_at: string | null
}

export const MERGE_FIELDS = [
  { key: 'first_name',    label: 'First name' },
  { key: 'full_name',     label: 'Full name' },
  { key: 'designation',   label: 'Designation' },
  { key: 'department',    label: 'Department' },
  { key: 'employee_code', label: 'Employee code' },
  { key: 'joining_date',  label: 'Joining date' },
  { key: 'years',         label: 'Years with us' },
  { key: 'company_name',  label: 'Company name' },
] as const
export type MergeField = typeof MERGE_FIELDS[number]['key']
const KEYS: readonly string[] = MERGE_FIELDS.map(f => f.key)
const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g

type Person = Pick<Employee, 'full_name' | 'designation' | 'department' | 'employee_code' | 'joining_date'>

/** Whole years since joining, as of `today` (YYYY-MM-DD). */
export function yearsSince(joining: string | null, today = localDate()) {
  if (!joining) return null
  let y = Number(today.slice(0, 4)) - Number(joining.slice(0, 4))
  const ty = Number(today.slice(0, 4))
  const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0
  const md = joining.slice(5, 10) === '02-29' && !leap ? '02-28' : joining.slice(5, 10)   // as the celebrations do
  if (today.slice(5) < md) y--
  return Math.max(y, 0)
}

export function mergeValues(p: Person, company: string, today = localDate()): Record<MergeField, string> {
  const years = yearsSince(p.joining_date, today)
  return {
    first_name: p.full_name.trim().split(/\s+/)[0] ?? '',
    full_name: p.full_name.trim(),
    designation: p.designation ?? '',
    department: p.department ?? '',
    employee_code: p.employee_code ?? '',
    joining_date: p.joining_date
      ? new Date(p.joining_date.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      : '',
    years: years === null ? '' : String(years),
    company_name: company,
  }
}

export const fillFields = (text: string, v: Record<MergeField, string>) =>
  text.replace(TOKEN, (whole, name: string) => KEYS.includes(name) ? v[name as MergeField] : whole)

/** Fields used in the texts, split into known and unknown (typos). */
export function usedFields(...texts: string[]) {
  const known = new Set<MergeField>()
  const unknown = new Set<string>()
  for (const t of texts) for (const m of t.matchAll(TOKEN)) {
    if (KEYS.includes(m[1])) known.add(m[1] as MergeField)
    else unknown.add(m[1])
  }
  return { known: [...known], unknown: [...unknown] }
}

/** Who among `people` would get a blank for one of `fields`, per field. */
export function blanks(people: Person[], fields: MergeField[], company: string) {
  const out: { field: MergeField; names: string[] }[] = []
  for (const field of fields) {
    const names = people.filter(p => !mergeValues(p, company)[field]).map(p => p.full_name)
    if (names.length) out.push({ field, names })
  }
  return out
}

/** Staff who can be mailed: not in the bin and not gone. */
export const mailable = (e: Employee) => !e.deleted_at && !['resigned', 'terminated', 'inactive'].includes(e.status)

/** Birthday or work anniversary falling between `from` and `to` (inclusive). */
export function occasionsBetween(people: Employee[], from: string, to: string) {
  const out: { employee: Employee; kind: 'birthday' | 'anniversary'; date: string; years: number | null }[] = []
  for (const e of people) {
    // repeatBetween only returns dates after the original, so a first anniversary is a year in
    const b = repeatBetween(e.date_of_birth, from, to)
    if (b) out.push({ employee: e, kind: 'birthday', date: b, years: null })
    const a = repeatBetween(e.joining_date, from, to)
    if (a) out.push({ employee: e, kind: 'anniversary', date: a, years: yearsSince(e.joining_date, a) })
  }
  return out.sort((x, y) => x.date.localeCompare(y.date))
}

// ── Server calls ──────────────────────────────────────────────

/** Readable database errors; the tables only exist once migration 049 has been run. */
function dbError(e: { message: string }) {
  return new Error(/schema cache|does not exist/i.test(e.message)
    ? 'Mail isn’t set up yet: run supabase/migrations/049_employee_mail.sql in the Supabase SQL Editor (see docs/EMPLOYEE_MAIL_SETUP.md).'
    : e.message)
}

export type SendResult = { campaign_id: string; sent: number; failed: number; skipped: number }

async function call(body: Record<string, unknown>): Promise<SendResult> {
  const { data, error } = await supabase.functions.invoke('employee-mail', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    let msg: string | null = null
    try { const b = await ctx?.json(); msg = b?.error ?? null } catch { /* not JSON */ }
    throw new Error(msg ?? (error.message.includes('Failed to send a request')
      ? 'The email function isn’t deployed yet. See docs/EMPLOYEE_MAIL_SETUP.md.'
      : error.message))
  }
  if (data?.ok !== true) throw new Error(data?.error ?? 'The email function gave an unexpected answer. Check the History below before sending again.')
  return data as SendResult
}

export const sendMail = (m: { kind: MailKind; subject: string; body: string; employee_ids: string[] }) =>
  call({ action: 'send', ...m })

export const retryMail = (campaignId: string) => call({ action: 'retry', campaign_id: campaignId })

export async function loadTemplates(): Promise<MailTemplate[]> {
  const { data, error } = await supabase.from('mail_templates').select('id, name, kind, subject, body').order('kind').order('name')
  if (error) throw dbError(error)
  return data ?? []
}

export async function saveTemplate(t: Omit<MailTemplate, 'id'> & { id?: string }) {
  const row = { name: t.name.trim(), kind: t.kind, subject: t.subject, body: t.body, updated_at: new Date().toISOString() }
  const { data, error } = t.id
    ? await supabase.from('mail_templates').update(row).eq('id', t.id).select('id').single()
    : await supabase.from('mail_templates').insert(row).select('id').single()
  if (error) throw dbError(error)
  return data.id as string
}

export async function deleteTemplate(id: string) {
  const { error } = await supabase.from('mail_templates').delete().eq('id', id)
  if (error) throw dbError(error)
}

export async function loadCampaigns(limit = 30): Promise<MailCampaign[]> {
  const { data, error } = await supabase.from('mail_campaigns').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw dbError(error)
  return data ?? []
}

export async function loadRecipients(campaignId: string): Promise<MailRecipient[]> {
  const { data, error } = await supabase.from('mail_recipients')
    .select('id, campaign_id, employee_id, full_name, email, status, error, sent_at')
    .eq('campaign_id', campaignId).order('status').order('full_name')
  if (error) throw dbError(error)
  return data ?? []
}
