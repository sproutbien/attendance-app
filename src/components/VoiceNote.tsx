import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, SyntheticEvent } from 'react'
import { Mic, Square, Trash2, Play } from 'lucide-react'
import { VOICE_NOTE_MAX_SECONDS, canRecordAudio, fmtSeconds, recordingMimeType, voiceNoteUrl } from '../lib/voiceNotes'
import type { VoiceNote } from '../lib/voiceNotes'

/**
 * Chrome's recordings don't store their length, so the player shows no timeline until
 * it has played once. Seeking far past the end makes the browser work it out.
 */
function loadDuration(audio: HTMLAudioElement, then?: () => void) {
  if (audio.duration !== Infinity) { then?.(); return }
  audio.addEventListener('timeupdate', function reset() {
    audio.removeEventListener('timeupdate', reset)
    audio.currentTime = 0
    then?.()
  })
  audio.currentTime = 1e101
}

type RecorderProps = {
  value: VoiceNote | null
  onChange: (note: VoiceNote | null) => void
  /** True while the microphone is live, so the form can hold off submitting. */
  onRecordingChange?: (recording: boolean) => void
}

export function VoiceNoteRecorder({ value, onChange, onRecordingChange }: RecorderProps) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const discardRef = useRef(false)

  useEffect(() => {
    if (!value) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(value.blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [value])

  // Release the microphone if they leave the page mid-recording
  useEffect(() => () => {
    discardRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (timerRef.current) window.clearInterval(timerRef.current)
  }, [])

  function setLive(live: boolean) {
    setRecording(live)
    onRecordingChange?.(live)
  }

  async function start() {
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setError((e as DOMException).name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in your browser’s site settings to record.'
        : 'No microphone found.')
      return
    }
    const mimeType = recordingMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    const startedAt = Date.now()
    discardRef.current = false

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
      streamRef.current = null
      recorderRef.current = null
      setLive(false)
      if (discardRef.current || chunks.length === 0) return
      const seconds = Math.min((Date.now() - startedAt) / 1000, VOICE_NOTE_MAX_SECONDS)
      onChange({ blob: new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }), seconds })
    }

    recorder.start()
    recorderRef.current = recorder
    streamRef.current = stream
    setElapsed(0)
    setLive(true)
    timerRef.current = window.setInterval(() => {
      const secs = (Date.now() - startedAt) / 1000
      setElapsed(secs)
      if (secs >= VOICE_NOTE_MAX_SECONDS) stop()
    }, 250)
  }

  function stop(discard = false) {
    discardRef.current = discard
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  if (!canRecordAudio()) {
    return <p style={hint}>Voice notes aren’t supported in this browser.</p>
  }

  return (
    <div>
      {recording ? (
        <div style={{ ...panel, borderColor: 'var(--red, #b91c1c)' }}>
          <span className="sb-rec-dot" aria-hidden="true" />
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.875rem', color: 'var(--text-strong, #1e293b)', fontWeight: 600 }}>
            {fmtSeconds(elapsed)}
            <span style={{ color: 'var(--text-faint, #94a3b8)', fontWeight: 400 }}> / {fmtSeconds(VOICE_NOTE_MAX_SECONDS)}</span>
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => stop(true)} style={ghostBtn}>Discard</button>
          <button type="button" onClick={() => stop()} style={{ ...ghostBtn, color: 'var(--red, #b91c1c)', borderColor: 'var(--red, #b91c1c)' }}>
            <Square size={12} fill="currentColor" /> Stop
          </button>
        </div>
      ) : value && previewUrl ? (
        <div style={panel}>
          <audio
            src={previewUrl}
            controls
            preload="metadata"
            onLoadedMetadata={(e: SyntheticEvent<HTMLAudioElement>) => loadDuration(e.currentTarget)}
            style={{ flex: 1, minWidth: 0, height: 36 }}
          />
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted, #64748b)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtSeconds(value.seconds)}
          </span>
          <button type="button" onClick={() => onChange(null)} style={ghostBtn} aria-label="Delete voice note" title="Delete and record again">
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={start} style={ghostBtn}>
          <Mic size={14} /> Record voice note
        </button>
      )}
      {error
        ? <p style={{ ...hint, color: 'var(--red, #b91c1c)' }}>{error}</p>
        : !recording && !value && <p style={hint}>Optional · up to {VOICE_NOTE_MAX_SECONDS / 60} minutes</p>}
    </div>
  )
}

/** Loads the recording only when someone presses play. */
export function VoiceNotePlayer({ path, seconds }: { path: string; seconds: number | null }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setUrl(await voiceNoteUrl(path))
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  if (url) {
    return (
      <audio
        src={url}
        controls
        onLoadedMetadata={e => { const a = e.currentTarget; loadDuration(a, () => { a.play().catch(() => {}) }) }}
        style={{ display: 'block', width: '100%', maxWidth: 360, height: 36, marginTop: '0.375rem' }}
      />
    )
  }
  return (
    <div style={{ marginTop: '0.375rem' }}>
      <button type="button" onClick={load} disabled={loading} style={{ ...ghostBtn, padding: '0.25rem 0.625rem', fontSize: '0.8125rem' }}>
        <Play size={12} fill="currentColor" />
        {loading ? 'Loading…' : <>Voice note{seconds != null && ` · ${fmtSeconds(seconds)}`}</>}
      </button>
      {error && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--red, #b91c1c)' }}>{error}</span>}
    </div>
  )
}

const panel: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.625rem',
  padding: '0.5rem 0.625rem',
  border: '1px solid var(--border, #d1d5db)',
  borderRadius: 8,
}

const ghostBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.375rem',
  padding: '0.375rem 0.75rem',
  border: '1px solid var(--border, #d1d5db)',
  borderRadius: 8,
  background: 'var(--surface, #fff)',
  color: 'var(--text, #374151)',
  fontWeight: 600,
  fontSize: '0.8125rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const hint: CSSProperties = {
  margin: '0.375rem 0 0',
  fontSize: '0.75rem',
  color: 'var(--text-faint, #94a3b8)',
}
