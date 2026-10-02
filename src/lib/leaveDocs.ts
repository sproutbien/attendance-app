import { supabase } from './supabase'
import type { LeaveDocument, LeaveRequest } from '../types'

// Documents on sick leave — must match migration 025.

export const LEAVE_DOC_BUCKET = 'leave-documents'
export const MAX_LEAVE_DOCS = 5
export const MAX_LEAVE_DOC_BYTES = 10 * 1024 * 1024
/** Days after the request was made during which the employee can add / remove documents. */
export const LEAVE_DOC_WINDOW_DAYS = 30

const TYPES: Record<string, string> = {
  pdf:  'application/pdf',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** For <input accept>. */
export const LEAVE_DOC_ACCEPT = '.pdf,.png,.jpg,.jpeg,.doc,.docx,' + [...new Set(Object.values(TYPES))].join(',')

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

/** Why this file can't be attached, or null. */
export function leaveDocProblem(file: File): string | null {
  if (!TYPES[extOf(file.name)]) return `${file.name}: only PDF, PNG, JPEG and Word files can be attached.`
  if (file.size > MAX_LEAVE_DOC_BYTES) return `${file.name} is larger than 10 MB.`
  if (file.size === 0) return `${file.name} is empty.`
  return null
}

/** Sick leave takes documents (including Sick + Loss of Pay splits). */
export const takesDocuments = (r: Pick<LeaveRequest, 'leave_type'>) => r.leave_type === 'sick'

/** Last moment the employee can add or remove documents. */
export function leaveDocDeadline(r: Pick<LeaveRequest, 'requested_at'>) {
  return new Date(new Date(r.requested_at).getTime() + LEAVE_DOC_WINDOW_DAYS * 86_400_000)
}

/** The employee can still add / remove documents on this leave. */
export function leaveDocsOpen(r: Pick<LeaveRequest, 'leave_type' | 'status' | 'requested_at'>, now = Date.now()) {
  return takesDocuments(r) && (r.status === 'pending' || r.status === 'approved') && now <= leaveDocDeadline(r).getTime()
}

/** Uploads one file for a leave and records it. */
export async function uploadLeaveDocument(employeeId: string, leaveId: string, file: File): Promise<void> {
  const type = TYPES[extOf(file.name)]
  const path = `${employeeId}/${leaveId}/${crypto.randomUUID()}.${extOf(file.name)}`
  const up = await supabase.storage.from(LEAVE_DOC_BUCKET).upload(path, file, { contentType: type })
  if (up.error) throw new Error(`Couldn't upload ${file.name}: ${up.error.message}`)
  const { error } = await supabase.from('leave_documents').insert({
    leave_id: leaveId, employee_id: employeeId, path, file_name: file.name.slice(0, 200), mime_type: type, size_bytes: file.size,
  })
  if (error) {
    await supabase.storage.from(LEAVE_DOC_BUCKET).remove([path])
    throw new Error(`Couldn't attach ${file.name}: ${error.message}`)
  }
}

/** Uploads several; returns the error messages of any that failed. */
export async function uploadLeaveDocuments(employeeId: string, leaveId: string, files: File[]): Promise<string[]> {
  const errors: string[] = []
  for (const f of files) {
    try { await uploadLeaveDocument(employeeId, leaveId, f) } catch (e) { errors.push((e as Error).message) }
  }
  return errors
}

export async function deleteLeaveDocument(doc: LeaveDocument): Promise<string | null> {
  const { error } = await supabase.from('leave_documents').delete().eq('id', doc.id)
  if (error) return error.message
  // Another part of a split leave may still use the file; then it stays
  await supabase.storage.from(LEAVE_DOC_BUCKET).remove([doc.path])
  return null
}

/** Opens a document in a new tab (Word files download). */
export async function openLeaveDocument(doc: LeaveDocument) {
  const tab = window.open('', '_blank')   // opened now so pop-up blockers allow it
  const isWord = doc.mime_type.includes('word')
  const { data, error } = await supabase.storage.from(LEAVE_DOC_BUCKET)
    .createSignedUrl(doc.path, 60 * 10, isWord ? { download: doc.file_name } : undefined)
  if (error || !data) { tab?.close(); return error?.message ?? 'Document not found' }
  if (tab) tab.location.href = data.signedUrl
  else window.location.href = data.signedUrl
  return null
}

/** 1536 → "1.5 KB", 2400000 → "2.3 MB" */
export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
