import { supabase } from './supabase'

export const VOICE_NOTE_BUCKET = 'leave-voice-notes'
export const VOICE_NOTE_MAX_SECONDS = 120

export type VoiceNote = { blob: Blob; seconds: number }

/** First recording format this browser supports (Chrome/Firefox: webm/ogg, Safari: mp4). */
export function recordingMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    .find(t => MediaRecorder.isTypeSupported(t))
}

export function canRecordAudio() {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/** "0:42" */
export function fmtSeconds(total: number) {
  const s = Math.max(0, Math.round(total))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Uploads into the employee's own folder; returns the object path. */
export async function uploadVoiceNote(employeeId: string, note: VoiceNote): Promise<string> {
  const contentType = note.blob.type.split(';')[0] || 'audio/webm'
  const ext = contentType === 'audio/mp4' ? 'm4a' : contentType.split('/')[1]
  const path = `${employeeId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(VOICE_NOTE_BUCKET).upload(path, note.blob, { contentType })
  if (error) throw new Error(`Couldn't upload the voice note: ${error.message}`)
  return path
}

export async function voiceNoteUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(VOICE_NOTE_BUCKET).createSignedUrl(path, 60 * 60)
  if (error || !data) throw new Error(error?.message ?? 'Voice note not found')
  return data.signedUrl
}
