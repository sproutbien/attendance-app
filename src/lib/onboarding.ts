import { supabase } from './supabase'
import { docMimeType } from './leaveDocs'
import { localDate } from './calendar'
import type { DocCategory, Employee, EmployeeDocument, OnboardingTask } from '../types'

// Onboarding checklist, employee documents and probation — must match migration 029.

export const EMPLOYEE_DOC_BUCKET = 'employee-documents'
export const DOC_CATEGORIES: DocCategory[] = ['Offer letter', 'ID proof', 'PAN card', 'Bank proof', 'Certificates', 'Other']

/** Uploads one file and records it; a matching checklist task ticks itself. */
export async function uploadEmployeeDocument(employeeId: string, category: DocCategory, file: File): Promise<void> {
  const type = docMimeType(file.name)
  if (!type) throw new Error(`${file.name}: only PDF, PNG, JPEG and Word files can be added.`)
  const ext = file.name.split('.').pop()!.toLowerCase()
  const path = `${employeeId}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from(EMPLOYEE_DOC_BUCKET).upload(path, file, { contentType: type })
  if (up.error) throw new Error(`Couldn't upload ${file.name}: ${up.error.message}`)
  const { error } = await supabase.from('employee_documents').insert({
    employee_id: employeeId, category, path, file_name: file.name.slice(0, 200), mime_type: type, size_bytes: file.size,
  })
  if (error) {
    await supabase.storage.from(EMPLOYEE_DOC_BUCKET).remove([path])
    throw new Error(`Couldn't save ${file.name}: ${error.message}`)
  }
}

/** Admins only (documents are HR records). */
export async function deleteEmployeeDocument(doc: EmployeeDocument): Promise<string | null> {
  const { error } = await supabase.from('employee_documents').delete().eq('id', doc.id)
  if (error) return error.message
  await supabase.storage.from(EMPLOYEE_DOC_BUCKET).remove([doc.path])
  return null
}

/** Opens a document in a new tab (Word files download). */
export async function openEmployeeDocument(doc: EmployeeDocument) {
  const tab = window.open('', '_blank')   // opened now so pop-up blockers allow it
  const isWord = doc.mime_type.includes('word')
  const { data, error } = await supabase.storage.from(EMPLOYEE_DOC_BUCKET)
    .createSignedUrl(doc.path, 60 * 10, isWord ? { download: doc.file_name } : undefined)
  if (error || !data) { tab?.close(); return error?.message ?? 'Document not found' }
  if (tab) tab.location.href = data.signedUrl
  else window.location.href = data.signedUrl
  return null
}

export function progress(tasks: Pick<OnboardingTask, 'done_at'>[]) {
  const done = tasks.filter(t => t.done_at).length
  return { done, total: tasks.length, complete: tasks.length > 0 && done === tasks.length }
}

/** Whole days from today to a date (negative = past). */
export function daysUntil(date: string, today = localDate()) {
  return Math.round((new Date(date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000)
}

/** "in 5 days" / "today" / "3 days ago" */
export function relativeDays(n: number) {
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

/** On probation with an end date within `withinDays` (or already past). */
export function probationDue(e: Pick<Employee, 'status' | 'probation_end_date'>, withinDays = 14) {
  return e.status === 'probation' && !!e.probation_end_date && daysUntil(e.probation_end_date) <= withinDays
}

/** Hasn't started yet (joining date in the future). */
export function notStartedYet(e: Pick<Employee, 'joining_date'> | null | undefined, today = localDate()) {
  return !!e?.joining_date && e.joining_date > today
}
