import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CalendarDays, Check, House, ImageUp, Palette, RotateCcw, TriangleAlert, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useBranding } from '../../contexts/BrandingContext'
import {
  BRANDING_BUCKET, DEFAULT_BRANDING, applyBranding, brandChecks, iconUrl, logoUrl, wordmarkParts,
} from '../../lib/brand'
import type { Branding } from '../../lib/brand'
import '../../styles/app.css'
import '../../styles/auth.css'
import { card, errorBox, ghostBtn, hintStyle, inputStyle, primaryBtn, successBox } from '../employees/styles'

const PRESETS = [
  { name: 'Sproutbien green', hex: '#2a7a22' },
  { name: 'Teal', hex: '#0f766e' },
  { name: 'Ocean blue', hex: '#1d4ed8' },
  { name: 'Indigo', hex: '#4338ca' },
  { name: 'Plum', hex: '#7e22ce' },
  { name: 'Crimson', hex: '#b91c1c' },
  { name: 'Burnt orange', hex: '#c2410c' },
  { name: 'Slate', hex: '#334155' },
]
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const MAX_BYTES = 2 * 1024 * 1024

type Upload = { file: File; url: string } | 'remove' | null   // null = unchanged

/**
 * The branding form with a live preview (migrations 035, 036). The superadmin
 * edits everything and decides what the customer's admins may change; admins
 * see only the parts they're allowed (logo + colours, names + contact).
 */
export default function BrandingEditor({ scope }: { scope: 'superadmin' | 'admin' }) {
  const { branding, refresh } = useBranding()
  const sup = scope === 'superadmin'
  const canLook = sup || branding.admin_edit_look
  const canDetails = sup || branding.admin_edit_details
  const [draft, setDraft] = useState<Branding>(branding)
  const [logo, setLogo] = useState<Upload>(null)
  const [icon, setIcon] = useState<Upload>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const loadedFrom = useRef(branding.updated_at)

  // Pick up the saved branding once it arrives from the server
  useEffect(() => {
    if (branding.updated_at !== loadedFrom.current) {
      loadedFrom.current = branding.updated_at
      setDraft(branding)
    }
  }, [branding])

  // Live preview: the whole page takes the draft colour; put the saved one back on leaving
  useEffect(() => { applyBranding({ ...branding, primary_color: draft.primary_color }) }, [draft.primary_color, branding])
  useEffect(() => () => applyBranding(branding), [branding])

  const checks = useMemo(() => brandChecks(draft.primary_color), [draft.primary_color])

  const previewLogo = logo === 'remove' ? '/logo.jpg' : logo ? logo.url : logoUrl({ ...branding })
  const previewIcon = icon === 'remove' ? previewLogo : icon ? icon.url : branding.icon_path ? iconUrl(branding) : previewLogo
  const changed = logo !== null || icon !== null ||
    (Object.keys(DEFAULT_BRANDING) as (keyof Branding)[]).some(k => k !== 'logo_path' && k !== 'icon_path' && draft[k] !== branding[k])

  const set = (key: keyof Branding) => (e: { target: { value: string } }) => {
    setSaved(false)
    setDraft(d => ({ ...d, [key]: e.target.value }))
  }
  const toggle = (key: 'admin_edit_look' | 'admin_edit_details') => {
    setSaved(false)
    setDraft(d => ({ ...d, [key]: !d[key] }))
  }

  function pick(which: 'logo' | 'icon', file: File | undefined) {
    if (!file) return
    setError(null)
    if (!IMAGE_TYPES.includes(file.type)) { setError('Use a PNG, JPEG, WebP or SVG image.'); return }
    if (file.size > MAX_BYTES) { setError('Images must be 2 MB or smaller.'); return }
    setSaved(false)
    const next = { file, url: URL.createObjectURL(file) }
    ;(which === 'logo' ? setLogo : setIcon)(next)
  }

  async function upload(file: File, kind: string) {
    const ext = file.type === 'image/svg+xml' ? 'svg' : file.type.split('/')[1].replace('jpeg', 'jpg')
    const path = `${kind}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(BRANDING_BUCKET).upload(path, file, { contentType: file.type })
    if (error) throw new Error(`Couldn't upload the ${kind}: ${error.message}`)
    return path
  }

  async function save() {
    const appName = draft.app_name.trim()
    if (!appName) { setError('The app name can’t be empty.'); return }
    if (!/^#[0-9a-fA-F]{6}$/.test(draft.primary_color)) { setError('Pick a colour like #1d4ed8.'); return }
    setSaving(true)
    setError(null)
    try {
      const logoPath = !canLook ? branding.logo_path : logo === 'remove' ? null : logo ? await upload(logo.file, 'logo') : branding.logo_path
      const iconPath = !canLook ? branding.icon_path : icon === 'remove' ? null : icon ? await upload(icon.file, 'icon') : branding.icon_path
      const p: Record<string, unknown> = {}
      if (canDetails) Object.assign(p, {
        app_name: appName,
        tagline: draft.tagline.trim(),
        product_name: draft.product_name.trim(),
        company_name: draft.company_name.trim(),
        company_address: draft.company_address.trim(),
        support_email: draft.support_email.trim(),
        support_phone: draft.support_phone.trim(),
      })
      if (canLook) Object.assign(p, { primary_color: draft.primary_color.toLowerCase(), logo_path: logoPath, icon_path: iconPath })
      if (sup) Object.assign(p, { admin_edit_look: draft.admin_edit_look, admin_edit_details: draft.admin_edit_details })
      const { error } = await supabase.rpc('update_branding', { p })
      if (error) throw new Error(error.message)
      // Old images nobody points at any more
      const stale = [branding.logo_path, branding.icon_path].filter((p): p is string => !!p && p !== logoPath && p !== iconPath)
      if (stale.length) supabase.storage.from(BRANDING_BUCKET).remove(stale)
      setLogo(null)
      setIcon(null)
      await refresh()
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
    }
    setSaving(false)
  }

  function resetToDefault() {
    setSaved(false)
    // Who may edit stays as it is
    setDraft(d => ({ ...DEFAULT_BRANDING, updated_at: d.updated_at, admin_edit_look: d.admin_edit_look, admin_edit_details: d.admin_edit_details }))
    setLogo(branding.logo_path ? 'remove' : null)
    setIcon(branding.icon_path ? 'remove' : null)
  }

  const [first, second] = wordmarkParts(draft.app_name || ' ')

  return (
    <div style={sup ? { maxWidth: 1200, margin: '0 auto', padding: '1.75rem 1.25rem 4rem' } : undefined}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Palette size={20} /> Branding
        </h1>
        <p style={{ margin: '0.25rem 0 1.5rem', color: '#64748b', fontSize: '0.875rem' }}>
          {sup
            ? 'The name, logo and colours everyone sees: login page, employee app, admin panel, PDFs and the browser tab.'
            : `Your ${[canLook && 'logo and colours', canDetails && 'names and contact details'].filter(Boolean).join(' and ')}, as everyone sees them in the app.`}
        </p>

        <div className="brand-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minWidth: 0 }}>
            {canDetails && <section style={card}>
              <h2 style={sectionTitle}>Names</h2>
              <div style={grid2}>
                <Field label="App name" hint="Sidebar, login page and browser tab. Short works best.">
                  <input value={draft.app_name} onChange={set('app_name')} maxLength={40} style={inputStyle} />
                </Field>
                <Field label="Tagline" hint="Small line under the name in the sidebar. Optional.">
                  <input value={draft.tagline} onChange={set('tagline')} maxLength={60} style={inputStyle} />
                </Field>
                <Field label="Product name" hint="Under the logo on the login page, e.g. “Attendance Tracker”.">
                  <input value={draft.product_name} onChange={set('product_name')} maxLength={40} style={inputStyle} />
                </Field>
                <Field label="Company name" hint="PDF reports, CSV exports and the welcome message.">
                  <input value={draft.company_name} onChange={set('company_name')} maxLength={80} style={inputStyle} />
                </Field>
              </div>
              <Field label="Company address" hint="Shown on PDF reports. Optional.">
                <input value={draft.company_address} onChange={set('company_address')} maxLength={200} style={inputStyle} />
              </Field>
            </section>}

            {canLook && <section style={card}>
              <h2 style={sectionTitle}>Logo</h2>
              <div style={grid2}>
                <ImagePick
                  label="Logo" hint="Login page, PDF reports and the phone header. PNG or SVG with a transparent background looks best."
                  src={previewLogo} wide
                  onPick={f => pick('logo', f)}
                  onRemove={(branding.logo_path || logo) ? () => setLogo(branding.logo_path ? 'remove' : null) : undefined}
                />
                <ImagePick
                  label="Square icon" hint="Sidebar and browser tab, shown in a circle. Square, at least 128 × 128. Empty = the logo."
                  src={previewIcon} round
                  onPick={f => pick('icon', f)}
                  onRemove={(branding.icon_path || icon) ? () => setIcon(branding.icon_path ? 'remove' : null) : undefined}
                />
              </div>
            </section>}

            {canLook && <section style={card}>
              <h2 style={sectionTitle}>Brand colour</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <input type="color" value={draft.primary_color} onChange={set('primary_color')} aria-label="Brand colour"
                  style={{ width: 52, height: 40, padding: 2, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer' }} />
                <input value={draft.primary_color} onChange={set('primary_color')} maxLength={7} spellCheck={false}
                  style={{ ...inputStyle, width: 110, fontFamily: 'ui-monospace, monospace' }} aria-label="Colour code" />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {PRESETS.map(p => (
                    <button key={p.hex} type="button" title={p.name} aria-label={p.name}
                      onClick={() => set('primary_color')({ target: { value: p.hex } })}
                      style={{
                        width: 28, height: 28, borderRadius: '50%', background: p.hex, cursor: 'pointer', padding: 0,
                        border: draft.primary_color.toLowerCase() === p.hex ? '3px solid #1e293b' : '2px solid #fff',
                        boxShadow: '0 0 0 1px #cbd5e1',
                      }} />
                  ))}
                </div>
              </div>
              <p style={hintStyle}>Lighter and darker shades are made from it automatically, for light and dark mode. “Present” and other success marks stay green.</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0.875rem 0 0', display: 'grid', gap: 6 }}>
                {checks.map(c => {
                  const good = c.ratio >= 4.5
                  return (
                    <li key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: good ? '#166534' : '#92400e' }}>
                      {good ? <Check size={15} /> : <TriangleAlert size={15} />}
                      {c.label}: {c.ratio.toFixed(1)} : 1 {good ? (c.note && `(${c.note})`) : c.ratio >= 3 ? '(readable for big text only; try a darker colour)' : '(hard to read; pick a darker colour)'}
                    </li>
                  )
                })}
              </ul>
            </section>}

            {canDetails && <section style={card}>
              <h2 style={sectionTitle}>Support contact</h2>
              <p style={{ ...hintStyle, margin: '-0.5rem 0 0.875rem' }}>Shown at the bottom of the login page as “Need help?”. Leave both empty to hide it.</p>
              <div style={grid2}>
                <Field label="Email">
                  <input type="email" value={draft.support_email} onChange={set('support_email')} maxLength={120} style={inputStyle} />
                </Field>
                <Field label="Phone / WhatsApp">
                  <input value={draft.support_phone} onChange={set('support_phone')} maxLength={30} style={inputStyle} />
                </Field>
              </div>
            </section>}

            {sup && (
              <section style={card}>
                <h2 style={sectionTitle}>What the customer’s admins can change</h2>
                <p style={{ ...hintStyle, margin: '-0.5rem 0 0.875rem' }}>
                  When something is ticked, their admins get a Branding page in their admin menu with just those parts. Only you can change this.
                </p>
                <Tick checked={draft.admin_edit_look} onChange={() => toggle('admin_edit_look')}
                  label="Logo and colours" hint="Logo, square icon and brand colour." />
                <Tick checked={draft.admin_edit_details} onChange={() => toggle('admin_edit_details')}
                  label="Names and contact details" hint="App name, tagline, product name, company name and address, support contact." />
              </section>
            )}

            {error && <div style={errorBox}>{error}</div>}
            {saved && !changed && <div style={successBox}>Saved. Everyone sees the new branding the next time they open or refresh the app.</div>}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {sup ? (
                <button type="button" onClick={resetToDefault} disabled={saving} style={{ ...ghostBtn, padding: '0.5rem 1rem', display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
                  <RotateCcw size={14} /> Back to Sproutbien defaults
                </button>
              ) : <span style={{ marginRight: 'auto' }} />}
              <button type="button" onClick={() => { setDraft(branding); setLogo(null); setIcon(null); setError(null) }} disabled={saving || !changed} style={{ ...ghostBtn, padding: '0.5rem 1rem', opacity: changed ? 1 : 0.5 }}>
                Discard changes
              </button>
              <button type="button" onClick={save} disabled={saving || !changed} style={{ ...primaryBtn, opacity: saving || !changed ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save branding'}
              </button>
            </div>
          </div>

          {/* Live preview */}
          <aside style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }} aria-label="Preview">
            <PreviewLabel>Login page</PreviewLabel>
            <div className="auth-page" style={{ minHeight: 0, padding: '1.25rem', borderRadius: 14 }}>
              <div style={{ position: 'relative', width: '100%', background: 'rgba(255,255,255,0.94)', borderRadius: 18, padding: '1.25rem', textAlign: 'center', boxShadow: '0 20px 40px -20px var(--auth-card-shadow)' }}>
                <img src={previewLogo} alt="" style={{ height: 56, maxWidth: '80%', objectFit: 'contain' }} />
                <div style={{ fontSize: second ? '1.6rem' : '1.35rem', fontWeight: 800, fontVariant: second ? 'small-caps' : 'normal', color: 'var(--auth-ink)', lineHeight: 1.1, marginTop: 6 }}>
                  {first}{second && <span style={{ color: 'var(--auth-accent)' }}>{second}</span>}
                </div>
                {draft.product_name && <div style={{ color: '#2f4a44', fontSize: '0.95rem' }}>{draft.product_name}</div>}
                <div style={{ height: 34, margin: '0.875rem 0 0.5rem', borderRadius: 10, border: '1px solid #e2e8e5', background: '#f8faf9' }} />
                <div style={{ height: 40, borderRadius: 999, background: 'var(--auth-btn)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>Log In</div>
              </div>
            </div>

            <PreviewLabel>Employee app</PreviewLabel>
            <div className="sb-app" data-theme="light" style={{ minHeight: 0, display: 'flex', borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
              <div style={{ width: 132, background: 'var(--side-bg)', color: '#fff', padding: '0.75rem 0.5rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <img src={previewIcon} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', background: '#fff' }} />
                  <strong style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{draft.app_name}</strong>
                </div>
                <span style={{ ...navPill, background: 'var(--surface)', color: 'var(--green-dark)' }}><House size={12} /> Dashboard</span>
                <span style={navPill}><CalendarDays size={12} /> Leave</span>
              </div>
              <div style={{ flex: 1, padding: '0.75rem', background: 'var(--bg)', minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-strong)' }}>Good morning, <em style={{ fontStyle: 'normal', color: 'var(--green)' }}>Asha</em></div>
                <div style={{ marginTop: 8, padding: 10, borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <span className="sb-status s-present" style={{ fontSize: 11 }}><i />Present</span>
                  <div style={{ marginTop: 8, height: 30, borderRadius: 10, background: 'linear-gradient(180deg, var(--green-btn-1), var(--green-btn-2))', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>Check In</div>
                </div>
              </div>
            </div>

            <PreviewLabel>Admin panel</PreviewLabel>
            <div style={{ display: 'flex', borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
              <div style={{ width: 48, background: 'var(--brand-side)', padding: '0.75rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'color-mix(in srgb, var(--brand-100) 82%, transparent)' }}>
                <img src={previewIcon} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', background: '#fff' }} />
                <Users size={16} /><CalendarDays size={16} />
              </div>
              <div style={{ flex: 1, padding: '0.75rem', background: 'var(--brand-50)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-600)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Section heading</span>
                <span style={{ fontSize: 12, color: 'var(--brand-700)', textDecoration: 'underline' }}>A link</span>
                <span style={{ ...primaryBtn, fontSize: 12, padding: '0.375rem 0.875rem' }}>Save</span>
              </div>
            </div>
          </aside>
        </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: '0.875rem' }}>
      <span style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem', color: '#374151' }}>{label}</span>
      {children}
      {hint && <span style={{ ...hintStyle, display: 'block' }}>{hint}</span>}
    </label>
  )
}

function ImagePick({ label, hint, src, wide, round, onPick, onRemove }: {
  label: string
  hint: string
  src: string
  wide?: boolean
  round?: boolean
  onPick: (f: File | undefined) => void
  onRemove?: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div style={{ marginBottom: '0.875rem' }}>
      <span style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem', color: '#374151' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ width: wide ? 120 : 64, height: 64, display: 'grid', placeItems: 'center', borderRadius: round ? '50%' : 10, border: '1px dashed #cbd5e1', background: '#f8fafc', overflow: 'hidden', flexShrink: 0 }}>
          <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: round ? 'cover' : 'contain', width: round ? '100%' : undefined, height: round ? '100%' : undefined }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
          <button type="button" onClick={() => input.current?.click()} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ImageUp size={14} /> Upload
          </button>
          {onRemove && (
            <button type="button" onClick={onRemove} style={{ padding: 0, border: 'none', background: 'none', color: '#64748b', fontSize: '0.75rem', textDecoration: 'underline', cursor: 'pointer' }}>
              Use the built-in one
            </button>
          )}
        </div>
        <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} hidden
          onChange={e => { onPick(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <span style={{ ...hintStyle, display: 'block' }}>{hint}</span>
    </div>
  )
}

function Tick({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--brand-600)' }} />
      <span>
        <span style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151' }}>{label}</span>
        <span style={{ ...hintStyle, display: 'block' }}>{hint}</span>
      </span>
    </label>
  )
}

function PreviewLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: -8 }}>{children}</div>
}

const sectionTitle: CSSProperties = { margin: '0 0 1rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-600)', textTransform: 'uppercase', letterSpacing: '0.06em' }
const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: '1rem' }
const navPill: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }
