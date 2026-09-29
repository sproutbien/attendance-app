import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { AttendanceRecord } from '../types'
import type { NewCorrection } from '../hooks/useCorrections'
import { fmtClockTime, fromTimeInput, toTimeInput } from '../lib/corrections'

function fmtLongDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

/** Employee form: ask for a corrected check-in and/or check-out time for one day. */
export default function CorrectionDialog({ date, record, onSubmit, onClose }: {
  date: string
  record: AttendanceRecord | undefined
  onSubmit: (c: NewCorrection) => Promise<string | null>
  onClose: () => void
}) {
  const origIn = toTimeInput(record?.check_in_time)
  const origOut = toTimeInput(record?.check_out_time)
  const [checkIn, setCheckIn] = useState(origIn)
  const [checkOut, setCheckOut] = useState(origOut)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const inChanged = checkIn !== origIn
    const outChanged = checkOut !== origOut
    if (!inChanged && !outChanged) return setError('Change the check-in or check-out time you want corrected.')
    if (!checkIn) return setError('A check-in time is needed.')
    if (checkOut && checkOut <= checkIn) return setError('Check-out must be after check-in.')
    if (outChanged && !checkOut) return setError('To correct the check-out, enter the time you left.')

    setBusy(true)
    const err = await onSubmit({
      date,
      requested_check_in: inChanged ? fromTimeInput(date, checkIn) : null,
      requested_check_out: outChanged ? fromTimeInput(date, checkOut) : null,
      reason: reason.trim(),
    })
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <div className="sb-modal-backdrop" onClick={onClose}>
      <div className="sb-modal" role="dialog" aria-modal="true" aria-labelledby="correction-title" onClick={e => e.stopPropagation()}>
        <div className="sb-modal-head">
          <h2 id="correction-title">Request a correction</h2>
          <button type="button" className="sb-modal-close" onClick={onClose} aria-label="Close"><X size={22} /></button>
        </div>
        <p className="sb-modal-sub">
          {fmtLongDate(date)} · recorded {fmtClockTime(record?.check_in_time)} – {fmtClockTime(record?.check_out_time)}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="sb-modal-grid">
            <label>
              Check-in
              <input type="time" value={checkIn} onChange={e => setCheckIn(e.target.value)} required />
            </label>
            <label>
              Check-out
              <input type="time" value={checkOut} onChange={e => setCheckOut(e.target.value)} />
            </label>
          </div>
          <label className="sb-modal-field">
            Reason
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              required
              rows={3}
              placeholder="e.g. Forgot to check out before leaving"
            />
          </label>

          {error && <p className="sb-modal-error">{error}</p>}

          <div className="sb-modal-actions">
            <button type="button" className="sb-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="sb-btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
