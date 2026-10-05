import { supabase } from './supabase'
import { localDate } from './calendar'
import type { Employee } from '../types'

export const SELFIE_BUCKET = 'checkin-selfies'
export const SELFIE_KEEP_DAYS = 15
const SELFIE_SIZE = 480   // square, px

export type SelfieRule = Employee['selfie_rule']

export const SELFIE_RULE_LABELS: Record<SelfieRule, string> = {
  default: 'Company setting',
  always:  'Always ask',
  never:   'Never ask',
}

/** What the employee chose at check-in: a photo, or why there isn't one. */
export type SelfieResult = { blob: Blob } | { missingReason: string }

export async function selfieRequired(employeeId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('selfie_required', { p_employee: employeeId })
  if (error) return false   // the server still checks at check-in
  return !!data
}

/** Square crop of the current video frame, mirrored like the preview. */
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const side = Math.min(video.videoWidth, video.videoHeight)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SELFIE_SIZE
  const ctx = canvas.getContext('2d')!
  ctx.translate(SELFIE_SIZE, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, SELFIE_SIZE, SELFIE_SIZE)
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("Couldn't take the photo")), 'image/jpeg', 0.82))
}

/** Why the camera couldn't open, in plain words (also saved as the reason). */
export function cameraErrorText(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was blocked'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found'
  if (name === 'NotReadableError' || name === 'AbortError') return 'Camera is in use by another app'
  return 'Camera could not be opened'
}

export async function uploadSelfie(employeeId: string, blob: Blob): Promise<string> {
  const path = `${employeeId}/${localDate()}-${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(SELFIE_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(`Couldn't upload the selfie: ${error.message}`)
  return path
}

export async function removeSelfie(path: string) {
  await supabase.storage.from(SELFIE_BUCKET).remove([path])
}

/** Signed URLs by path (paths that fail are left out). */
export async function selfieUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data } = await supabase.storage.from(SELFIE_BUCKET).createSignedUrls(paths, 60 * 60)
  const out: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  return out
}

/** Selfies older than this are deleted; the date is the attendance date. */
export function selfieExpired(date: string) {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + SELFIE_KEEP_DAYS)
  return localDate(d) <= localDate()
}

/**
 * Deletes selfies past 15 days. Storage files can only be deleted through the
 * Storage API, so the app does it when someone opens it — at most twice a day
 * per browser. Admins clear everyone's, employees their own.
 */
export async function sweepExpiredSelfies() {
  const KEY = 'sb.selfieSweepAt'
  try {
    const last = Number(localStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 12 * 60 * 60 * 1000) return
    localStorage.setItem(KEY, String(Date.now()))
  } catch { /* storage blocked: sweep anyway */ }
  const { data, error } = await supabase.rpc('expired_checkin_selfies')
  if (error || !data?.length) return
  await supabase.storage.from(SELFIE_BUCKET).remove(data as string[])
}
