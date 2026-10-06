import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { LocateFixed, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useEmployeeOptions } from '../hooks/useEmployeeManagement'
import {
  DEFAULT_RADIUS_M, LOCATION_KEEP_DAYS, fmtDistance, mapLink, parseCoordinates, readLocation,
} from '../lib/geofence'
import type { AttendanceRecord, EmployeeOption } from '../types'
import { errorBox, ghostBtn, hintStyle, inputStyle, modalStyle, overlayStyle, primaryBtn } from './employees/styles'

/** Company-wide "Location check at check-in" switch, Strict option and office areas (migration 037). */
export function GeofenceSetting({ onChange }: { onChange?: (on: boolean) => void } = {}) {
  const { employee } = useAuth()
  const lists = useEmployeeOptions()
  const [settings, setSettings] = useState<{ geofence_required: boolean; geofence_strict: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EmployeeOption | null>(null)

  useEffect(() => {
    supabase.from('attendance_settings').select('geofence_required, geofence_strict').maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else if (data) setSettings(data)
      })
  }, [])

  async function save(changes: Partial<{ geofence_required: boolean; geofence_strict: boolean }>) {
    setSaving(true)
    setError(null)
    const { data, error } = await supabase.from('attendance_settings')
      .update({ ...changes, updated_at: new Date().toISOString(), updated_by: employee?.id ?? null })
      .eq('id', true)
      .select('geofence_required, geofence_strict')
    if (error) setError(error.message)
    else if (!data?.length) setError('The setting is missing in the database (migration 037).')
    else { setSettings(data[0]); onChange?.(data[0].geofence_required) }
    setSaving(false)
  }

  const on = !!settings?.geofence_required
  const locations = lists.byKind('work_location')
  const withArea = locations.filter(l => l.lat != null)

  return (
    <div style={{ padding: '0.875rem 1.125rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 10, background: on ? 'var(--brand-100)' : '#f1f5f9', color: on ? 'var(--brand-800)' : '#64748b', flexShrink: 0 }}>
          <MapPin size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9375rem' }}>Location check at check-in</div>
          <div style={{ fontSize: '0.8125rem', color: error ? '#dc2626' : '#64748b' }}>
            {error ?? (settings === null ? 'Loading…'
              : on
                ? `Employees at ${withArea.length ? withArea.map(l => l.name).join(', ') : 'a location with an office area'} share their location to check in. Exact locations are deleted after ${LOCATION_KEEP_DAYS} days.`
                : 'Off. Turn on to check that people are at their office when they check in.')}
            {!error && settings !== null && ' Exceptions per person: Employees → Edit.'}
          </div>
        </div>
        <button
          type="button" role="switch" aria-checked={on} aria-label="Location check at check-in"
          onClick={() => save({ geofence_required: !on })} disabled={settings === null || saving}
          style={switchStyle(on, settings === null || saving)}
        >
          <span style={knobStyle(on)} />
        </button>
      </div>

      {settings !== null && (on || withArea.length > 0) && (
        <div style={{ marginTop: '0.875rem', paddingTop: '0.875rem', borderTop: '1px solid #f1f5f9', display: 'grid', gap: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.875rem', color: '#374151', cursor: 'pointer' }}>
            <input type="checkbox" checked={settings.geofence_strict} disabled={saving}
              onChange={e => save({ geofence_strict: e.target.checked })}
              style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--brand-600)' }} />
            <span>
              <b>Strict:</b> don’t allow check-in when clearly outside the area or when the location can’t be read
              <span style={{ ...hintStyle, display: 'block' }}>
                Off: they can still check in, and you see a flag here. A rough reading (common on laptops) is never blocked; it shows as “Location unclear”.
              </span>
            </span>
          </label>

          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Office areas</div>
            {locations.length === 0 ? (
              <p style={{ ...hintStyle, margin: 0 }}>No work locations yet. Add them under Employees → Lists, then set an area here.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                {locations.map(l => (
                  <li key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.875rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{l.name}</div>
                      {l.lat != null && l.lng != null
                        ? <div style={{ color: '#475569', fontSize: '0.8125rem' }}>within {fmtDistance(l.radius_m!)} · <a href={mapLink(l.lat, l.lng)} target="_blank" rel="noreferrer" style={{ color: 'var(--brand-700)' }}>view on map</a></div>
                        : <div style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>No area: not checked</div>}
                    </div>
                    <button type="button" onClick={() => setEditing(l)} style={{ ...ghostBtn, flexShrink: 0 }}>
                      {l.lat != null ? 'Edit area' : 'Set area'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {editing && (
        <AreaModal
          location={editing}
          onSave={async area => { const err = await lists.setArea(editing.id, area); if (!err) setEditing(null); return err }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function AreaModal({ location, onSave, onClose }: {
  location: EmployeeOption
  onSave: (area: { lat: number; lng: number; radius_m: number } | null) => Promise<string | null>
  onClose: () => void
}) {
  const [coords, setCoords] = useState(location.lat != null ? `${location.lat}, ${location.lng}` : '')
  const [radius, setRadius] = useState(String(location.radius_m ?? DEFAULT_RADIUS_M))
  const [busy, setBusy] = useState<'' | 'locating' | 'saving'>('')
  const [error, setError] = useState<string | null>(null)
  const parsed = parseCoordinates(coords)

  async function useHere() {
    setBusy('locating')
    setError(null)
    const r = await readLocation()
    setBusy('')
    if ('geofence_note' in r) { setError(`${r.geofence_note}.`); return }
    setCoords(`${r.check_in_lat.toFixed(6)}, ${r.check_in_lng.toFixed(6)}`)
    if (r.check_in_accuracy_m > 100) setError(`This reading is only accurate to about ${fmtDistance(r.check_in_accuracy_m)}. On a laptop, pasting the office’s coordinates from Google Maps is more precise.`)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const r = Number(radius)
    if (!parsed) { setError('Enter coordinates like 8.5581, 76.8816.'); return }
    if (!(r >= 25 && r <= 5000)) { setError('Use a radius between 25 and 5000 metres.'); return }
    setBusy('saving')
    setError(await onSave({ lat: parsed.lat, lng: parsed.lng, radius_m: Math.round(r) }))
    setBusy('')
  }

  async function remove() {
    setBusy('saving')
    setError(await onSave(null))
    setBusy('')
  }

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <form role="dialog" aria-modal="true" aria-labelledby="area-title" onSubmit={save} style={{ ...modalStyle, maxWidth: 460 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 id="area-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>Office area: {location.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>
        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#64748b' }}>
          Employees whose work location is {location.name} must be within this distance of the point when they check in.
        </p>

        <label htmlFor="area-coords" style={labelStyle}>Office location</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input id="area-coords" value={coords} onChange={e => setCoords(e.target.value)} placeholder="8.5581, 76.8816" spellCheck={false} style={inputStyle} />
          <button type="button" onClick={useHere} disabled={!!busy} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <LocateFixed size={14} /> {busy === 'locating' ? 'Finding…' : 'I’m here'}
          </button>
        </div>
        <p style={hintStyle}>
          In Google Maps, right-click the office and click the numbers at the top to copy them, then paste here. Or press “I’m here” while at the office on your phone.
          {parsed && <> <a href={mapLink(parsed.lat, parsed.lng)} target="_blank" rel="noreferrer" style={{ color: 'var(--brand-700)' }}>Check on Google Maps</a></>}
        </p>

        <label htmlFor="area-radius" style={{ ...labelStyle, marginTop: '0.875rem' }}>Radius (metres)</label>
        <input id="area-radius" type="number" min={25} max={5000} step={25} value={radius} onChange={e => setRadius(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        <p style={hintStyle}>200 m suits most offices. Use more for a large campus such as a tech park.</p>

        {error && <div style={{ ...errorBox, marginTop: '1rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
          {location.lat != null && (
            <button type="button" onClick={remove} disabled={!!busy} style={{ ...ghostBtn, color: '#b91c1c', marginRight: 'auto' }}>Remove area</button>
          )}
          <button type="button" onClick={onClose} disabled={!!busy} style={{ ...ghostBtn, marginLeft: location.lat != null ? undefined : 'auto', padding: '0.5rem 1rem' }}>Cancel</button>
          <button type="submit" disabled={!!busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy === 'saving' ? 'Saving…' : 'Save area'}</button>
        </div>
      </form>
    </div>
  )
}

/** Table cell: where they checked in from. */
export function LocationCell({ record }: { record: AttendanceRecord | null }) {
  const status = record?.check_in_time ? record.geofence_status : null
  if (!record || !status) return <span style={{ color: '#cbd5e1' }}>—</span>
  const r = record
  const d = r.check_in_distance_m != null ? fmtDistance(r.check_in_distance_m) : ''
  const tag = {
    inside:      { text: 'In office',         bg: '#dcfce7', fg: '#166534', tip: `${d} from ${r.geofence_location}` },
    unsure:      { text: 'Location unclear',  bg: '#fef3c7', fg: '#92400e', tip: `About ${d} from ${r.geofence_location}, but the reading was only accurate to ±${fmtDistance(r.check_in_accuracy_m ?? 0)}` },
    outside:     { text: `${d} away`,         bg: '#fee2e2', fg: '#991b1b', tip: `${d} from ${r.geofence_location}` },
    no_location: { text: 'No location',       bg: '#fef3c7', fg: '#92400e', tip: r.geofence_note ?? 'Location not shared' },
  }[status]
  const pill = <span title={tag.tip} style={{ padding: '1px 8px', borderRadius: 99, background: tag.bg, color: tag.fg, fontSize: '0.75rem', fontWeight: 500, whiteSpace: 'nowrap' }}>{tag.text}</span>
  return r.check_in_lat != null && r.check_in_lng != null
    ? <a href={mapLink(r.check_in_lat, r.check_in_lng)} target="_blank" rel="noreferrer" title={`${tag.tip}. Open on Google Maps`} style={{ textDecoration: 'none' }}>{pill}</a>
    : pill
}

const labelStyle: CSSProperties = { display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem', color: '#374151' }

const switchStyle = (on: boolean, disabled: boolean): CSSProperties => ({
  position: 'relative', width: 46, height: 26, flexShrink: 0, padding: 0, border: 'none', borderRadius: 99,
  background: on ? 'var(--brand-600)' : '#cbd5e1', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, transition: 'background 0.15s',
})
const knobStyle = (on: boolean): CSSProperties => ({
  position: 'absolute', top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: '50%',
  background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left 0.15s',
})
