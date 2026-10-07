import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowLeft, Copy, FileText, Mail, Settings, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useBranding } from '../../contexts/BrandingContext'
import { localDate } from '../../lib/calendar'
import {
  OFFER_BUCKET, OFFER_STATUS, amountInWords, draftFields, fmtINR, fmtLetterDate, loadOfferSettings, loadSignature,
  offerProblem, openOfferPdf, sendOffer, shownStatus, uploadSignature,
} from '../../lib/offerLetter'
import type { Offer, OfferFields, OfferSettings } from '../../lib/offerLetter'
import LetterPreview from './LetterPreview'
import { errorBox, ghostBtn, hintStyle, inputStyle, modalStyle, overlayStyle, primaryBtn, successBox } from '../employees/styles'
import type { Candidate } from '../../types'

type View = 'list' | 'form' | 'preview' | 'settings'

/** Admin: a candidate's offer letters — write one, check the final draft, approve and email it. */
export default function OfferLetterModal({ candidate, workingHours, onClose, onChanged }: {
  candidate: Candidate
  workingHours: string        // default for new letters, from the default shift
  onClose: () => void
  onChanged: () => void       // offers or the candidate's stage changed
}) {
  const { employee: me } = useAuth()
  const { branding, logo } = useBranding()
  const [view, setView] = useState<View>('list')
  const [settings, setSettings] = useState<OfferSettings | null>(null)
  const [offers, setOffers] = useState<Offer[]>([])
  const [signature, setSignature] = useState<{ blob: Blob; url: string } | null>(null)
  const [fields, setFields] = useState<OfferFields | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)   // what's happening, for the button label
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<React.ReactNode>(null)
  const [confirming, setConfirming] = useState(false)
  const today = localDate()

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([
        loadOfferSettings(),
        supabase.from('offers').select('*').eq('candidate_id', candidate.id).order('approved_at', { ascending: false }),
      ])
      if (list.error) throw new Error(list.error.message)
      setSettings(s)
      setOffers((list.data ?? []) as Offer[])
      const blob = await loadSignature(s.signature_path)
      setSignature(prev => {
        if (prev) URL.revokeObjectURL(prev.url)
        return blob ? { blob, url: URL.createObjectURL(blob) } : null
      })
      return { s, list: (list.data ?? []) as Offer[] }
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setLoading(false)
    }
  }, [candidate.id])

  useEffect(() => {
    load().then(r => { if (r && r.list.length === 0) startNew(r.s, null) })
  }, [load])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (signature) URL.revokeObjectURL(signature.url) }, [signature])

  function startNew(s = settings, last: OfferFields | null = offers[0]?.fields ?? null) {
    if (!s) return
    setFields(draftFields(candidate, s, today, last, workingHours))
    setError(null)
    setNotice(null)
    setView('form')
  }

  const set = <K extends keyof OfferFields>(k: K, v: OfferFields[K]) => setFields(p => p && { ...p, [k]: v })

  function toPreview() {
    if (!fields) return
    const problem = offerProblem(fields)
    if (problem) return setError(problem)
    setError(null)
    setConfirming(false)
    setView('preview')
  }

  /** Saves the letter (frozen), makes the PDF, emails it. */
  async function approveAndSend() {
    if (!fields || !settings) return
    if (!signature) return setError('Add the signature in Letter settings before sending.')
    setError(null)
    setBusy('Saving the letter…')
    const { data, error: insErr } = await supabase.from('offers').insert({
      candidate_id: candidate.id, fields, email_to: fields.candidate_email.trim().toLowerCase(),
      letter_date: fields.letter_date, joining_date: fields.joining_date, accept_by: fields.accept_by,
    }).select().single()
    if (insErr || !data) { setBusy(null); return setError(insErr?.message ?? 'The letter wasn’t saved.') }
    const offer = data as Offer

    try {
      setBusy('Making the PDF…')
      const { buildOfferPdf } = await import('../../lib/offerPdf')
      const logoBytes = await fetch(logo).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)
      const pdf = await buildOfferPdf(fields, offer.ref_no, {
        logo: logoBytes, signature: await signature.blob.arrayBuffer(), brandColor: branding.primary_color,
      })
      const path = `${offer.id}/offer-letter.pdf`
      const up = await supabase.storage.from(OFFER_BUCKET).upload(path, new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), { contentType: 'application/pdf' })
      if (up.error) throw new Error(`The PDF wasn’t saved: ${up.error.message}`)
      const { error: updErr } = await supabase.from('offers').update({ pdf_path: path }).eq('id', offer.id)
      if (updErr) throw new Error(updErr.message)
    } catch (e) {
      await supabase.from('offers').delete().eq('id', offer.id)   // nothing half-made is kept
      setBusy(null)
      return setError((e as Error).message)
    }

    if (candidate.stage !== 'offer') await supabase.from('candidates').update({ stage: 'offer' }).eq('id', candidate.id)

    setBusy('Emailing…')
    const sendErr = await sendOffer(offer.id)
    setBusy(null)
    await load()
    onChanged()
    setView('list')
    setFields(null)
    if (sendErr) setError(`Letter ${offer.ref_no} is saved, but the email wasn’t sent: ${sendErr}`)
    else setNotice(<>Offer letter {offer.ref_no} was emailed to <b>{offer.email_to}</b>.</>)
  }

  async function resend(o: Offer) {
    setError(null); setNotice(null)
    setBusy(`resend:${o.id}`)
    const err = await sendOffer(o.id)
    setBusy(null)
    await load()
    onChanged()
    if (err) setError(err)
    else setNotice(<>Sent {o.ref_no} to <b>{o.email_to}</b> again.</>)
  }

  async function withdraw(o: Offer) {
    setError(null); setNotice(null)
    setBusy(`withdraw:${o.id}`)
    const { error } = await supabase.from('offers').update({ status: 'withdrawn' }).eq('id', o.id)
    setBusy(null)
    if (error) return setError(error.message)
    await load()
    onChanged()
    setNotice(<>{o.ref_no} is withdrawn. The candidate’s link now says so.</>)
  }

  async function copyLink(o: Offer) {
    const url = `${window.location.origin}/offer/${o.token}`
    try { await navigator.clipboard.writeText(url); setNotice('Link copied. Anyone with it can see and answer this offer, so share it only with the candidate.') }
    catch { setNotice(<>Link: <code>{url}</code></>) }
  }

  const title = view === 'settings' ? 'Letter settings' : view === 'preview' ? 'Final draft' : `Offer letter · ${candidate.full_name}`

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div style={{ ...modalStyle, maxWidth: view === 'preview' ? 880 : 640, background: view === 'preview' ? '#f1f5f9' : '#fff' }}
        role="dialog" aria-modal="true" aria-labelledby="offer-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          {(view === 'preview' || view === 'settings' || (view === 'form' && offers.length > 0)) && (
            <button onClick={() => { setError(null); setView(view === 'form' || !fields ? 'list' : 'form') }}
              disabled={!!busy} aria-label="Back" style={iconBtn}><ArrowLeft size={18} /></button>
          )}
          <h2 id="offer-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b', flex: 1, minWidth: 0 }}>{title}</h2>
          {view !== 'settings' && view !== 'preview' && (
            <button onClick={() => { setError(null); setView('settings') }} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Settings size={14} /> Letter settings
            </button>
          )}
          <button onClick={onClose} disabled={!!busy} aria-label="Close" style={{ ...iconBtn, fontSize: '1.25rem', color: '#94a3b8' }}>✕</button>
        </div>

        {notice && <div style={successBox}>{notice}</div>}
        {error && <div style={errorBox}>{error}</div>}

        {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : !settings ? null : (
          <>
            {view === 'list' && (
              <OfferList offers={offers} today={today} busy={busy} onNew={() => startNew()} onResend={resend} onWithdraw={withdraw}
                onCopy={copyLink} onOpen={async o => { const e = await openOfferPdf(o); if (e) setError(e) }} />
            )}

            {view === 'form' && fields && (
              <OfferForm f={fields} set={set} hasSignature={!!signature} onSettings={() => setView('settings')} onNext={toPreview} />
            )}

            {view === 'preview' && fields && (
              <>
                <div style={{ ...successBox, background: '#fff', borderColor: '#e2e8f0', color: '#334155', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                  <span style={{ flex: '1 1 260px' }}>
                    Check the letter carefully. Once approved it can’t be changed; it’s saved as a PDF and emailed to <b>{fields.candidate_email}</b>
                    {settings.company_email && <> (copy to {settings.company_email})</>}.
                  </span>
                  {!confirming ? (
                    <span style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => setView('form')} style={ghostBtn}>Edit</button>
                      <button onClick={() => setConfirming(true)} style={primaryBtn}>Approve and send…</button>
                    </span>
                  ) : (
                    <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <b>Send it now?</b>
                      <button onClick={() => setConfirming(false)} disabled={!!busy} style={ghostBtn}>Not yet</button>
                      <button onClick={approveAndSend} disabled={!!busy} style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: busy ? 0.7 : 1 }}>
                        <Mail size={15} /> {busy ?? 'Yes, approve and send'}
                      </button>
                    </span>
                  )}
                </div>
                <LetterPreview fields={fields} refNo={`${settings.ref_prefix}/${fields.letter_date.slice(0, 4)}/###`} logo={logo}
                  signature={signature?.url ?? null} brandColor={branding.primary_color} />
                <p style={{ ...hintStyle, textAlign: 'center', marginTop: '0.75rem' }}>The reference number (###) is given when you approve.</p>
              </>
            )}

            {view === 'settings' && (
              <SettingsForm settings={settings} signatureUrl={signature?.url ?? null} myId={me?.id ?? null}
                onSaved={async () => { await load(); setNotice('Letter settings saved.'); setView(fields ? 'form' : 'list') }}
                onError={setError} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── List ─────────────────────────────────────────────────────

function OfferList({ offers, today, busy, onNew, onResend, onWithdraw, onCopy, onOpen }: {
  offers: Offer[]
  today: string
  busy: string | null
  onNew: () => void
  onResend: (o: Offer) => void
  onWithdraw: (o: Offer) => void
  onCopy: (o: Offer) => void
  onOpen: (o: Offer) => void
}) {
  const [confirmWithdraw, setConfirmWithdraw] = useState<string | null>(null)
  const live = offers.find(o => o.status === 'sent' || o.status === 'approved' || o.status === 'accepted')
  return (
    <div>
      {offers.map(o => {
        const st = shownStatus(o, today)
        const s = OFFER_STATUS[st]
        const canSend = (st === 'approved' || st === 'sent') && !!o.pdf_path
        return (
          <div key={o.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '0.875rem 1rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <b style={{ fontSize: '0.9375rem' }}>{o.fields.designation}</b>
              <span style={{ ...pill, background: s.bg, color: s.text }}>{s.label}</span>
              <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: '0.75rem' }}>{o.ref_no}</span>
            </div>
            <div style={{ fontSize: '0.8125rem', color: '#475569', marginTop: 4, lineHeight: 1.6 }}>
              INR {fmtINR(o.fields.ctc_annual)} a year · joining by {fmtLetterDate(o.joining_date)} · accept by {fmtLetterDate(o.accept_by)}
              <br />
              {o.sent_at ? <>Emailed to {o.email_to} on {new Date(o.sent_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{o.send_count > 1 && ` (${o.send_count} times)`}</> : <>Not emailed yet</>}
              {o.viewed_at && !o.responded_at && <> · opened {new Date(o.viewed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</>}
              {o.status === 'accepted' && <><br /><span style={{ color: '#166534' }}>Accepted by “{o.response_name}” on {new Date(o.responded_at!).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span></>}
              {o.status === 'declined' && <><br /><span style={{ color: '#991b1b' }}>Declined on {new Date(o.responded_at!).toLocaleDateString('en-GB', { dateStyle: 'medium' })}{o.decline_reason && `: “${o.decline_reason}”`}</span></>}
              {o.email_error && (o.status === 'approved' || o.status === 'sent') && <><br /><span style={{ color: '#b45309' }}>Last send failed: {o.email_error}</span></>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.625rem' }}>
              <button onClick={() => onOpen(o)} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><FileText size={14} /> View PDF</button>
              {canSend && (
                <button onClick={() => onResend(o)} disabled={!!busy} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Mail size={14} /> {busy === `resend:${o.id}` ? 'Sending…' : o.sent_at ? 'Send again' : 'Send'}
                </button>
              )}
              {o.status === 'sent' && st === 'sent' && (
                <button onClick={() => onCopy(o)} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Copy size={14} /> Copy link</button>
              )}
              {(o.status === 'sent' || o.status === 'approved') && (confirmWithdraw === o.id ? (
                <>
                  <button onClick={() => { setConfirmWithdraw(null); onWithdraw(o) }} disabled={!!busy} style={{ ...ghostBtn, color: '#fff', background: '#dc2626', borderColor: '#dc2626' }}>Withdraw offer</button>
                  <button onClick={() => setConfirmWithdraw(null)} style={ghostBtn}>Keep</button>
                </>
              ) : (
                <button onClick={() => setConfirmWithdraw(o.id)} disabled={!!busy} style={{ ...ghostBtn, color: '#b91c1c', borderColor: '#fecaca' }}>Withdraw…</button>
              ))}
            </div>
          </div>
        )
      })}
      <button onClick={onNew} style={{ ...primaryBtn, marginTop: '0.25rem' }}>
        {offers.length === 0 ? 'Write offer letter' : 'Write a revised offer'}
      </button>
      {live && live.status !== 'accepted' && (
        <p style={hintStyle}>Sending a revised offer withdraws {live.ref_no} automatically.</p>
      )}
    </div>
  )
}

// ── Form ─────────────────────────────────────────────────────

function OfferForm({ f, set, hasSignature, onSettings, onNext }: {
  f: OfferFields
  set: <K extends keyof OfferFields>(k: K, v: OfferFields[K]) => void
  hasSignature: boolean
  onSettings: () => void
  onNext: () => void
}) {
  const text = (k: keyof OfferFields) => (e: { target: { value: string } }) => set(k, e.target.value as never)
  const num = (k: 'ctc_annual' | 'probation_months' | 'probation_notice_days' | 'notice_days') =>
    (e: { target: { value: string } }) => set(k, e.target.value === '' ? 0 : Math.max(0, Number(e.target.value)))

  return (
    <form onSubmit={e => { e.preventDefault(); onNext() }}>
      {!hasSignature && (
        <div style={{ ...errorBox, background: '#fffbeb', borderColor: '#fde68a', color: '#92400e' }}>
          No signature is set up yet. <button type="button" onClick={onSettings} style={linkBtn}>Add it in Letter settings</button> before sending.
        </div>
      )}

      <Section title="Candidate">
        <div style={grid}>
          <Field label="Title">
            <select value={f.salutation} onChange={text('salutation')} style={inputStyle}>
              {['', 'Mr.', 'Ms.', 'Mx.', 'Dr.'].map(s => <option key={s} value={s}>{s || '(none)'}</option>)}
            </select>
          </Field>
          <Field label="Full name"><input value={f.candidate_name} onChange={text('candidate_name')} required maxLength={120} style={inputStyle} /></Field>
        </div>
        <Field label="Email (the letter is sent here)"><input type="email" value={f.candidate_email} onChange={text('candidate_email')} required maxLength={200} style={inputStyle} /></Field>
        <Field label="Postal address (optional)">
          <textarea value={f.candidate_address} onChange={text('candidate_address')} rows={3} maxLength={400} placeholder={'House name, street\nPost office\nCity, PIN'}
            style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
      </Section>

      <Section title="Role">
        <div style={grid}>
          <Field label="Position"><input value={f.designation} onChange={text('designation')} required maxLength={120} placeholder="e.g. Creative Graphic Designer" style={inputStyle} /></Field>
          <Field label="Department (optional)"><input value={f.department} onChange={text('department')} maxLength={80} style={inputStyle} /></Field>
          <Field label="Reporting to (optional)"><input value={f.reporting_to} onChange={text('reporting_to')} maxLength={120} placeholder="Name or role" style={inputStyle} /></Field>
          <Field label="Employment type">
            <select value={f.employment_type} onChange={text('employment_type')} style={inputStyle}>
              {['Full-time', 'Part-time', 'Fixed-term contract', 'Internship'].map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Place of work"><input value={f.work_location} onChange={text('work_location')} required maxLength={300} style={inputStyle} /></Field>
        <Field label="Working hours"><input value={f.working_hours} onChange={text('working_hours')} maxLength={160} style={inputStyle} /></Field>
      </Section>

      <Section title="Dates">
        <div style={grid}>
          <Field label="Letter date"><input type="date" value={f.letter_date} onChange={text('letter_date')} required style={inputStyle} /></Field>
          <Field label="Join on or before"><input type="date" value={f.joining_date} min={f.letter_date} onChange={text('joining_date')} required style={inputStyle} /></Field>
          <Field label="Accept by"><input type="date" value={f.accept_by} min={f.letter_date} onChange={text('accept_by')} required style={inputStyle} /></Field>
        </div>
      </Section>

      <Section title="Pay and terms">
        <Field label="Annual CTC (₹)">
          <input type="number" inputMode="numeric" min={0} step={1000} value={f.ctc_annual || ''} onChange={num('ctc_annual')} required placeholder="e.g. 360000" style={inputStyle} />
          {f.ctc_annual > 0 && (
            <p style={hintStyle}>INR {fmtINR(f.ctc_annual)} · Rupees {amountInWords(f.ctc_annual)} Only · about ₹{fmtINR(f.ctc_annual / 12)} a month</p>
          )}
        </Field>
        <div style={grid}>
          <Field label="Probation (months, 0 = none)"><input type="number" min={0} max={24} value={f.probation_months} onChange={num('probation_months')} style={inputStyle} /></Field>
          {f.probation_months > 0 && (
            <Field label="Notice during probation (days)"><input type="number" min={0} max={180} value={f.probation_notice_days} onChange={num('probation_notice_days')} style={inputStyle} /></Field>
          )}
          <Field label={f.probation_months > 0 ? 'Notice after confirmation (days)' : 'Notice period (days)'}>
            <input type="number" min={0} max={180} value={f.notice_days} onChange={num('notice_days')} style={inputStyle} />
          </Field>
        </div>
        <Field label="Additional terms (optional)">
          <textarea value={f.additional_terms} onChange={text('additional_terms')} rows={3} maxLength={2000}
            placeholder="Anything specific to this offer, e.g. a joining bonus or a training bond. Added as the last clause."
            style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button type="submit" style={primaryBtn}>Preview final draft</button>
      </div>
    </form>
  )
}

// ── Settings ─────────────────────────────────────────────────

function SettingsForm({ settings, signatureUrl, myId, onSaved, onError }: {
  settings: OfferSettings
  signatureUrl: string | null
  myId: string | null
  onSaved: () => void
  onError: (e: string | null) => void
}) {
  const [s, setS] = useState(settings)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const set = (k: keyof OfferSettings) => (e: { target: { value: string } }) => setS(p => ({ ...p, [k]: e.target.value }))
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    onError(null)
    setSaving(true)
    try {
      let signature_path = s.signature_path
      if (file) signature_path = await uploadSignature(file)
      const { error } = await supabase.from('offer_letter_settings').update({
        company_legal_name: s.company_legal_name.trim(), company_address: s.company_address.trim(), company_phone: s.company_phone.trim(),
        company_email: s.company_email.trim(), company_website: s.company_website.trim(), jurisdiction: s.jurisdiction.trim(),
        ref_prefix: s.ref_prefix.trim() || 'HR', signatory_name: s.signatory_name.trim(), signatory_title: s.signatory_title.trim(),
        signature_path, updated_at: new Date().toISOString(), updated_by: myId,
      }).eq('id', true)
      if (error) throw new Error(error.message)
      if (file && settings.signature_path && settings.signature_path !== signature_path) {
        await supabase.storage.from(OFFER_BUCKET).remove([settings.signature_path])
      }
      onSaved()
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save}>
      <Section title="Signatory">
        <div style={grid}>
          <Field label="Name"><input value={s.signatory_name} onChange={set('signatory_name')} required maxLength={80} style={inputStyle} /></Field>
          <Field label="Title"><input value={s.signatory_title} onChange={set('signatory_title')} maxLength={80} style={inputStyle} /></Field>
        </div>
        <Field label="Signature">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ width: 200, height: 72, border: '1px dashed #cbd5e1', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
              {preview ?? signatureUrl
                ? <img src={preview ?? signatureUrl!} alt="Signature" style={{ maxWidth: 190, maxHeight: 64 }} />
                : <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>None yet</span>}
            </div>
            <button type="button" onClick={() => input.current?.click()} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Upload size={14} /> {signatureUrl || file ? 'Replace' : 'Upload'}
            </button>
            <input ref={input} type="file" accept="image/png,image/jpeg" hidden onChange={e => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (!f) return
              setFile(f)
              setPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f) })
            }} />
          </div>
          <p style={hintStyle}>PNG with a transparent background works best. It’s stored privately and only placed on letters you approve.</p>
        </Field>
      </Section>

      <Section title="Letterhead">
        <Field label="Company name (as registered)"><input value={s.company_legal_name} onChange={set('company_legal_name')} required maxLength={120} style={inputStyle} /></Field>
        <Field label="Address"><input value={s.company_address} onChange={set('company_address')} maxLength={300} style={inputStyle} /></Field>
        <div style={grid}>
          <Field label="Phone"><input value={s.company_phone} onChange={set('company_phone')} maxLength={80} style={inputStyle} /></Field>
          <Field label="HR email"><input type="email" value={s.company_email} onChange={set('company_email')} maxLength={120} style={inputStyle} /></Field>
          <Field label="Website (optional)"><input value={s.company_website} onChange={set('company_website')} maxLength={120} placeholder="www.example.com" style={inputStyle} /></Field>
          <Field label="Courts (city) named in the terms"><input value={s.jurisdiction} onChange={set('jurisdiction')} maxLength={60} style={inputStyle} /></Field>
          <Field label="Reference prefix"><input value={s.ref_prefix} onChange={set('ref_prefix')} maxLength={20} style={inputStyle} /></Field>
        </div>
        <p style={hintStyle}>The logo comes from the app’s branding. Changes apply to letters approved from now on.</p>
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save settings'}</button>
      </div>
    </form>
  )
}

// ── Bits ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '0 0 1rem' }}>
      <legend style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.625rem', padding: 0 }}>{title}</legend>
      {children}
    </fieldset>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: '0.75rem' }}>
      <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, marginBottom: '0.375rem', color: '#374151' }}>{label}</span>
      {children}
    </label>
  )
}

const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', columnGap: '0.875rem' }
const pill: CSSProperties = { padding: '2px 10px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 700 }
const iconBtn: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 4, lineHeight: 1, display: 'inline-flex' }
const linkBtn: CSSProperties = { padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', textDecoration: 'underline', font: 'inherit', fontWeight: 600 }
