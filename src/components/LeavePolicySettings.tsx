import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useLeavePolicyAdmin } from '../hooks/useLeavePolicy'
import { supabase } from '../lib/supabase'
import { TRACKED_STATUSES, fmtDate } from '../lib/employees'

/** Admin: the leave policy's additional rules, publishing an update, and who has read it. */
export default function LeavePolicySettings() {
  const { policy, readBy, loading, save } = useLeavePolicyAdmin()
  const [rules, setRules] = useState<string | null>(null)   // null = not edited
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([])
  const [showUnread, setShowUnread] = useState(false)

  useEffect(() => {
    supabase.from('employees').select('id, full_name').in('status', TRACKED_STATUSES).is('deleted_at', null).order('full_name')
      .then(({ data }) => setStaff(data ?? []))
  }, [])

  const text = rules ?? policy?.additional_rules ?? ''
  const dirty = rules !== null && rules !== (policy?.additional_rules ?? '')
  const unread = staff.filter(s => !readBy.has(s.id))
  const published = (policy?.version ?? 0) > 0

  async function run(publish: boolean) {
    setBusy(true)
    const err = await save(text, publish)
    setBusy(false)
    if (err) return setStatus(err)
    setRules(null)
    setStatus(publish ? 'Published. Everyone will be asked to read the policy.' : 'Saved.')
  }

  return (
    <div style={{ ...card, marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.375rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>Leave policy</h2>
        <a href="/leave-policy" target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--brand-700)', fontWeight: 600 }}>Preview what employees see ↗</a>
      </div>
      <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#64748b', lineHeight: 1.5 }}>
        The policy page is built from the settings above, your holidays and each person’s shift, so it’s always up to date.
        Add anything the app doesn’t enforce below. When you make an important change, publish it so everyone is asked to read it again.
      </p>

      {loading ? <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p> : (
        <>
          <label htmlFor="policy-rules" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 6 }}>Additional rules</label>
          <textarea
            id="policy-rules" value={text} rows={5} maxLength={5000}
            onChange={e => { setRules(e.target.value); setStatus(null) }}
            placeholder={'e.g. Inform your manager on WhatsApp before 9 AM if you are taking sick leave.\nEarned leave needs 7 days’ notice.'}
            style={{ width: '100%', boxSizing: 'border-box', padding: '0.625rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.875rem', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.75rem' }}>
            <button onClick={() => run(true)} disabled={busy} style={btn}>
              {published ? 'Publish update and ask everyone to read it' : 'Publish and ask everyone to read it'}
            </button>
            {dirty && <button onClick={() => run(false)} disabled={busy} style={ghost}>Save without asking</button>}
            {status && <span style={{ fontSize: '0.8125rem', color: status.endsWith('.') && !status.includes('rror') ? '#166534' : '#dc2626' }}>{status}</span>}
          </div>

          <div style={{ marginTop: '1rem', paddingTop: '0.875rem', borderTop: '1px solid #e2e8f0', fontSize: '0.875rem', color: '#475569' }}>
            {published ? (
              <>
                Version {policy!.version}, published {fmtDate(new Date(policy!.published_at!))}:
                <b style={{ color: unread.length ? '#b45309' : '#166534' }}> {staff.length - unread.length} of {staff.length} have read it</b>.
                {unread.length > 0 && (
                  <button onClick={() => setShowUnread(s => !s)} style={link}>{showUnread ? 'Hide' : 'Who hasn’t?'}</button>
                )}
                {showUnread && unread.length > 0 && (
                  <p style={{ margin: '0.5rem 0 0', color: '#64748b' }}>{unread.map(u => u.full_name).join(', ')}</p>
                )}
              </>
            ) : (
              <>Not published yet. Employees can already open it from their Leaves page; publishing asks everyone to read it and confirm.</>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const btn: CSSProperties = { padding: '0.5rem 1rem', borderRadius: 8, border: 'none', background: 'var(--brand-600)', color: '#fff', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit' }
const ghost: CSSProperties = { ...btn, background: '#fff', color: '#374151', border: '1px solid #d1d5db' }
const link: CSSProperties = { marginLeft: 8, padding: 0, border: 'none', background: 'none', color: 'var(--brand-700)', textDecoration: 'underline', cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit' }
