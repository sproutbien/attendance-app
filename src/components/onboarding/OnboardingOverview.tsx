import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { fmtDate } from '../../lib/employees'
import { daysUntil, notStartedYet, probationDue, relativeDays } from '../../lib/onboarding'
import EmployeeAvatar from '../employees/EmployeeAvatar'
import { card, ghostBtn, primaryBtn } from '../employees/styles'
import type { Employee } from '../../types'

/**
 * Admin, Employees page: people still onboarding and probations ending within two weeks.
 * Renders nothing when there's neither.
 */
export default function OnboardingOverview({ employees, progress, onConfirm }: {
  employees: Employee[]                                     // current staff
  progress: Map<string, { done: number; total: number }>
  onConfirm: (e: Employee) => Promise<string | null>
}) {
  const onboarding = employees
    .filter(e => { const p = progress.get(e.id); return p && p.done < p.total })
    .sort((a, b) => (a.joining_date ?? '').localeCompare(b.joining_date ?? ''))
  const probation = employees
    .filter(e => probationDue(e))
    .sort((a, b) => a.probation_end_date!.localeCompare(b.probation_end_date!))
  if (!onboarding.length && !probation.length) return null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
      {onboarding.length > 0 && (
        <section style={card}>
          <h2 style={heading}>Onboarding</h2>
          {onboarding.map(e => {
            const p = progress.get(e.id)!
            return (
              <Link key={e.id} to={`/admin/employees/${e.id}`} style={row}>
                <EmployeeAvatar employee={e} size={30} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, color: '#1e293b' }}>{e.full_name}</span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {notStartedYet(e) ? `Joins ${fmtDate(e.joining_date!)}` : e.joining_date ? `Joined ${fmtDate(e.joining_date)}` : 'No joining date'}
                  </span>
                </span>
                <span style={{ width: 90 }}>
                  <span style={{ display: 'block', height: 6, borderRadius: 99, background: '#e2e8f0', overflow: 'hidden' }}>
                    <span style={{ display: 'block', width: `${(p.done / p.total) * 100}%`, height: '100%', background: 'var(--brand-600)' }} />
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{p.done} of {p.total} done</span>
                </span>
              </Link>
            )
          })}
        </section>
      )}
      {probation.length > 0 && (
        <section style={card}>
          <h2 style={heading}>Probation ending</h2>
          {probation.map(e => <ProbationRow key={e.id} employee={e} onConfirm={() => onConfirm(e)} />)}
        </section>
      )}
    </div>
  )
}

function ProbationRow({ employee: e, onConfirm }: { employee: Employee; onConfirm: () => Promise<string | null> }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const n = daysUntil(e.probation_end_date!)
  return (
    <div style={{ ...row, flexWrap: 'wrap' }}>
      <EmployeeAvatar employee={e} size={30} />
      <Link to={`/admin/employees/${e.id}`} style={{ flex: 1, minWidth: 0, textDecoration: 'none' }}>
        <span style={{ display: 'block', fontWeight: 600, color: '#1e293b' }}>{e.full_name}</span>
        <span style={{ fontSize: '0.75rem', color: n < 0 ? '#b45309' : '#64748b' }}>
          {n < 0 ? 'Ended' : 'Ends'} {fmtDate(e.probation_end_date!)} ({relativeDays(n)})
        </span>
      </Link>
      {asking ? (
        <span style={{ display: 'flex', gap: '0.375rem' }}>
          <button disabled={busy} onClick={async () => { setBusy(true); setError(await onConfirm()); setBusy(false); setAsking(false) }}
            style={{ ...primaryBtn, padding: '0.3125rem 0.75rem', fontSize: '0.8125rem' }}>Make Active</button>
          <button onClick={() => setAsking(false)} style={ghostBtn}>Cancel</button>
        </span>
      ) : (
        <button onClick={() => setAsking(true)} style={ghostBtn}>Confirm</button>
      )}
      {error && <span style={{ flexBasis: '100%', color: '#dc2626', fontSize: '0.75rem' }}>{error}</span>}
    </div>
  )
}

const heading: CSSProperties = { margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-600)', textTransform: 'uppercase', letterSpacing: '0.06em' }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', textDecoration: 'none', fontSize: '0.875rem' }
