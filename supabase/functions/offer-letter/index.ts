// Supabase Edge Function: offer-letter
//   { action: 'send', offer_id }  admin only: emails the approved letter's PDF to the candidate
//                                 (copy to HR), marks it sent and withdraws their older offers
//   { action: 'pdf', token }      the candidate's page: a 10-minute link to their letter's PDF
// Setup: docs/OFFER_LETTER_SETUP.md

import { createClient } from 'npm:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const OFFER_FROM = Deno.env.get('OFFER_FROM') ?? ''            // e.g. Sproutbien HR <hr@sproutbien.com>
const OFFER_BCC = Deno.env.get('OFFER_BCC')                    // HR copy; defaults to the letter settings' HR email
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '')   // e.g. https://attendance.sproutbien.com
const BUCKET = 'offer-letters'

const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

type Fields = {
  candidate_name: string; designation: string; department: string; ctc_annual: number
  company_legal_name: string; company_phone: string; company_email: string
  signatory_name: string; signatory_title: string
}

function emailHtml(f: Fields, o: { ref_no: string; joining_date: string; accept_by: string }, link: string) {
  const first = esc(f.candidate_name.trim().split(/\s+/)[0])
  const ctc = Math.round(f.ctc_annual).toLocaleString('en-IN')
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Helvetica,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px 28px;font-size:15px;line-height:1.6">
<tr><td>
<p style="margin:0 0 16px">Dear ${first},</p>
<p style="margin:0 0 16px">Thank you for your time with us. We are delighted to offer you the position of <b>${esc(f.designation)}</b> at <b>${esc(f.company_legal_name)}</b>. Your offer letter is attached to this email as a PDF.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;font-size:14px">
<tr><td style="color:#64748b;padding:3px 16px 3px 0">Position</td><td><b>${esc(f.designation)}</b></td></tr>
<tr><td style="color:#64748b;padding:3px 16px 3px 0">Annual CTC</td><td><b>INR ${ctc}</b></td></tr>
<tr><td style="color:#64748b;padding:3px 16px 3px 0">Join by</td><td><b>${fmtDate(o.joining_date)}</b></td></tr>
<tr><td style="color:#64748b;padding:3px 16px 3px 0">Reply by</td><td><b>${fmtDate(o.accept_by)}</b></td></tr>
</table>
<p style="margin:0 0 20px">Please read the letter and its terms, then accept or decline online:</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#2a7a22;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">View and respond to your offer</a></p>
<p style="margin:0 0 16px">If you have any questions, simply reply to this email${f.company_phone ? ` or call us on ${esc(f.company_phone)}` : ''}. We look forward to welcoming you to the team.</p>
<p style="margin:0">Warm regards,<br><b>${esc(f.signatory_name)}</b><br>${esc(f.signatory_title)}<br>${esc(f.company_legal_name)}</p>
</td></tr></table>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;color:#94a3b8;line-height:1.5">Ref ${esc(o.ref_no)}. This email and its attachment are confidential and meant only for ${esc(f.candidate_name)}. If you received it by mistake, please let us know and delete it.</p>
</td></tr></table></body></html>`
}

async function send(req: Request, offerId: string) {
  // Only admins can send. The function is deployed without the gateway's JWT check (the
  // candidate's page calls it signed out), so the signed-in user is checked here. Same rule as is_admin().
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } }
  const { data: me } = user
    ? await admin.from('employees').select('role, deleted_at').eq('id', user.id).maybeSingle()
    : { data: null }
  if (me?.role !== 'admin' || me.deleted_at) return json({ error: 'Only admins can send offer letters.' }, 403)

  if (!RESEND_API_KEY || !OFFER_FROM || !APP_URL) {
    return json({ error: 'Email isn’t set up yet (RESEND_API_KEY, OFFER_FROM and APP_URL). See docs/OFFER_LETTER_SETUP.md.' }, 500)
  }

  const { data: o } = await admin.from('offers').select('*').eq('id', offerId).maybeSingle()
  if (!o) return json({ error: 'Offer not found.' }, 404)
  if (o.status !== 'approved' && o.status !== 'sent') return json({ error: `This offer is ${o.status}, so it can’t be sent.` }, 409)
  if (!o.pdf_path) return json({ error: 'This offer has no PDF.' }, 409)
  if (istToday() > o.accept_by) return json({ error: 'The reply date has passed. Write a revised offer with a new date.' }, 409)

  const { data: pdf, error: dlErr } = await admin.storage.from(BUCKET).download(o.pdf_path)
  if (dlErr || !pdf) return json({ error: 'The letter’s PDF couldn’t be read.' }, 500)
  const f = o.fields as Fields
  const bcc = OFFER_BCC ?? f.company_email

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: OFFER_FROM,
      to: [o.email_to],
      ...(bcc ? { bcc: [bcc] } : {}),
      ...(f.company_email ? { reply_to: f.company_email } : {}),
      subject: `Offer of Employment – ${f.designation} | ${f.company_legal_name}`,
      html: emailHtml(f, o, `${APP_URL}/offer/${o.token}`),
      attachments: [{ filename: `Offer Letter - ${f.candidate_name.trim()} - ${o.ref_no.replace(/\//g, '-')}.pdf`, content: encodeBase64(new Uint8Array(await pdf.arrayBuffer())) }],
    }),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    console.error(`Resend ${res.status} for offer ${o.id}: ${detail}`)
    let message = `The email service said no (${res.status}).`
    try { message = JSON.parse(detail).message ?? message } catch { /* not JSON */ }
    await admin.from('offers').update({ email_error: message }).eq('id', o.id)
    return json({ error: message }, 502)
  }

  await admin.from('offers').update({
    status: 'sent', sent_at: new Date().toISOString(), send_count: (o.send_count ?? 0) + 1, email_error: null,
  }).eq('id', o.id)
  // A new letter replaces the candidate's earlier ones
  await admin.from('offers').update({ status: 'withdrawn' })
    .eq('candidate_id', o.candidate_id).neq('id', o.id).in('status', ['approved', 'sent'])
  return json({ ok: true })
}

async function pdfLink(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: 'Not found' }, 404)
  const { data: o } = await admin.from('offers').select('pdf_path, status').eq('token', token).maybeSingle()
  if (!o?.pdf_path || o.status === 'approved' || o.status === 'withdrawn') return json({ error: 'Not found' }, 404)
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(o.pdf_path, 600)
  if (error || !data) return json({ error: 'Not found' }, 404)
  return json({ url: data.signedUrl })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let body: { action?: string; offer_id?: string; token?: string }
  try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  try {
    if (body.action === 'send' && body.offer_id) return await send(req, body.offer_id)
    if (body.action === 'pdf' && body.token) return await pdfLink(body.token)
    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error(err)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})
