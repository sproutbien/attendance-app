import { Link } from 'react-router-dom'
import { ScrollText } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLeavePolicy } from '../hooks/useLeavePolicy'
import { useOnboarding } from '../hooks/useOnboarding'

/**
 * Employee Dashboard: a published leave policy they haven't read yet.
 * Hidden while their onboarding checklist already has an open "read the policy" step.
 */
export default function PolicyUpdateNotice() {
  const { employee } = useAuth()
  const p = useLeavePolicy(employee?.id)
  const onboarding = useOnboarding(employee?.id)
  const stepOpen = onboarding.tasks.some(t => t.action === 'leave_policy' && !t.done_at)
  if (!p.needsAck || onboarding.loading || stepOpen) return null

  return (
    <div className="sb-card" style={{ marginBottom: '1.25rem', flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px solid color-mix(in srgb, var(--amber, #c27a0e) 40%, transparent)' }}>
      <ScrollText size={22} style={{ color: 'var(--amber, #c27a0e)', flexShrink: 0 }} />
      <span style={{ flex: '1 1 220px', fontSize: 14, color: 'var(--text-strong, #10261a)' }}>
        <b>{p.readBefore ? 'The leave policy has been updated.' : 'Please read the leave policy.'}</b>{' '}
        <span style={{ color: 'var(--text-muted, #5b6f61)' }}>It takes a couple of minutes; press “I’ve read it” at the end.</span>
      </span>
      <Link to="/leave-policy" className="sb-btn-primary" style={{ textDecoration: 'none', minHeight: 40, display: 'inline-flex', alignItems: 'center' }}>Read it</Link>
    </div>
  )
}
