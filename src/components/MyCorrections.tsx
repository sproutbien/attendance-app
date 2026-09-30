import { useState } from 'react'
import { ClipboardPen } from 'lucide-react'
import type { AttendanceCorrection } from '../types'
import { CORRECTION_WINDOW_DAYS, fmtClockTime } from '../lib/corrections'

const STATUS: Record<AttendanceCorrection['status'], { label: string; cls: string }> = {
  pending:  { label: 'Pending',  cls: 's-late' },
  approved: { label: 'Approved', cls: 's-present' },
  rejected: { label: 'Rejected', cls: 's-absent' },
}

function fmtDay(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The employee's recent correction requests, below the monthly log. */
export default function MyCorrections({ corrections, onWithdraw }: {
  corrections: AttendanceCorrection[]
  onWithdraw: (id: string) => Promise<string | null>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (corrections.length === 0) return null

  async function withdraw(id: string) {
    setBusy(id)
    setError(null)
    const err = await onWithdraw(id)
    if (err) setError(err)
    setBusy(null)
  }

  return (
    <section className="sb-log sb-corrections">
      <div className="sb-log-head">
        <ClipboardPen size={20} strokeWidth={2} />
        <h2>Correction Requests</h2>
      </div>
      {error && <p className="sb-error">{error}</p>}
      <ul className="sb-corr-list">
        {corrections.map(c => {
          const s = STATUS[c.status]
          const finalIn = c.status === 'approved' ? c.approved_check_in : c.requested_check_in ?? c.original_check_in
          const finalOut = c.status === 'approved' ? c.approved_check_out : c.requested_check_out ?? c.original_check_out
          const adjusted = c.status === 'approved' && (
            (c.requested_check_in != null && c.requested_check_in !== c.approved_check_in) ||
            (c.requested_check_out != null && c.requested_check_out !== c.approved_check_out)
          )
          return (
            <li key={c.id}>
              <div className="sb-corr-main">
                <strong>{fmtDay(c.date)}</strong>
                <span className="sb-corr-times">
                  {fmtClockTime(c.original_check_in)} – {fmtClockTime(c.original_check_out)}
                  {' → '}
                  <b>{fmtClockTime(finalIn)} – {fmtClockTime(finalOut)}</b>
                  {adjusted && <em> (adjusted by admin)</em>}
                </span>
                <span className="sb-corr-reason">{c.reason}</span>
                {c.admin_note && <span className="sb-corr-note">Admin: {c.admin_note}</span>}
              </div>
              <div className="sb-corr-side">
                <span className={`sb-status ${s.cls}`}><i />{s.label}</span>
                {c.status === 'pending' && (
                  <button type="button" className="sb-link-btn" onClick={() => withdraw(c.id)} disabled={busy === c.id}>
                    {busy === c.id ? 'Withdrawing…' : 'Withdraw'}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="sb-corr-foot">Corrections can be requested for the last {CORRECTION_WINDOW_DAYS} days from your log above.</p>
    </section>
  )
}
