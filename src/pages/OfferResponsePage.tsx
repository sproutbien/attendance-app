import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, FileText, XCircle } from 'lucide-react'
import AuthShell from '../components/AuthShell'
import { supabase } from '../lib/supabase'
import { fmtINR, fmtLetterDate } from '../lib/offerLetter'
import type { OfferShownStatus } from '../lib/offerLetter'

/** What offer_public() returns (migration 044). */
type PublicOffer = {
  ref_no: string
  status: Exclude<OfferShownStatus, 'approved'>
  candidate_name: string
  designation: string
  department: string
  company_name: string
  company_email: string
  company_phone: string
  ctc_annual: number
  joining_date: string
  letter_date: string
  accept_by: string
  responded_at: string | null
  response_name: string | null
}

/** Public: the candidate opens the link from the offer email, reads the letter and accepts or declines. */
export default function OfferResponsePage() {
  const { token = '' } = useParams()
  const [offer, setOffer] = useState<PublicOffer | null | undefined>(undefined)   // undefined = loading, null = not found
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'accept' | 'decline'>('accept')
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)

  async function load() {
    if (!/^[0-9a-f-]{36}$/i.test(token)) return setOffer(null)
    const { data, error } = await supabase.rpc('offer_public', { p_token: token })
    if (error) { setError('We couldn’t load this offer. Please try again in a moment.'); setOffer(null); return }
    setOffer((data as PublicOffer | null) ?? null)
  }
  useEffect(() => { load() }, [token])   // eslint-disable-line react-hooks/exhaustive-deps

  async function openPdf() {
    setOpening(true)
    setError(null)
    const tab = window.open('', '_blank')   // opened now so pop-up blockers allow it
    const { data, error } = await supabase.functions.invoke('offer-letter', { body: { action: 'pdf', token } })
    setOpening(false)
    if (error || !data?.url) {
      tab?.close()
      return setError('The letter couldn’t be opened. Please use the PDF attached to the email, or try again.')
    }
    if (tab) tab.location.href = data.url
    else window.location.href = data.url
  }

  async function respond(accept: boolean) {
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('respond_offer', { p_token: token, p_accept: accept, p_name: name, p_reason: reason })
    setBusy(false)
    if (error) return setError(error.message)
    await load()
  }

  return (
    <AuthShell>
      <div style={{ textAlign: 'left' }}>
        {offer === undefined ? <p style={muted}>Loading…</p>
          : offer === null ? (
            <>
              <h2 style={h2}>Offer not found</h2>
              <p style={muted}>{error ?? 'This link isn’t valid. Please use the link from your offer email, or contact the company that sent it.'}</p>
            </>
          ) : (
            <>
              <h2 style={h2}>Offer of employment</h2>
              <p style={{ ...muted, marginTop: 0 }}>{offer.company_name} · Ref {offer.ref_no}</p>

              <dl style={facts}>
                <Fact label="For" value={offer.candidate_name} />
                <Fact label="Position" value={offer.designation + (offer.department ? ` · ${offer.department}` : '')} />
                <Fact label="Annual CTC" value={`INR ${fmtINR(offer.ctc_annual)}`} />
                <Fact label="Join by" value={fmtLetterDate(offer.joining_date)} />
                {offer.status === 'sent' && <Fact label="Reply by" value={fmtLetterDate(offer.accept_by)} />}
              </dl>

              <button type="button" onClick={openPdf} disabled={opening} style={{ ...secondaryBtn, width: '100%', justifyContent: 'center' }}>
                <FileText size={18} /> {opening ? 'Opening…' : 'Read the offer letter (PDF)'}
              </button>

              {error && <p style={errorText} role="alert">{error}</p>}

              {offer.status === 'sent' && (mode === 'accept' ? (
                <form onSubmit={e => { e.preventDefault(); respond(true) }} style={{ marginTop: '1.25rem' }}>
                  <label style={label} htmlFor="offer-name">Type your full name to accept</label>
                  <input id="offer-name" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120}
                    autoComplete="name" placeholder={offer.candidate_name} style={input} />
                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '0.875rem 0', fontSize: '0.875rem', color: '#334155', lineHeight: 1.45 }}>
                    <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} required style={{ marginTop: 3, width: 16, height: 16 }} />
                    I have read the offer letter and its terms and conditions, and I accept this offer.
                  </label>
                  <button type="submit" disabled={busy || !agreed || name.trim().length < 2} style={{ ...primary, opacity: busy || !agreed || name.trim().length < 2 ? 0.6 : 1 }}>
                    {busy ? 'Sending…' : 'Accept offer'}
                  </button>
                  <button type="button" onClick={() => { setMode('decline'); setError(null) }} style={linkBtn}>I’d like to decline this offer</button>
                </form>
              ) : (
                <form onSubmit={e => { e.preventDefault(); respond(false) }} style={{ marginTop: '1.25rem' }}>
                  <label style={label} htmlFor="offer-reason">Reason (optional)</label>
                  <textarea id="offer-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={1000}
                    placeholder="It helps us to know, but you don’t have to say." style={{ ...input, resize: 'vertical' }} />
                  <button type="submit" disabled={busy} style={{ ...primary, background: '#b91c1c', marginTop: '0.875rem' }}>
                    {busy ? 'Sending…' : 'Decline offer'}
                  </button>
                  <button type="button" onClick={() => setMode('accept')} style={linkBtn}>Back</button>
                </form>
              ))}

              {offer.status === 'accepted' && (
                <Result ok title="You’ve accepted this offer">
                  Accepted by {offer.response_name} on {fmtLetterDate(offer.responded_at!.slice(0, 10))}. Welcome aboard! We’ll be in touch
                  about your first day. Please keep a copy of the letter for your records.
                </Result>
              )}
              {offer.status === 'declined' && (
                <Result title="You’ve declined this offer">Thank you for letting us know. We wish you all the best.</Result>
              )}
              {offer.status === 'withdrawn' && (
                <Result title="This offer has been withdrawn">
                  If you’ve received a revised offer, please use the link in that email. Questions? Contact us{contactLine(offer)}.
                </Result>
              )}
              {offer.status === 'expired' && (
                <Result title="This offer has lapsed">
                  The reply date was {fmtLetterDate(offer.accept_by)}. If you’re still interested, please contact us{contactLine(offer)}.
                </Result>
              )}
            </>
          )}
      </div>
    </AuthShell>
  )
}

const contactLine = (o: PublicOffer) => {
  const c = [o.company_email, o.company_phone].filter(Boolean).join(' or ')
  return c ? ` at ${c}` : ''
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '0.5rem 0', borderBottom: '1px solid #eef2f6' }}>
      <dt style={{ width: 92, flexShrink: 0, color: '#64748b', fontSize: '0.8125rem' }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 600, color: '#1e293b', fontSize: '0.9375rem', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</dd>
    </div>
  )
}

function Result({ ok, title, children }: { ok?: boolean; title: string; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : XCircle
  return (
    <div style={{ marginTop: '1.25rem', padding: '1rem', borderRadius: 12, background: ok ? '#f0fdf4' : '#f8fafc', border: `1px solid ${ok ? '#bbf7d0' : '#e2e8f0'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: ok ? '#166534' : '#334155' }}>
        <Icon size={20} /> {title}
      </div>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#475569', lineHeight: 1.5 }}>{children}</p>
    </div>
  )
}

const h2: CSSProperties = { margin: '0 0 0.25rem', fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }
const muted: CSSProperties = { color: '#64748b', fontSize: '0.875rem', lineHeight: 1.5 }
const facts: CSSProperties = { margin: '1rem 0 1.25rem' }
const label: CSSProperties = { display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#334155', marginBottom: '0.375rem' }
const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '0.75rem 0.875rem', border: '1px solid #cbd5e1', borderRadius: 10,
  fontSize: '1rem', fontFamily: 'inherit', color: '#1e293b', background: '#fff',
}
const primary: CSSProperties = {
  width: '100%', padding: '0.875rem', border: 'none', borderRadius: 10, background: 'var(--brand-600, #16a34a)',
  color: '#fff', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
}
const secondaryBtn: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '0.75rem 1rem', borderRadius: 10, border: '1px solid #cbd5e1',
  background: '#fff', color: '#1e293b', fontSize: '0.9375rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const linkBtn: CSSProperties = {
  display: 'block', margin: '0.875rem auto 0', padding: 0, border: 'none', background: 'none', color: '#64748b',
  fontSize: '0.875rem', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit',
}
const errorText: CSSProperties = { color: '#b91c1c', fontSize: '0.875rem', margin: '0.75rem 0 0' }
