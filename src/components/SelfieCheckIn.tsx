import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, X } from 'lucide-react'
import type { AttendanceRecord } from '../types'
import {
  SELFIE_KEEP_DAYS, cameraErrorText, captureFrame, removeSelfie, uploadSelfie,
} from '../lib/selfies'

type Phase = 'starting' | 'live' | 'shot' | 'failed' | 'saving'

/**
 * Check-in with a selfie from the camera. If the camera can't be used the
 * employee can still check in; the reason is saved so the admin sees the day
 * flagged "No selfie".
 */
export default function SelfieCheckIn({ employeeId, onCheckIn, onClose }: {
  employeeId: string
  onCheckIn: (selfie: { selfie_path: string } | { selfie_missing_reason: string }) =>
    Promise<{ record: AttendanceRecord | null; error: string | null }>
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [phase, setPhase] = useState<Phase>('starting')
  const [ready, setReady] = useState(false)
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)   // why there's no selfie
  const [askedByUser, setAskedByUser] = useState(false)          // "Camera not working?" rather than a detected failure
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  function stopCamera() {
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = null
    setReady(false)
  }

  async function startCamera() {
    stopCamera()
    setPhase('starting')
    setError(null)
    setAskedByUser(false)
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem("This browser can't open the camera")
      setPhase('failed')
      return
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      })
      stream.current = s
      setPhase('live')
      if (video.current) {
        video.current.srcObject = s
        await video.current.play().catch(() => {})
      }
    } catch (e) {
      setProblem(cameraErrorText(e))
      setPhase('failed')
    }
  }

  useEffect(() => {
    startCamera()
    return stopCamera
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // The <video> mounts with the 'live' phase, after the stream arrives
  useEffect(() => {
    if (phase === 'live' && video.current && stream.current && video.current.srcObject !== stream.current) {
      video.current.srcObject = stream.current
      video.current.play().catch(() => {})
    }
  }, [phase])

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])

  async function takePhoto() {
    if (!video.current) return
    try {
      const blob = await captureFrame(video.current)
      setShot({ blob, url: URL.createObjectURL(blob) })
      stopCamera()
      setPhase('shot')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function cameraNotWorking() {
    stopCamera()
    setProblem('Employee said the camera wasn’t working')
    setAskedByUser(true)
    setPhase('failed')
  }

  async function checkInWithSelfie() {
    if (!shot) return
    setPhase('saving')
    setError(null)
    let path: string
    try {
      path = await uploadSelfie(employeeId, shot.blob)
    } catch (e) {
      setError((e as Error).message)
      setPhase('shot')
      return
    }
    const { record, error } = await onCheckIn({ selfie_path: path })
    // Not used (failed, or already checked in from another tab): don't leave it behind
    if (error || record?.selfie_path !== path) removeSelfie(path)
    if (error) {
      setError(error)
      setPhase('shot')
      return
    }
    onClose()
  }

  async function checkInWithout() {
    const reason = [problem, note.trim()].filter(Boolean).join(' — ').slice(0, 300)
    setPhase('saving')
    setError(null)
    const { error } = await onCheckIn({ selfie_missing_reason: reason })
    if (error) {
      setError(error)
      setPhase('failed')
      return
    }
    onClose()
  }

  const saving = phase === 'saving'
  const withoutSelfie = phase === 'failed' || (saving && !shot)

  return (
    <div className="sb-modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="sb-modal sb-selfie" role="dialog" aria-modal="true" aria-labelledby="selfie-title" onClick={e => e.stopPropagation()}>
        <div className="sb-modal-head">
          <h2 id="selfie-title">{withoutSelfie ? 'Check in without a selfie' : 'Selfie to check in'}</h2>
          <button type="button" className="sb-modal-close" onClick={onClose} disabled={saving} aria-label="Close"><X size={20} /></button>
        </div>

        {withoutSelfie ? (
          <>
            <p className="sb-modal-sub">
              {askedByUser ? '' : <>We couldn’t open your camera: <b>{problem}</b>. </>}
              You can still check in. Your admin will see that today’s check-in has no selfie.
            </p>
            <label className="sb-modal-field">
              {askedByUser ? 'What’s wrong with the camera?' : 'Anything to add? (optional)'}
              <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={200} rows={2}
                placeholder={askedByUser ? 'e.g. The picture is black' : 'e.g. Using an office PC without a camera'} />
            </label>
            {error && <p className="sb-modal-error">{error}</p>}
            <div className="sb-modal-actions">
              <button type="button" className="sb-btn-ghost" onClick={startCamera} disabled={saving}>Try camera again</button>
              <button type="button" className="sb-btn-primary" onClick={checkInWithout}
                disabled={saving || (askedByUser && note.trim().length < 3)}>
                {saving ? 'Checking in…' : 'Check In'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sb-modal-sub">Face the camera in good light, then take the photo.</p>
            <div className="sb-selfie-frame">
              {(phase === 'shot' || saving) && shot
                ? <img src={shot.url} alt="Your selfie" />
                : <video ref={video} autoPlay playsInline muted onCanPlay={() => setReady(true)} />}
              {phase === 'starting' && <span className="sb-selfie-wait">Opening camera…</span>}
            </div>
            {error && <p className="sb-modal-error">{error}</p>}
            <div className="sb-modal-actions">
              {phase === 'live' || phase === 'starting' ? (
                <button type="button" className="sb-btn-primary sb-selfie-snap" onClick={takePhoto} disabled={!ready}>
                  <Camera size={18} /> Take photo
                </button>
              ) : (
                <>
                  <button type="button" className="sb-btn-ghost sb-selfie-snap" onClick={() => { setShot(null); startCamera() }} disabled={saving}>
                    <RefreshCw size={16} /> Retake
                  </button>
                  <button type="button" className="sb-btn-primary" onClick={checkInWithSelfie} disabled={saving}>
                    {saving ? 'Checking in…' : 'Check In'}
                  </button>
                </>
              )}
            </div>
            {(phase === 'live' || phase === 'starting') && (
              <button type="button" className="sb-selfie-link" onClick={cameraNotWorking}>Camera not working?</button>
            )}
          </>
        )}

        {!withoutSelfie && (
          <p className="sb-selfie-privacy">
            Only you and your admins can see it. It’s deleted automatically after {SELFIE_KEEP_DAYS} days.
          </p>
        )}
      </div>
    </div>
  )
}
