import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Cake, ChevronDown, ChevronRight, Megaphone, PartyPopper, RotateCw, Search, Send } from 'lucide-react'
import { useEmployeeManagement } from '../../hooks/useEmployeeManagement'
import { useBranding } from '../../contexts/BrandingContext'
import { localDate } from '../../lib/calendar'
import { fmtOccasion } from '../../lib/celebrations'
import {
  MERGE_FIELDS, blanks, deleteTemplate, fillFields, loadCampaigns, loadRecipients, loadTemplates, mailable,
  mergeValues, occasionsBetween, retryMail, saveTemplate, sendMail, usedFields,
} from '../../lib/mail'
import type { MailCampaign, MailKind, MailRecipient, MailTemplate, SendResult } from '../../lib/mail'
import {
  card, errorBox, ghostBtn, hintStyle, inputStyle, primaryBtn, sectionHeading, successBox,
} from '../../components/employees/styles'
import type { Employee } from '../../types'

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return localDate(d)
}

/** Admin: write one message, send each employee their own personalised copy, see what went out. */
export default function AdminMailPage() {
  const { employees, loading } = useEmployeeManagement()
  const { branding } = useBranding()
  const company = branding.company_name
  const staff = useMemo(() => employees.filter(e => mailable(e) && e.email), [employees])
  const today = localDate()

  const [kind, setKind] = useState<MailKind>('update')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [previewId, setPreviewId] = useState<string>('')
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<ReactNode>(null)
  const [historyKey, setHistoryKey] = useState(0)

  // Templates
  const [templates, setTemplates] = useState<MailTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
  const [naming, setNaming] = useState<string | null>(null)   // name for "Save as template"
  const reloadTemplates = useCallback(() => loadTemplates().then(setTemplates).catch(e => setError(e.message)), [])
  useEffect(() => { reloadTemplates() }, [reloadTemplates])
  const template = templates.find(t => t.id === templateId)
  const templateChanged = !!template && (template.subject !== subject || template.body !== body || template.kind !== kind)

  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const lastFocus = useRef<'subject' | 'body'>('body')
  const subjectRef = useRef<HTMLInputElement>(null)

  function applyTemplate(id: string) {
    const t = templates.find(x => x.id === id)
    if (t && (subject.trim() || body.trim()) && !window.confirm('Replace what you’ve written with this template?')) return
    setTemplateId(id)
    if (t) { setKind(t.kind); setSubject(t.subject); setBody(t.body) }
  }

  function insertField(key: string) {
    const token = `{{${key}}}`
    const el = lastFocus.current === 'subject' ? subjectRef.current : bodyRef.current
    const value = lastFocus.current === 'subject' ? subject : body
    const set = lastFocus.current === 'subject' ? setSubject : setBody
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    set(value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + token.length, start + token.length) })
  }

  async function saveAsTemplate(asNew: boolean) {
    setError(null)
    try {
      const name = asNew ? (naming ?? '').trim() : template!.name
      if (!name) { setError('Give the template a name.'); return }
      const id = await saveTemplate({ id: asNew ? undefined : template!.id, name, kind, subject, body })
      await reloadTemplates()
      setTemplateId(id)
      setNaming(null)
      show(asNew ? `Saved as template “${name}”.` : `Template “${name}” updated.`)
    } catch (e) { setError((e as Error).message) }
  }

  async function removeTemplate() {
    if (!template || !window.confirm(`Delete the template “${template.name}”? Messages already sent aren’t affected.`)) return
    try { await deleteTemplate(template.id); setTemplateId(''); await reloadTemplates() } catch (e) { setError((e as Error).message) }
  }

  function show(msg: ReactNode) {
    setFlash(msg)
    window.setTimeout(() => setFlash(null), 10000)
  }

  // Recipients
  const chosen = staff.filter(e => picked.has(e.id))
  const optedOut = kind === 'greeting' ? chosen.filter(e => e.no_celebrations) : []
  const willSend = chosen.length - optedOut.length
  const previewPerson = staff.find(e => e.id === previewId && picked.has(e.id)) ?? chosen[0] ?? staff[0]

  // Checks
  const fields = usedFields(subject, body)
  const missing = blanks(chosen.filter(e => !optedOut.includes(e)), fields.known, company)
  const problem = !subject.trim() ? 'Write a subject.'
    : !body.trim() ? 'Write a message.'
    : fields.unknown.length ? `Fix the unknown field${fields.unknown.length > 1 ? 's' : ''}: ${fields.unknown.map(f => `{{${f}}}`).join(', ')}`
    : !chosen.length ? 'Pick who gets it.'
    : willSend === 0 ? 'Everyone picked has opted out of greetings.'
    : null

  async function send() {
    setSending(true)
    setError(null)
    try {
      const r = await sendMail({ kind, subject, body, employee_ids: chosen.map(e => e.id) })
      setConfirming(false)
      show(resultText(r))
      setHistoryKey(k => k + 1)
      if (r.failed === 0) { setPicked(new Set()); setSubject(''); setBody(''); setTemplateId('') }
    } catch (e) {
      setError((e as Error).message)
      setHistoryKey(k => k + 1)
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>Mail</h1>
        <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
          Send an update or a greeting. Each person gets their own email, with their name and details filled in.
        </p>
      </div>

      {flash && <div style={successBox}>{flash}</div>}
      {error && <div style={errorBox}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: '1.25rem', alignItems: 'start' }}>
        {/* ── Message ── */}
        <section style={card} aria-label="Message">
          <h2 style={sectionHeading}>1. Message</h2>

          <div role="radiogroup" aria-label="Type" style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
            <KindButton active={kind === 'update'} onClick={() => setKind('update')} Icon={Megaphone} label="Update" hint="Goes to everyone picked" />
            <KindButton active={kind === 'greeting'} onClick={() => setKind('greeting')} Icon={PartyPopper} label="Greeting" hint="Skips anyone who opted out" />
          </div>

          <label style={labelStyle} htmlFor="mail-template">Start from a template</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
            <select id="mail-template" value={templateId} onChange={e => applyTemplate(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="">— None —</option>
              {(['greeting', 'update'] as const).map(k => (
                <optgroup key={k} label={k === 'greeting' ? 'Greetings' : 'Updates'}>
                  {templates.filter(t => t.kind === k).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
              ))}
            </select>
            {template && <button type="button" onClick={removeTemplate} style={{ ...ghostBtn, color: '#dc2626', borderColor: '#fecaca' }}>Delete</button>}
          </div>

          <label style={labelStyle} htmlFor="mail-subject">Subject</label>
          <input id="mail-subject" ref={subjectRef} value={subject} maxLength={200}
            onChange={e => setSubject(e.target.value)} onFocus={() => { lastFocus.current = 'subject' }}
            placeholder="e.g. Office closed on Monday" style={{ ...inputStyle, marginBottom: '1rem' }} />

          <label style={labelStyle} htmlFor="mail-body">Message</label>
          <textarea id="mail-body" ref={bodyRef} value={body} maxLength={20000} rows={12}
            onChange={e => setBody(e.target.value)} onFocus={() => { lastFocus.current = 'body' }}
            placeholder={'Dear {{first_name}},\n\n…'} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          <p style={hintStyle}>Leave a blank line between paragraphs. **Two stars** make text bold. Links become clickable.</p>

          <div style={{ marginTop: '0.875rem' }}>
            <span style={{ ...labelStyle, marginBottom: 6 }}>Insert a personal detail</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {MERGE_FIELDS.map(f => (
                <button key={f.key} type="button" onMouseDown={e => e.preventDefault()} onClick={() => insertField(f.key)} style={chip}
                  title={`Inserts {{${f.key}}}`}>
                  + {f.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '1.25rem', alignItems: 'center' }}>
            {template && templateChanged && <button type="button" onClick={() => saveAsTemplate(false)} style={ghostBtn}>Save changes to “{template.name}”</button>}
            {naming === null ? (
              <button type="button" onClick={() => setNaming('')} disabled={!subject.trim() || !body.trim()} style={ghostBtn}>Save as new template</button>
            ) : (
              <>
                <input autoFocus value={naming} onChange={e => setNaming(e.target.value)} maxLength={80} placeholder="Template name"
                  onKeyDown={e => { if (e.key === 'Enter') saveAsTemplate(true); if (e.key === 'Escape') setNaming(null) }}
                  style={{ ...inputStyle, width: 200, padding: '0.375rem 0.625rem', fontSize: '0.875rem' }} />
                <button type="button" onClick={() => saveAsTemplate(true)} style={ghostBtn}>Save</button>
                <button type="button" onClick={() => setNaming(null)} style={{ ...ghostBtn, border: 'none' }}>Cancel</button>
              </>
            )}
          </div>
        </section>

        {/* ── Recipients ── */}
        <Recipients staff={staff} loading={loading} picked={picked} setPicked={setPicked} kind={kind} today={today} />
      </div>

      {/* ── Preview and send ── */}
      <section style={{ ...card, marginTop: '1.25rem' }} aria-label="Preview and send">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <h2 style={{ ...sectionHeading, margin: 0 }}>3. Preview and send</h2>
          {previewPerson && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.875rem', color: '#475569', marginLeft: 'auto' }}>
              Preview as
              <select value={previewPerson.id} onChange={e => setPreviewId(e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '0.375rem 0.5rem', fontSize: '0.875rem' }}>
                {(chosen.length ? chosen : staff).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </label>
          )}
        </div>

        {previewPerson && (subject || body) ? (
          <EmailPreview person={previewPerson} kind={kind} subject={subject} body={body} company={company} color={branding.primary_color} />
        ) : (
          <p style={{ ...hintStyle, fontSize: '0.875rem' }}>Write a message to see how it will look.</p>
        )}

        {(missing.length > 0 || optedOut.length > 0) && (
          <ul style={{ margin: '1rem 0 0', padding: '0.75rem 0.75rem 0.75rem 1.75rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e', fontSize: '0.8125rem', lineHeight: 1.6 }}>
            {missing.map(m => (
              <li key={m.field}>
                {listNames(m.names)} {m.names.length === 1 ? 'has' : 'have'} no {MERGE_FIELDS.find(f => f.key === m.field)!.label.toLowerCase()}, so that part will be blank for {m.names.length === 1 ? 'them' : 'those people'}.
              </li>
            ))}
            {optedOut.length > 0 && <li>{listNames(optedOut.map(e => e.full_name))} opted out of celebrations and won’t get this greeting.</li>}
          </ul>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
          {!confirming ? (
            <>
              <button type="button" onClick={() => setConfirming(true)} disabled={!!problem} style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: problem ? 0.5 : 1, cursor: problem ? 'not-allowed' : 'pointer' }}>
                <Send size={16} aria-hidden="true" /> Send to {willSend} {willSend === 1 ? 'person' : 'people'}
              </button>
              {problem && <span style={{ fontSize: '0.875rem', color: '#64748b' }}>{problem}</span>}
            </>
          ) : (
            <>
              <span style={{ fontSize: '0.9375rem', color: '#1e293b' }}>
                Send <b>{willSend}</b> separate email{willSend === 1 ? '' : 's'}? This can’t be undone.
              </span>
              <button type="button" onClick={send} disabled={sending} style={primaryBtn}>{sending ? 'Sending…' : 'Yes, send'}</button>
              <button type="button" onClick={() => setConfirming(false)} disabled={sending} style={ghostBtn}>Cancel</button>
            </>
          )}
        </div>
      </section>

      <History key={historyKey} onResult={r => show(resultText(r))} onError={setError} />
    </div>
  )
}

function resultText(r: SendResult) {
  const parts = [`${r.sent} sent`]
  if (r.failed) parts.push(`${r.failed} failed`)
  if (r.skipped) parts.push(`${r.skipped} skipped`)
  return r.failed
    ? <>Done: {parts.join(', ')}. See the failed ones in History below and use <b>Retry failed</b>.</>
    : <>Done: {parts.join(', ')}.</>
}

function listNames(names: string[]) {
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

function KindButton({ active, onClick, Icon, label, hint }: { active: boolean; onClick: () => void; Icon: typeof Megaphone; label: string; hint: string }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick} style={{
      flex: 1, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '0.625rem 0.75rem', borderRadius: 10, cursor: 'pointer',
      border: `1.5px solid ${active ? 'var(--brand-600)' : '#e2e8f0'}`, background: active ? 'var(--brand-50)' : '#fff', fontFamily: 'inherit',
    }}>
      <Icon size={20} aria-hidden="true" style={{ color: active ? 'var(--brand-600)' : '#94a3b8', flexShrink: 0 }} />
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <b style={{ fontSize: '0.875rem', color: '#1e293b' }}>{label}</b>
        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{hint}</span>
      </span>
    </button>
  )
}

// ── Recipients ───────────────────────────────────────────────

function Recipients({ staff, loading, picked, setPicked, kind, today }: {
  staff: Employee[]; loading: boolean; picked: Set<string>; setPicked: (s: Set<string>) => void; kind: MailKind; today: string
}) {
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const departments = [...new Set(staff.map(e => e.department).filter((d): d is string => !!d))].sort()
  const soon = occasionsBetween(staff, today, addDays(today, 7))
  const occasionOf = new Map<string, string>()
  for (const o of soon) {
    const when = o.date === today ? 'today' : fmtOccasion(o.date, false)
    const what = o.kind === 'birthday' ? `Birthday ${when}` : `${o.years}-year anniversary ${when}`
    occasionOf.set(o.employee.id, occasionOf.has(o.employee.id) ? `${occasionOf.get(o.employee.id)} · ${what}` : what)
  }
  const todays = soon.filter(o => o.date === today)

  const needle = q.trim().toLowerCase()
  const shown = staff.filter(e => (!dept || e.department === dept) && (!needle
    || [e.full_name, e.email, e.designation, e.department, e.employee_code].some(v => v?.toLowerCase().includes(needle))))
  const allShown = shown.length > 0 && shown.every(e => picked.has(e.id))

  const toggle = (id: string) => { const s = new Set(picked); if (s.has(id)) s.delete(id); else s.add(id); setPicked(s) }
  const setMany = (ids: string[], on: boolean) => { const s = new Set(picked); ids.forEach(id => on ? s.add(id) : s.delete(id)); setPicked(s) }

  return (
    <section style={card} aria-label="Recipients">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: '1rem' }}>
        <h2 style={{ ...sectionHeading, margin: 0 }}>2. Who gets it</h2>
        <span style={{ fontSize: '0.875rem', color: '#64748b' }}>{picked.size} picked</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.75rem' }}>
        <button type="button" style={chip} onClick={() => setPicked(new Set(staff.map(e => e.id)))}>Everyone ({staff.length})</button>
        {kind === 'greeting' && todays.length > 0 && (
          <button type="button" style={{ ...chip, background: '#fdf2f8', borderColor: '#fbcfe8', color: '#9d174d' }}
            onClick={() => setPicked(new Set(todays.map(o => o.employee.id)))}>
            <Cake size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Celebrating today ({new Set(todays.map(o => o.employee.id)).size})
          </button>
        )}
        {picked.size > 0 && <button type="button" style={chip} onClick={() => setPicked(new Set())}>Clear</button>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 180px' }}>
          <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, role…" aria-label="Search employees"
            style={{ ...inputStyle, paddingLeft: 32, fontSize: '0.875rem' }} />
        </div>
        {departments.length > 0 && (
          <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Department" style={{ ...inputStyle, flex: '0 1 180px', fontSize: '0.875rem' }}>
            <option value="">All departments</option>
            {departments.map(d => <option key={d}>{d}</option>)}
          </select>
        )}
      </div>

      {loading ? <p style={hintStyle}>Loading…</p> : shown.length === 0 ? <p style={hintStyle}>Nobody matches.</p> : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <label style={{ ...row, background: '#f8fafc', fontWeight: 600, color: '#475569' }}>
            <input type="checkbox" checked={allShown} onChange={() => setMany(shown.map(e => e.id), !allShown)} />
            {allShown ? 'Untick' : 'Tick'} all {shown.length} shown
          </label>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {shown.map(e => (
              <label key={e.id} style={row}>
                <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', color: '#1e293b', fontWeight: 500 }}>
                    {e.full_name}
                    {kind === 'greeting' && e.no_celebrations && <span style={{ ...tag, background: '#f1f5f9', color: '#64748b' }}>Opted out</span>}
                    {occasionOf.has(e.id) && <span style={{ ...tag, background: '#fdf2f8', color: '#9d174d' }}>{occasionOf.get(e.id)}</span>}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[e.designation, e.department, e.email].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// ── Preview ──────────────────────────────────────────────────

/** Same layout as the email the function builds. */
function EmailPreview({ person, kind, subject, body, company, color }: {
  person: Employee; kind: MailKind; subject: string; body: string; company: string; color: string
}) {
  const v = mergeValues(person, company)
  const paragraphs = fillFields(body, v).trim().split(/\n\s*\n/)
  return (
    <div style={{ background: '#f4f6f8', borderRadius: 12, padding: '1rem' }}>
      <div style={{ fontSize: '0.8125rem', color: '#475569', marginBottom: '0.75rem', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
        <div><b>To:</b> {person.full_name} &lt;{person.email}&gt;</div>
        <div><b>Subject:</b> {fillFields(subject, v).replace(/\s+/g, ' ').trim() || <i style={{ color: '#94a3b8' }}>No subject</i>}</div>
      </div>
      <div style={{ maxWidth: 560, margin: '0 auto', background: '#fff', borderRadius: 12, overflow: 'hidden', fontSize: 15, lineHeight: 1.6, color: '#1f2937', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        {kind === 'greeting'
          ? <div style={{ background: color, padding: '22px 28px', color: '#fff', fontSize: 26, textAlign: 'center' }}>🎉 🎂 🎉</div>
          : <div style={{ background: color, padding: '14px 28px', color: '#fff', fontSize: 14, fontWeight: 700, letterSpacing: '.04em' }}>{company}</div>}
        <div style={{ padding: '28px 28px 12px', overflowWrap: 'anywhere' }}>
          {paragraphs.map((p, i) => <p key={i} style={{ margin: '0 0 16px' }}>{rich(p)}</p>)}
        </div>
      </div>
      <p style={{ maxWidth: 560, margin: '10px auto 0', fontSize: 12, color: '#94a3b8' }}>Sent to {person.full_name} by {company}. Reply to this email to reach HR.</p>
    </div>
  )
}

/** **bold**, links and line breaks, like the email. */
function rich(text: string): ReactNode[] {
  return text.split('\n').flatMap((line, li) => {
    const parts: ReactNode[] = li ? [<br key={`br${li}`} />] : []
    line.split(/(\*\*.+?\*\*)/g).forEach((seg, si) => {
      if (/^\*\*.+\*\*$/.test(seg)) { parts.push(<b key={`${li}-${si}`}>{seg.slice(2, -2)}</b>); return }
      seg.split(/(\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"])/g).forEach((s, k) => {
        parts.push(/^https?:\/\//.test(s)
          ? <a key={`${li}-${si}-${k}`} href={s} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{s}</a>
          : <Fragment key={`${li}-${si}-${k}`}>{s}</Fragment>)
      })
    })
    return parts
  })
}

// ── History ──────────────────────────────────────────────────

function History({ onResult, onError }: { onResult: (r: SendResult) => void; onError: (msg: string) => void }) {
  const [campaigns, setCampaigns] = useState<MailCampaign[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<MailRecipient[] | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)

  const load = useCallback(() => loadCampaigns().then(setCampaigns).catch(e => { setCampaigns([]); onError(e.message) }), [onError])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    setRecipients(null)
    if (open) loadRecipients(open).then(setRecipients).catch(e => onError(e.message))
  }, [open, onError])

  async function retry(id: string) {
    setRetrying(id)
    try {
      onResult(await retryMail(id))
      await load()
      if (open === id) setRecipients(await loadRecipients(id))
    } catch (e) { onError((e as Error).message) }
    setRetrying(null)
  }

  return (
    <section style={{ ...card, marginTop: '1.25rem' }} aria-label="History">
      <h2 style={sectionHeading}>History</h2>
      {campaigns === null ? <p style={hintStyle}>Loading…</p> : campaigns.length === 0 ? (
        <p style={{ ...hintStyle, fontSize: '0.875rem' }}>Nothing sent yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {campaigns.map(c => {
            const isOpen = open === c.id
            return (
              <div key={c.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 0', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 260px', minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                    {isOpen ? <ChevronDown size={16} aria-hidden="true" color="#64748b" /> : <ChevronRight size={16} aria-hidden="true" color="#64748b" />}
                    <span style={{ ...tag, marginLeft: 0, ...(c.kind === 'greeting' ? { background: '#fdf2f8', color: '#9d174d' } : { background: '#eff6ff', color: '#1d4ed8' }) }}>
                      {c.kind === 'greeting' ? 'Greeting' : 'Update'}
                    </span>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e293b', fontWeight: 500, fontSize: '0.875rem' }}>{c.subject}</span>
                  </button>
                  <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                    {new Date(c.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span style={{ fontSize: '0.8125rem', display: 'flex', gap: 8 }}>
                    <span style={{ color: '#166534' }}>{c.sent_count} sent</span>
                    {c.failed_count > 0 && <span style={{ color: '#dc2626' }}>{c.failed_count} failed</span>}
                    {c.skipped_count > 0 && <span style={{ color: '#64748b' }}>{c.skipped_count} skipped</span>}
                    {!c.finished_at && <span style={{ color: '#b45309' }}>sending…</span>}
                  </span>
                  {c.failed_count > 0 && (
                    <button type="button" onClick={() => retry(c.id)} disabled={retrying !== null} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <RotateCw size={14} aria-hidden="true" /> {retrying === c.id ? 'Retrying…' : 'Retry failed'}
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div style={{ padding: '0 0 1rem 1.5rem' }}>
                    {recipients === null ? <p style={hintStyle}>Loading…</p> : (
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: '0.8125rem' }}>
                        {recipients.map(r => (
                          <li key={r.id} style={{ display: 'flex', gap: 8, padding: '4px 0', flexWrap: 'wrap', alignItems: 'baseline' }}>
                            <span style={{ ...tag, marginLeft: 0, ...STATUS_TAG[r.status] }}>{r.status}</span>
                            <span style={{ color: '#1e293b' }}>{r.full_name}</span>
                            <span style={{ color: '#94a3b8', overflowWrap: 'anywhere' }}>{r.email}</span>
                            {r.error && <span style={{ color: r.status === 'failed' ? '#dc2626' : '#64748b' }}>— {r.error}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

const STATUS_TAG: Record<MailRecipient['status'], CSSProperties> = {
  sent:    { background: '#dcfce7', color: '#166534' },
  failed:  { background: '#fee2e2', color: '#991b1b' },
  skipped: { background: '#f1f5f9', color: '#64748b' },
  pending: { background: '#fef9c3', color: '#854d0e' },
}

const labelStyle: CSSProperties = { display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: 4 }
const chip: CSSProperties = { padding: '0.25rem 0.625rem', background: '#fff', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 999, fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit' }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '0.5rem 0.75rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.875rem', cursor: 'pointer' }
const tag: CSSProperties = { display: 'inline-block', marginLeft: 6, padding: '1px 8px', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600, verticalAlign: 'middle', textTransform: 'capitalize' }
