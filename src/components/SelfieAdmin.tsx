import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Camera } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { photoUrl } from '../lib/employees'
import { SELFIE_KEEP_DAYS, selfieExpired } from '../lib/selfies'
import { useAuth } from '../contexts/AuthContext'
import type { AttendanceRecord, Employee } from '../types'
import { overlayStyle, modalStyle, ghostBtn } from './employees/styles'

/** Company-wide "Selfie at check-in" switch (Attendance page). */
export function SelfieSetting() {
  const { employee } = useAuth()
  const [on, setOn] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('attendance_settings').select('selfie_required').maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setOn(!!data?.selfie_required)
      })
  }, [])

  async function toggle() {
    if (on === null) return
    setSaving(true)
    setError(null)
    const { data, error } = await supabase.from('attendance_settings')
      .update({ selfie_required: !on, updated_at: new Date().toISOString(), updated_by: employee?.id ?? null })
      .eq('id', true)
      .select('selfie_required')
    if (error) setError(error.message)
    else if (!data?.length) setError('The setting is missing in the database (migration 032).')
    else setOn(!on)
    setSaving(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '0.875rem 1.125rem', marginBottom: '1.5rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 10, background: on ? '#dcfce7' : '#f1f5f9', color: on ? '#166534' : '#64748b', flexShrink: 0 }}>
        <Camera size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9375rem' }}>Selfie at check-in</div>
        <div style={{ fontSize: '0.8125rem', color: error ? '#dc2626' : '#64748b' }}>
          {error ?? (on === null ? 'Loading…'
            : on ? `Employees take a selfie to check in. Selfies are deleted after ${SELFIE_KEEP_DAYS} days.`
            : 'Employees check in with one tap.')}
          {!error && on !== null && ' Exceptions per person: Employees → Edit.'}
        </div>
      </div>
      <button
        type="button" role="switch" aria-checked={!!on} aria-label="Selfie at check-in"
        onClick={toggle} disabled={on === null || saving}
        style={{
          position: 'relative', width: 46, height: 26, flexShrink: 0, padding: 0, border: 'none', borderRadius: 99,
          background: on ? '#16a34a' : '#cbd5e1', cursor: on === null || saving ? 'default' : 'pointer',
          opacity: saving ? 0.6 : 1, transition: 'background 0.15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left 0.15s',
        }} />
      </button>
    </div>
  )
}

/** Table cell: selfie thumbnail, "No selfie" flag, or nothing. */
export function SelfieCell({ record, url, onOpen }: {
  record: AttendanceRecord | null
  url: string | undefined
  onOpen: () => void
}) {
  if (!record?.check_in_time) return <span style={{ color: '#cbd5e1' }}>—</span>
  if (record.selfie_path) {
    if (selfieExpired(record.date)) return <span style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>Deleted</span>
    return (
      <button type="button" onClick={onOpen} title="View selfie" style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'block' }}>
        {url
          ? <img src={url} alt="Check-in selfie" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', display: 'block' }} />
          : <span style={{ display: 'block', width: 36, height: 36, borderRadius: 8, background: '#f1f5f9' }} />}
      </button>
    )
  }
  if (record.selfie_missing_reason) {
    return (
      <button type="button" onClick={onOpen} title={record.selfie_missing_reason}
        style={{ padding: '1px 8px', border: 'none', borderRadius: 99, background: '#fef3c7', color: '#92400e', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        No selfie
      </button>
    )
  }
  return <span style={{ color: '#cbd5e1' }}>—</span>
}

/** Selfie next to the profile photo, for comparing by eye. */
export function SelfieReview({ employee, record, url, onClose }: {
  employee: Pick<Employee, 'full_name' | 'photo_path'>
  record: AttendanceRecord
  url: string | undefined
  onClose: () => void
}) {
  const profile = photoUrl(employee)
  const time = record.check_in_time
    ? new Date(record.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''
  const date = new Date(record.date + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="selfie-review-title" style={{ ...modalStyle, maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <h2 id="selfie-review-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>{employee.full_name}</h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>Checked in {date}, {time}</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          <Figure label="Check-in selfie">
            {record.selfie_path && url
              ? <img src={url} alt="Check-in selfie" style={imgStyle} />
              : <Empty>{record.selfie_missing_reason
                  ? <><b style={{ color: '#92400e' }}>No selfie</b><br />{record.selfie_missing_reason}</>
                  : 'Couldn’t load the selfie.'}</Empty>}
          </Figure>
          <Figure label="Profile photo">
            {profile ? <img src={profile} alt="Profile" style={imgStyle} /> : <Empty>No profile photo yet</Empty>}
          </Figure>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button type="button" onClick={onClose} style={{ ...ghostBtn, padding: '0.5rem 1.125rem' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure style={{ margin: 0 }}>
      {children}
      <figcaption style={{ marginTop: '0.375rem', fontSize: '0.8125rem', color: '#64748b', textAlign: 'center' }}>{label}</figcaption>
    </figure>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...imgStyle, display: 'grid', placeItems: 'center', padding: '1rem', background: '#f8fafc', color: '#64748b', fontSize: '0.875rem', textAlign: 'center' }}>
      <div>{children}</div>
    </div>
  )
}

const imgStyle: CSSProperties = {
  width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', borderRadius: 12, boxSizing: 'border-box',
}
