import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Camera, MapPin, Settings2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { SelfieSetting } from './SelfieAdmin'
import { GeofenceSetting } from './GeofenceAdmin'

export type CheckInRuleState = { selfie: boolean; location: boolean }

/** Company-wide check-in rules, for the header chips and showing the table columns. */
export function useCheckInRules() {
  const [rules, setRules] = useState<CheckInRuleState | null>(null)
  useEffect(() => {
    supabase.from('attendance_settings').select('selfie_required, geofence_required').maybeSingle()
      .then(({ data }) => setRules({ selfie: !!data?.selfie_required, location: !!data?.geofence_required }))
  }, [])
  return [rules, setRules] as const
}

/** Header button showing which rules are on; opens the settings drawer. */
export function CheckInRulesButton({ rules, onClick }: { rules: CheckInRuleState | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Check-in rules" style={buttonStyle}>
      <Settings2 size={15} />
      <span>Check-in rules</span>
      {rules && (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <Chip on={rules.selfie} label="Selfie"><Camera size={12} /></Chip>
          <Chip on={rules.location} label="Location check"><MapPin size={12} /></Chip>
        </span>
      )}
    </button>
  )
}

function Chip({ on, label, children }: { on: boolean; label: string; children: React.ReactNode }) {
  return (
    <span
      title={`${label}: ${on ? 'on' : 'off'}`}
      aria-label={`${label} ${on ? 'on' : 'off'}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 99,
        fontSize: '0.6875rem', fontWeight: 600,
        background: on ? 'var(--brand-100)' : '#f1f5f9', color: on ? 'var(--brand-800)' : '#94a3b8',
      }}
    >
      {children}{on ? 'On' : 'Off'}
    </span>
  )
}

/** Side drawer holding the Selfie and Location check settings. */
export function CheckInRulesDrawer({ onChange, onClose }: {
  onChange: (changes: Partial<CheckInRuleState>) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave Escape to the office-area dialog when it is open on top
      if (e.key === 'Escape' && document.querySelectorAll('[role="dialog"]').length <= 1) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={backdropStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <aside role="dialog" aria-modal="true" aria-labelledby="checkin-rules-title" style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h2 id="checkin-rules-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>Check-in rules</h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>Apply to everyone. Changes take effect at the next check-in.</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <SelfieSetting onChange={selfie => onChange({ selfie })} />
          <GeofenceSetting onChange={location => onChange({ location })} />
        </div>
      </aside>
    </div>
  )
}

const buttonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.3125rem 0.625rem', height: 32, boxSizing: 'border-box',
  borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer',
  fontSize: '0.8125rem', fontWeight: 500, color: '#374151', whiteSpace: 'nowrap',
}

const backdropStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,0.4)', display: 'flex', justifyContent: 'flex-end',
}

const panelStyle: CSSProperties = {
  width: 'min(480px, 100vw)', height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: '1.5rem',
  background: '#f8fafc', boxShadow: '-8px 0 30px rgba(0,0,0,0.12)',
}
