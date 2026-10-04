import { supabase } from './supabase'
import { docMimeType } from './leaveDocs'
import { uploadEmployeeDocument } from './onboarding'
import type { Candidate, CandidateStage } from '../types'

// Hiring — must match migration 030.

export const RESUME_BUCKET = 'candidate-resumes'

/** The three stages shown as columns; hired / not selected are listed separately. */
export const OPEN_STAGES: CandidateStage[] = ['applied', 'interview', 'offer']

export const STAGE_LABELS: Record<CandidateStage, string> = {
  applied:      'Applied',
  interview:    'Interview',
  offer:        'Offer',
  hired:        'Hired',
  not_selected: 'Not selected',
}

export const STAGE_COLORS: Record<CandidateStage, { bg: string; text: string }> = {
  applied:      { bg: '#f1f5f9', text: '#475569' },
  interview:    { bg: '#e0f2fe', text: '#075985' },
  offer:        { bg: '#fef3c7', text: '#92400e' },
  hired:        { bg: '#dcfce7', text: '#166534' },
  not_selected: { bg: '#fee2e2', text: '#991b1b' },
}

/** The stage after this one in the pipeline, if any. */
export function nextStage(s: CandidateStage): CandidateStage | null {
  const i = OPEN_STAGES.indexOf(s)
  return i >= 0 && i < OPEN_STAGES.length - 1 ? OPEN_STAGES[i + 1] : null
}

/** Uploads a résumé and returns the columns to save on the candidate. */
export async function uploadResume(candidateId: string, file: File) {
  const type = docMimeType(file.name)
  if (!type) throw new Error(`${file.name}: only PDF, PNG, JPEG and Word files can be added.`)
  const path = `${candidateId}/${crypto.randomUUID()}.${file.name.split('.').pop()!.toLowerCase()}`
  const { error } = await supabase.storage.from(RESUME_BUCKET).upload(path, file, { contentType: type })
  if (error) throw new Error(`Couldn't upload ${file.name}: ${error.message}`)
  return { resume_path: path, resume_name: file.name.slice(0, 200), resume_type: type, resume_size: file.size }
}

export async function removeResumeFile(path: string) {
  await supabase.storage.from(RESUME_BUCKET).remove([path])
}

/** Opens a résumé in a new tab (Word files download). */
export async function openResume(c: Pick<Candidate, 'resume_path' | 'resume_name' | 'resume_type'>) {
  if (!c.resume_path) return 'No résumé'
  const tab = window.open('', '_blank')   // opened now so pop-up blockers allow it
  const isWord = !!c.resume_type?.includes('word')
  const { data, error } = await supabase.storage.from(RESUME_BUCKET)
    .createSignedUrl(c.resume_path, 60 * 10, isWord ? { download: c.resume_name ?? 'resume' } : undefined)
  if (error || !data) { tab?.close(); return error?.message ?? 'Résumé not found' }
  if (tab) tab.location.href = data.signedUrl
  else window.location.href = data.signedUrl
  return null
}

/** After hiring: the résumé becomes one of the new employee's documents ("Other"). */
export async function copyResumeToEmployee(c: Candidate, employeeId: string) {
  if (!c.resume_path) return
  const { data, error } = await supabase.storage.from(RESUME_BUCKET).download(c.resume_path)
  if (error || !data) throw new Error(`The résumé couldn't be copied to their documents: ${error?.message ?? 'not found'}`)
  const name = c.resume_name ?? `resume.${c.resume_path.split('.').pop()}`
  await uploadEmployeeDocument(employeeId, 'Other', new File([data], name, { type: c.resume_type ?? data.type }))
}

/** "today", "3 days", "2 weeks" */
export function ageLabel(since: string) {
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 60) return `${Math.floor(days / 7)} weeks`
  return `${Math.floor(days / 30)} months`
}
