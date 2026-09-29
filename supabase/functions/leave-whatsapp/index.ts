// Supabase Edge Function: leave-whatsapp
// Called by the on_leave_whatsapp trigger (migration 006) via pg_net.
//   leave_submitted → template "leave_request_admin" to ADMIN_WHATSAPP_NUMBERS
//   leave_reviewed  → template "leave_approved" / "leave_rejected" to the employee
// Setup: docs/WHATSAPP_SETUP.md

import { createClient } from 'npm:@supabase/supabase-js@2'

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_TOKEN')!
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!
const ADMIN_WHATSAPP_NUMBERS = (Deno.env.get('ADMIN_WHATSAPP_NUMBERS') ?? '')
  .split(',').map(n => n.replace(/\D/g, '')).filter(Boolean)
const WEBHOOK_SECRET = Deno.env.get('LEAVE_WEBHOOK_SECRET')!
const API_VERSION = Deno.env.get('WHATSAPP_API_VERSION') ?? 'v23.0'
const TEMPLATE_LANGUAGE = Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'en'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ── Helpers ──────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

function dateRange(start: string, end: string) {
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`
}

const SESSIONS: Record<string, string> = { morning: 'Morning, 9:30 AM – 1:30 PM', afternoon: 'Afternoon, 1:30 PM – 5:30 PM' }

function dayCount(start: string, end: string, halfDaySession: string | null) {
  if (halfDaySession) return 'Half day'
  const n = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1
  return `${n} day${n !== 1 ? 's' : ''}`
}

// Meta rejects template params that are empty or contain newlines, tabs or 4+ spaces
function param(text: string | null | undefined, maxLength = 200) {
  const clean = (text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim()
  return clean.length > maxLength ? clean.slice(0, maxLength - 1) + '…' : clean || '—'
}

async function sendTemplate(to: string, template: string, params: string[]) {
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: TEMPLATE_LANGUAGE },
        components: [{
          type: 'body',
          parameters: params.map(text => ({ type: 'text', text })),
        }],
      },
    }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`WhatsApp API ${res.status} sending "${template}" to ${to}: ${body}`)
  console.log(`Sent "${template}" to ${to}: ${body}`)
}

// ── Handler ──────────────────────────────────────────────────

Deno.serve(async req => {
  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  let event: string, leaveId: string
  try {
    ({ event, leave_id: leaveId } = await req.json())
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  // Re-read the row — never trust request contents for what gets sent
  const { data: leave, error } = await supabase
    .from('leave_requests')
    .select('start_date, end_date, half_day_session, reason, status, employee:employees!employee_id(full_name, department, phone)')
    .eq('id', leaveId)
    .maybeSingle()

  if (error || !leave) {
    console.error(`Leave ${leaveId} not found`, error)
    return new Response('Leave not found', { status: 404 })
  }

  const employee = leave.employee as unknown as { full_name: string; department: string | null; phone: string | null }
  const dates = dateRange(leave.start_date, leave.end_date) +
    (leave.half_day_session ? ` (${SESSIONS[leave.half_day_session]})` : '')

  try {
    if (event === 'leave_submitted') {
      if (ADMIN_WHATSAPP_NUMBERS.length === 0) {
        console.warn('ADMIN_WHATSAPP_NUMBERS not set — skipping admin notification')
      }
      // {{1}} name  {{2}} department  {{3}} dates  {{4}} day count  {{5}} reason
      await Promise.all(ADMIN_WHATSAPP_NUMBERS.map(to => sendTemplate(to, 'leave_request_admin', [
        param(employee.full_name),
        param(employee.department),
        param(dates),
        param(dayCount(leave.start_date, leave.end_date, leave.half_day_session)),
        param(leave.reason, 300),
      ])))
    } else if (event === 'leave_reviewed' && (leave.status === 'approved' || leave.status === 'rejected')) {
      if (!employee.phone) {
        console.warn(`${employee.full_name} has no phone number — skipping ${leave.status} notification`)
      } else {
        // {{1}} first name  {{2}} dates
        await sendTemplate(employee.phone, leave.status === 'approved' ? 'leave_approved' : 'leave_rejected', [
          param(employee.full_name.split(' ')[0]),
          param(dates),
        ])
      }
    } else {
      return new Response(`Ignored event "${event}" (status ${leave.status})`, { status: 200 })
    }
  } catch (err) {
    console.error(err)
    return new Response(String(err), { status: 502 })
  }

  return new Response('ok', { status: 200 })
})
