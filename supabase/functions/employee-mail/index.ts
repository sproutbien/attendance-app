// Supabase Edge Function: employee-mail
//   { action: 'send', kind, subject, body, employee_ids }  admin only: emails each employee their own
//                                                          personalised copy; returns the campaign's counts
//   { action: 'retry', campaign_id }                      admin only: sends the failed ones again
// Merge fields like {{first_name}} are filled in per person (same list and rules as src/lib/mail.ts).
// Setup: docs/EMPLOYEE_MAIL_SETUP.md

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? Deno.env.get('OFFER_FROM') ?? ''   // e.g. Sproutbien HR <hr@sproutbien.com>
const MAIL_REPLY_TO = Deno.env.get('MAIL_REPLY_TO')                               // defaults to the HR email in Letter settings
const BATCH = 50          // emails per Resend batch call (Resend allows 100)
const PAUSE_MS = 600      // between calls, under Resend's default 2 requests a second

/** The project's secret key (new-style sb_secret_…), else the legacy service-role key. */
function secretKey() {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
    const key = keys.default ?? Object.values(keys)[0]
    if (key) return key
  } catch { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}

const admin = createClient(SUPABASE_URL, secretKey())

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)

// ── Merge fields (keep in step with src/lib/mail.ts) ─────────

type Person = {
  id: string; full_name: string; email: string; designation: string | null; department: string | null
  employee_code: string | null; joining_date: string | null; date_of_birth: string | null
  no_celebrations: boolean | null
}

const FIELDS = ['first_name', 'full_name', 'designation', 'department', 'employee_code', 'joining_date', 'years', 'company_name'] as const
type Field = typeof FIELDS[number]
const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g

function fmtLong(iso: string) {
  return new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** Whole years since joining, as of `today` (YYYY-MM-DD). */
function yearsSince(joining: string | null, today: string) {
  if (!joining) return null
  let y = Number(today.slice(0, 4)) - Number(joining.slice(0, 4))
  const ty = Number(today.slice(0, 4))
  const leap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0
  const md = joining.slice(5, 10) === '02-29' && !leap ? '02-28' : joining.slice(5, 10)   // as the celebrations do
  if (today.slice(5) < md) y--
  return Math.max(y, 0)
}

function values(p: Person, company: string, today: string): Record<Field, string> {
  const years = yearsSince(p.joining_date, today)
  return {
    first_name: p.full_name.trim().split(/\s+/)[0] ?? '',
    full_name: p.full_name.trim(),
    designation: p.designation ?? '',
    department: p.department ?? '',
    employee_code: p.employee_code ?? '',
    joining_date: p.joining_date ? fmtLong(p.joining_date) : '',
    years: years === null ? '' : String(years),
    company_name: company,
  }
}

const fill = (text: string, v: Record<Field, string>) =>
  text.replace(TOKEN, (whole, name: string) => (FIELDS as readonly string[]).includes(name) ? v[name as Field] : whole)

function unknownFields(...texts: string[]) {
  const bad = new Set<string>()
  for (const t of texts) for (const m of t.matchAll(TOKEN)) if (!(FIELDS as readonly string[]).includes(m[1])) bad.add(m[1])
  return [...bad]
}

/** Plain text → email HTML: blank lines make paragraphs, **bold**, links made clickable. */
function bodyHtml(text: string) {
  return text.trim().split(/\n\s*\n/).map(par => {
    const html = esc(par)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, url => `<a href="${url}" style="color:inherit">${url}</a>`)
      .replace(/\n/g, '<br>')
    return `<p style="margin:0 0 16px">${html}</p>`
  }).join('')
}

function emailHtml(kind: string, body: string, company: string, color: string, name: string) {
  const banner = kind === 'greeting'
    ? `<tr><td style="background:${color};border-radius:12px 12px 0 0;padding:22px 28px;color:#ffffff;font-size:26px;text-align:center">🎉&nbsp;🎂&nbsp;🎉</td></tr>`
    : `<tr><td style="background:${color};border-radius:12px 12px 0 0;padding:14px 28px;color:#ffffff;font-size:14px;font-weight:bold;letter-spacing:.04em">${esc(company)}</td></tr>`
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Helvetica,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;font-size:15px;line-height:1.6">
${banner}
<tr><td style="padding:28px 28px 12px">${bodyHtml(body)}</td></tr></table>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;color:#94a3b8;line-height:1.5">Sent to ${esc(name)} by ${esc(company)}. Reply to this email to reach HR.</p>
</td></tr></table></body></html>`
}

// ── Sending ──────────────────────────────────────────────────

type Recipient = {
  id?: string; campaign_id: string; employee_id: string | null; full_name: string; email: string
  status: 'pending' | 'sent' | 'failed' | 'skipped'; error: string | null; provider_id: string | null; sent_at: string | null
}
type Email = { from: string; to: string[]; reply_to?: string; subject: string; html: string; text: string }

async function resend(path: string, payload: unknown) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let body: { message?: string; data?: { id: string }[]; id?: string } = {}
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, body, message: body.message ?? `The email service said no (${res.status}).` }
}

/** Sends one personalised email per pending recipient and records each result on the row. */
async function deliver(rows: Recipient[], make: (r: Recipient) => Email) {
  const pending = rows.filter(r => r.status === 'pending')
  let stopped: string | null = null      // e.g. the daily limit: everything after this fails
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH)
    if (stopped) { chunk.forEach(r => { r.status = 'failed'; r.error = stopped }); continue }
    if (i > 0) await sleep(PAUSE_MS)
    const emails = chunk.map(make)
    const res = await resend('/emails/batch', emails)
    const now = new Date().toISOString()
    if (res.ok && Array.isArray(res.body.data)) {
      chunk.forEach((r, k) => { r.status = 'sent'; r.provider_id = res.body.data![k]?.id ?? null; r.sent_at = now; r.error = null })
    } else if (res.status === 422 || res.status === 400) {
      // One bad address fails the whole batch: send this chunk one by one to find it
      for (const [k, r] of chunk.entries()) {
        await sleep(PAUSE_MS)
        const one = await resend('/emails', emails[k])
        if (one.ok) { r.status = 'sent'; r.provider_id = one.body.id ?? null; r.sent_at = new Date().toISOString(); r.error = null }
        else { r.status = 'failed'; r.error = one.message }
      }
    } else {
      console.error(`Resend ${res.status}: ${res.message}`)
      const msg = res.status === 429 ? `${res.message} (Resend’s sending limit — try again later)` : res.message
      chunk.forEach(r => { r.status = 'failed'; r.error = msg })
      if (res.status === 429 || res.status === 401 || res.status === 403) stopped = msg
    }
  }
  if (rows.length) {
    const { error } = await admin.from('mail_recipients').upsert(rows, { onConflict: 'id' })
    if (error) console.error('Saving recipient results failed', error)
  }
}

async function finish(campaignId: string) {
  const { data } = await admin.from('mail_recipients').select('status').eq('campaign_id', campaignId)
  const count = (s: string) => (data ?? []).filter(r => r.status === s).length
  const counts = { total: data?.length ?? 0, sent_count: count('sent'), failed_count: count('failed'), skipped_count: count('skipped') }
  await admin.from('mail_campaigns').update({ ...counts, finished_at: new Date().toISOString() }).eq('id', campaignId)
  return { campaign_id: campaignId, sent: counts.sent_count, failed: counts.failed_count, skipped: counts.skipped_count }
}

async function context() {
  const [{ data: b }, { data: s }] = await Promise.all([
    admin.from('branding').select('company_name, primary_color, support_email').maybeSingle(),
    admin.from('offer_letter_settings').select('company_email').maybeSingle(),
  ])
  return {
    company: b?.company_name || 'Sproutbien',
    color: /^#[0-9a-f]{6}$/i.test(b?.primary_color ?? '') ? b!.primary_color : '#2a7a22',
    replyTo: MAIL_REPLY_TO || s?.company_email || b?.support_email || undefined,
  }
}

const PERSON_COLS = 'id, full_name, email, designation, department, employee_code, joining_date, date_of_birth, no_celebrations'

function maker(kind: string, subject: string, body: string, people: Map<string, Person>, ctx: Awaited<ReturnType<typeof context>>) {
  const today = istToday()
  return (r: Recipient): Email => {
    const p = people.get(r.employee_id ?? '')!
    const v = values(p, ctx.company, today)
    const filled = fill(body, v)
    return {
      from: MAIL_FROM,
      to: [p.email],
      ...(ctx.replyTo ? { reply_to: ctx.replyTo } : {}),
      subject: fill(subject, v).replace(/\s+/g, ' ').trim(),
      html: emailHtml(kind, filled, ctx.company, ctx.color, v.full_name),
      text: filled.replace(/\*\*(.+?)\*\*/g, '$1'),
    }
  }
}

async function send(me: string, b: { kind?: string; subject?: string; body?: string; employee_ids?: unknown }) {
  const kind = b.kind === 'greeting' ? 'greeting' : b.kind === 'update' ? 'update' : null
  const subject = (b.subject ?? '').trim()
  const body = (b.body ?? '').trim()
  const ids = Array.isArray(b.employee_ids) ? [...new Set(b.employee_ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))] : []
  if (!kind) return json({ error: 'Choose an update or a greeting.' }, 400)
  if (!subject || subject.length > 200) return json({ error: 'The subject must be 1 to 200 characters.' }, 400)
  if (!body || body.length > 20000) return json({ error: 'The message is empty or too long.' }, 400)
  if (!ids.length) return json({ error: 'Pick at least one person.' }, 400)
  if (ids.length > 1000) return json({ error: 'Send to at most 1,000 people at a time.' }, 400)
  const bad = unknownFields(subject, body)
  if (bad.length) return json({ error: `Unknown field${bad.length > 1 ? 's' : ''}: ${bad.map(f => `{{${f}}}`).join(', ')}` }, 400)

  const { data: list, error } = await admin.from('employees').select(PERSON_COLS).in('id', ids).is('deleted_at', null)
  if (error) return json({ error: error.message }, 500)
  const people = new Map((list as Person[]).map(p => [p.id, p]))
  if (!people.size) return json({ error: 'None of those people were found.' }, 404)

  const { data: campaign, error: cErr } = await admin.from('mail_campaigns')
    .insert({ kind, subject, body, sent_by: me, total: people.size }).select('id').single()
  if (cErr || !campaign) return json({ error: cErr?.message ?? 'Couldn’t save the message.' }, 500)

  const rows: Recipient[] = [...people.values()].map(p => {
    const skip = !p.email?.trim() ? 'No email address'
      : kind === 'greeting' && p.no_celebrations ? 'Opted out of celebrations'
      : null
    return {
      campaign_id: campaign.id, employee_id: p.id, full_name: p.full_name, email: p.email ?? '',
      status: skip ? 'skipped' : 'pending', error: skip, provider_id: null, sent_at: null,
    }
  })
  const { data: saved, error: rErr } = await admin.from('mail_recipients').insert(rows).select('*')
  if (rErr || !saved) return json({ error: rErr?.message ?? 'Couldn’t save the recipients.' }, 500)

  await deliver(saved as Recipient[], maker(kind, subject, body, people, await context()))
  return json({ ok: true, ...(await finish(campaign.id)) })
}

async function retry(campaignId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return json({ error: 'Not found' }, 404)
  const { data: c } = await admin.from('mail_campaigns').select('*').eq('id', campaignId).maybeSingle()
  if (!c) return json({ error: 'That message wasn’t found.' }, 404)
  const { data: failed } = await admin.from('mail_recipients').select('*').eq('campaign_id', c.id).eq('status', 'failed')
  if (!failed?.length) return json({ ok: true, ...(await finish(c.id)) })

  // Use today's details (a corrected email address, say)
  const { data: list } = await admin.from('employees').select(PERSON_COLS)
    .in('id', failed.map(r => r.employee_id).filter(Boolean)).is('deleted_at', null)
  const people = new Map(((list ?? []) as Person[]).map(p => [p.id, p]))
  const rows = (failed as Recipient[]).map(r => {
    const p = people.get(r.employee_id ?? '')
    if (!p) return { ...r, error: 'No longer an employee' }
    if (!p.email?.trim()) return { ...r, error: 'No email address' }
    return { ...r, email: p.email, full_name: p.full_name, status: 'pending' as const, error: null }
  })
  await deliver(rows, maker(c.kind, c.subject, c.body, people, await context()))
  return json({ ok: true, ...(await finish(c.id)) })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let body: { action?: string; campaign_id?: string; kind?: string; subject?: string; body?: string; employee_ids?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  try {
    // Admins only (same rule as is_admin())
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } }
    const { data: me } = user
      ? await admin.from('employees').select('id, role, status, deleted_at').eq('id', user.id).maybeSingle()
      : { data: null }
    if (me?.role !== 'admin' || me.deleted_at || ['resigned', 'terminated', 'inactive'].includes(me.status)) {
      return json({ error: 'Only admins can send mail to employees.' }, 403)
    }
    if (!RESEND_API_KEY || !MAIL_FROM) {
      return json({ error: 'Email isn’t set up yet (RESEND_API_KEY and MAIL_FROM). See docs/EMPLOYEE_MAIL_SETUP.md.' }, 500)
    }
    if (body.action === 'send') return await send(me.id, body)
    if (body.action === 'retry' && body.campaign_id) return await retry(body.campaign_id)
    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error(err)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})
