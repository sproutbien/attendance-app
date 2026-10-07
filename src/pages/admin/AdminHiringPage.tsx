import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, FileSignature, FileText, Paperclip } from 'lucide-react'
import { useCandidates } from '../../hooks/useCandidates'
import type { CandidateFields } from '../../hooks/useCandidates'
import { useEmployeeManagement, useEmployeeOptions } from '../../hooks/useEmployeeManagement'
import type { EmployeeFormData } from '../../hooks/useEmployeeManagement'
import { useShifts } from '../../hooks/useShifts'
import { supabase } from '../../lib/supabase'
import { LEAVE_DOC_ACCEPT, fmtBytes, leaveDocProblem } from '../../lib/leaveDocs'
import { fmtDate } from '../../lib/employees'
import {
  OPEN_STAGES, STAGE_COLORS, STAGE_LABELS, ageLabel, copyResumeToEmployee, nextStage, openResume,
} from '../../lib/hiring'
import { fmtClock } from '../../lib/shifts'
import { localDate } from '../../lib/calendar'
import { uploadEmployeeDocument } from '../../lib/onboarding'
import { OFFER_BUCKET, OFFER_STATUS, offerFileName, shownStatus } from '../../lib/offerLetter'
import type { Offer } from '../../lib/offerLetter'
import EmployeeFormModal from '../../components/employees/EmployeeFormModal'
import OfferLetterModal from '../../components/offers/OfferLetterModal'
import {
  card, errorBox, ghostBtn, hintStyle, inputStyle, modalStyle, overlayStyle, primaryBtn, successBox,
} from '../../components/employees/styles'
import type { Candidate, CandidateStage } from '../../types'

/** Admin: candidates by stage; Hire turns one into an employee with onboarding started. */
export default function AdminHiringPage() {
  const c = useCandidates()
  const mgmt = useEmployeeManagement()
  const lists = useEmployeeOptions()
  const shifts = useShifts()
  const [open, setOpen] = useState<Candidate | 'new' | null>(null)
  const [hiring, setHiring] = useState<Candidate | null>(null)
  const [flash, setFlash] = useState<React.ReactNode>(null)
  const [showClosed, setShowClosed] = useState<'hired' | 'not_selected' | null>(null)
  const [offerFor, setOfferFor] = useState<Candidate | null>(null)
  const offers = useLatestOffers()
  const today = localDate()
  const workingHours = shifts.defaultShift
    ? `Monday to Saturday, ${fmtClock(shifts.defaultShift.start_time)} to ${fmtClock(shifts.defaultShift.end_time)}`
    : ''

  const byStage = (s: CandidateStage) => c.candidates.filter(x => x.stage === s)
  const openCount = c.candidates.filter(x => OPEN_STAGES.includes(x.stage)).length
  const current = open && open !== 'new' ? c.candidates.find(x => x.id === open.id) ?? null : null

  function show(msg: React.ReactNode) {
    setFlash(msg)
    setTimeout(() => setFlash(null), 8000)
  }

  async function hire(cand: Candidate, data: EmployeeFormData) {
    const id = await mgmt.addEmployee(data)
    if (!id) return   // the form shows the error
    setHiring(null)
    setOpen(null)
    const problems: string[] = []
    if (data.shift) {
      const err = await shifts.assign(id, data.shift.id, data.shift.from)
      if (err) problems.push(`the shift wasn't set (${err})`)
    }
    if (data.startOnboarding) {
      const { error } = await supabase.rpc('start_onboarding', { p_employee: id })
      if (error) problems.push(`onboarding wasn't started (${error.message})`)
    }
    try { await copyResumeToEmployee(cand, id) } catch (e) { problems.push((e as Error).message) }
    const accepted = offers.latest.get(cand.id)
    if (accepted?.status === 'accepted' && accepted.pdf_path) {
      try { await copyOfferToEmployee(accepted, id) } catch (e) { problems.push((e as Error).message) }
    }
    const err = await c.update(cand.id, { stage: 'hired', employee_id: id })
    if (err) problems.push(`the candidate wasn't marked hired (${err})`)
    show(<>
      {data.full_name} is now an employee. <Link to={`/admin/employees/${id}`} style={{ color: '#166534', fontWeight: 600 }}>Open their profile</Link>
      {problems.length > 0 && <span style={{ display: 'block', color: '#b45309' }}>But {problems.join('; ')}.</span>}
    </>)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>Hiring</h1>
          {!c.loading && <span style={countChip}>{openCount} open</span>}
        </div>
        <button onClick={() => setOpen('new')} style={primaryBtn}>+ Add candidate</button>
      </div>

      {flash && <div style={successBox}>{flash}</div>}
      {c.error && <div style={errorBox}>{c.error}</div>}

      {c.loading ? <div style={{ ...card, color: '#94a3b8' }}>Loading…</div> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', alignItems: 'start' }}>
            {OPEN_STAGES.map(stage => {
              const list = byStage(stage)
              return (
                <section key={stage} aria-label={STAGE_LABELS[stage]} style={{ ...card, padding: '1rem', background: '#f8fafc' }}>
                  <h2 style={colHead}>
                    <span style={stagePillFor(stage)}>{STAGE_LABELS[stage]}</span>
                    <span style={{ color: '#94a3b8', fontWeight: 500 }}>{list.length}</span>
                  </h2>
                  {list.length === 0 ? <p style={{ ...hintStyle, margin: 0 }}>Nobody here.</p> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {list.map(x => (
                        <button key={x.id} onClick={() => setOpen(x)} style={candCard}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.full_name}</b>
                            {x.resume_path && <FileText size={14} aria-label="Has résumé" style={{ color: '#64748b', flexShrink: 0 }} />}
                          </span>
                          {x.role && <span style={{ color: '#475569' }}>{x.role}</span>}
                          {offers.latest.has(x.id) && <OfferChip offer={offers.latest.get(x.id)!} today={today} />}
                          <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                            {stage === 'applied' ? `Added ${ageLabel(x.created_at)}${ageLabel(x.created_at) === 'today' ? '' : ' ago'}` : `In ${STAGE_LABELS[stage]} ${ageLabel(x.stage_changed_at)}`}
                            {x.source && ` · ${x.source}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>

          {c.candidates.length === 0 && (
            <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '1rem' }}>
              Add candidates as they apply and move them along as you interview. When you hire someone, they become an employee
              with their details filled in and their onboarding checklist started.
            </p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
            {(['hired', 'not_selected'] as const).map(s => (
              <button key={s} onClick={() => setShowClosed(showClosed === s ? null : s)} aria-pressed={showClosed === s}
                style={{ ...ghostBtn, ...(showClosed === s ? { background: '#f1f5f9', borderColor: '#cbd5e1' } : null) }}>
                {STAGE_LABELS[s]} ({byStage(s).length})
              </button>
            ))}
          </div>
          {showClosed && (
            <div style={{ ...card, marginTop: '0.75rem', padding: '0.75rem 1.25rem' }}>
              {byStage(showClosed).length === 0 ? <p style={{ ...hintStyle, margin: '0.5rem 0' }}>Nobody yet.</p>
                : byStage(showClosed).map(x => (
                  <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.875rem', flexWrap: 'wrap' }}>
                    <button onClick={() => setOpen(x)} style={{ ...linkBtn, fontWeight: 600 }}>{x.full_name}</button>
                    <span style={{ color: '#64748b', flex: 1 }}>{x.role}</span>
                    <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{fmtDate(new Date(x.stage_changed_at))}</span>
                    {x.stage === 'hired' && x.employee_id && (
                      <Link to={`/admin/employees/${x.employee_id}`} style={{ color: 'var(--brand-700)', fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center' }}>
                        Profile <ChevronRight size={14} />
                      </Link>
                    )}
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      {open && !hiring && !offerFor && (
        <CandidateModal
          key={open === 'new' ? 'new' : open.id}
          candidate={open === 'new' ? null : current}
          data={c}
          onClose={() => setOpen(null)}
          onCreated={x => setOpen(x)}
          onHire={x => { mgmt.setError(null); setHiring(x) }}
          onOffer={x => setOfferFor(x)}
          offer={current ? offers.latest.get(current.id) ?? null : null}
        />
      )}

      {offerFor && (
        <OfferLetterModal
          candidate={offerFor}
          workingHours={workingHours}
          onClose={() => setOfferFor(null)}
          onChanged={() => { offers.reload(); c.refresh() }}
        />
      )}

      {hiring && (
        <EmployeeFormModal
          existing={null}
          prefill={{
            full_name: hiring.full_name, email: hiring.email ?? '', phone: hiring.phone ?? '', status: 'probation',
            designation: (offers.latest.get(hiring.id)?.status === 'accepted' ? offers.latest.get(hiring.id)!.fields.designation : null) ?? hiring.role,
          }}
          isSelf={false}
          employees={mgmt.employees}
          options={{ department: lists.byKind('department'), work_location: lists.byKind('work_location'), employment_type: lists.byKind('employment_type') }}
          shifts={shifts.shifts}
          currentShift={shifts.defaultShift}
          upcomingShift={null}
          designations={[...new Set(mgmt.employees.map(e => e.designation).filter((d): d is string => !!d))].sort()}
          saving={mgmt.saving}
          error={mgmt.error}
          onSave={data => hire(hiring, data)}
          onClose={() => setHiring(null)}
        />
      )}
    </div>
  )
}

function CandidateModal({ candidate, data, onClose, onCreated, onHire, onOffer, offer }: {
  candidate: Candidate | null        // null = add
  data: ReturnType<typeof useCandidates>
  onClose: () => void
  onCreated: (c: Candidate) => void
  onHire: (c: Candidate) => void
  onOffer: (c: Candidate) => void
  offer: Offer | null                // their latest offer letter
}) {
  const s = (v: string | null | undefined) => v ?? ''
  const [f, setF] = useState({
    full_name: s(candidate?.full_name), role: s(candidate?.role), email: s(candidate?.email),
    phone: s(candidate?.phone), source: s(candidate?.source), notes: s(candidate?.notes),
  })
  const [resume, setResume] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF(p => ({ ...p, [k]: e.target.value })); setError(null) }

  const fields = (): CandidateFields => ({
    full_name: f.full_name.trim(), role: f.role.trim() || null, email: f.email.trim().toLowerCase() || null,
    phone: f.phone.trim() || null, source: f.source.trim() || null, notes: f.notes,
  })
  const dirty = !candidate || JSON.stringify(fields()) !== JSON.stringify({
    full_name: candidate.full_name, role: candidate.role, email: candidate.email, phone: candidate.phone, source: candidate.source, notes: candidate.notes,
  })

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    if (!candidate) {
      const r = await data.add(fields(), resume)
      setBusy(false)
      if (typeof r === 'string') setError(r)
      else onCreated(r)
      return
    }
    const err = await data.update(candidate.id, fields())
    setBusy(false)
    setError(err)
  }

  async function act(fn: () => Promise<string | null>) {
    setBusy(true)
    setError(await fn())
    setBusy(false)
  }

  function pickResume(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    const problem = leaveDocProblem(file)
    if (problem) return setError(problem)
    if (candidate) act(() => data.setResume(candidate, file))
    else setResume(file)
  }

  const next = candidate ? nextStage(candidate.stage) : null
  const isOpen = candidate && OPEN_STAGES.includes(candidate.stage)

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ ...modalStyle, maxWidth: 560 }} role="dialog" aria-modal="true" aria-labelledby="cand-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <h2 id="cand-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b', flex: 1 }}>
            {candidate ? candidate.full_name : 'Add candidate'}
          </h2>
          {candidate && <span style={stagePillFor(candidate.stage)}>{STAGE_LABELS[candidate.stage]}</span>}
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>

        {candidate && offer && (
          <p style={{ margin: '-0.25rem 0 0.75rem', fontSize: '0.8125rem', color: '#475569' }}>
            Offer {offer.ref_no}: <OfferChip offer={offer} today={localDate()} />
            {offer.status === 'accepted' && ' · Hire them to add the signed letter to their documents.'}
          </p>
        )}
        {candidate && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid #e2e8f0' }}>
            {isOpen && next && (
              <button disabled={busy} onClick={() => act(() => data.update(candidate.id, { stage: next }))} style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                Move to {STAGE_LABELS[next]} <ChevronRight size={16} />
              </button>
            )}
            {(isOpen || offer) && (
              <button disabled={busy} onClick={() => onOffer(candidate)}
                style={{ ...(candidate.stage === 'offer' && !offer ? primaryBtn : ghostBtn), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FileSignature size={15} /> {offer ? 'Offer letter' : 'Offer letter…'}
              </button>
            )}
            {isOpen && (
              <button disabled={busy} onClick={() => onHire(candidate)} style={candidate.stage === 'offer' && offer?.status === 'accepted' ? primaryBtn : ghostBtn}>Hire…</button>
            )}
            {isOpen && (
              <button disabled={busy} onClick={() => act(() => data.update(candidate.id, { stage: 'not_selected' }))} style={{ ...ghostBtn, color: '#b91c1c', borderColor: '#fecaca' }}>
                Not selected
              </button>
            )}
            {candidate.stage === 'not_selected' && (
              <button disabled={busy} onClick={() => act(() => data.update(candidate.id, { stage: 'applied' }))} style={ghostBtn}>Reopen</button>
            )}
            {candidate.stage === 'hired' && candidate.employee_id && (
              <Link to={`/admin/employees/${candidate.employee_id}`} style={{ ...primaryBtn, textDecoration: 'none' }}>Open employee profile</Link>
            )}
            {isOpen && (
              <select value={candidate.stage} disabled={busy} aria-label="Stage"
                onChange={e => act(() => data.update(candidate.id, { stage: e.target.value as CandidateStage }))}
                style={{ ...inputStyle, width: 'auto', fontSize: '0.8125rem', padding: '0.375rem 0.5rem', marginLeft: 'auto' }}>
                {OPEN_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
            )}
          </div>
        )}

        <form onSubmit={save}>
          <div style={grid}>
            <Field label="Full name">
              <input value={f.full_name} onChange={set('full_name')} required maxLength={120} style={inputStyle} />
            </Field>
            <Field label="Role applied for">
              <input value={f.role} onChange={set('role')} maxLength={120} placeholder="e.g. Frontend Developer" style={inputStyle} />
            </Field>
            <Field label="Email">
              <input type="email" value={f.email} onChange={set('email')} maxLength={200} style={inputStyle} />
            </Field>
            <Field label="Phone">
              <input type="tel" value={f.phone} onChange={set('phone')} maxLength={40} placeholder="+91 98765 43210" style={inputStyle} />
            </Field>
          </div>
          <Field label="Source (optional)">
            <input value={f.source} onChange={set('source')} maxLength={80} list="cand-sources" placeholder="e.g. Referral, LinkedIn, Walk-in" style={inputStyle} />
            <datalist id="cand-sources">
              {['Referral', 'LinkedIn', 'Naukri', 'Indeed', 'Walk-in', 'Campus'].map(x => <option key={x} value={x} />)}
            </datalist>
          </Field>
          <Field label="Notes">
            <textarea value={f.notes} onChange={set('notes')} rows={4} maxLength={5000} placeholder="Interview feedback, salary expectations, notice period…"
              style={{ ...inputStyle, resize: 'vertical', fontSize: '0.875rem' }} />
          </Field>

          <Field label="Résumé">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {candidate?.resume_path ? (
                <button type="button" onClick={async () => { const e = await openResume(candidate); if (e) setError(e) }}
                  style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <FileText size={15} /> {candidate.resume_name} <span style={{ color: '#94a3b8', fontWeight: 400 }}>{candidate.resume_size ? fmtBytes(candidate.resume_size) : ''}</span>
                </button>
              ) : resume ? (
                <span style={{ fontSize: '0.875rem', color: '#1e293b', display: 'inline-flex', alignItems: 'center', gap: 6 }}><FileText size={15} /> {resume.name}</span>
              ) : null}
              <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Paperclip size={14} /> {candidate?.resume_path || resume ? 'Replace' : 'Attach'}
              </button>
              <span style={{ ...hintStyle, margin: 0 }}>PDF, PNG, JPEG or Word · 10 MB</span>
            </div>
            <input ref={fileInput} type="file" accept={LEAVE_DOC_ACCEPT} hidden onChange={e => { pickResume(e.target.files); e.target.value = '' }} />
          </Field>

          {error && <div style={errorBox}>{error}</div>}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {candidate && (confirmDelete ? (
              <>
                <button type="button" disabled={busy} onClick={async () => { const e = await data.remove(candidate); if (e) setError(e); else onClose() }}
                  style={{ ...ghostBtn, color: '#fff', background: '#dc2626', borderColor: '#dc2626' }}>Delete for good</button>
                <button type="button" onClick={() => setConfirmDelete(false)} style={ghostBtn}>Keep</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...ghostBtn, color: '#dc2626', borderColor: '#fecaca' }}>Delete</button>
            ))}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={onClose} style={ghostBtn}>{candidate ? 'Close' : 'Cancel'}</button>
            {dirty && (
              <button type="submit" disabled={busy || !f.full_name.trim()} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Saving…' : candidate ? 'Save changes' : 'Add candidate'}
              </button>
            )}
          </div>
          {candidate && confirmDelete && <p style={hintStyle}>Removes the candidate and their résumé. Use this for people who asked to be forgotten.</p>}
        </form>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.875rem' }}>
      <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, marginBottom: '0.375rem', color: '#374151' }}>{label}</label>
      {children}
    </div>
  )
}

const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', columnGap: '0.875rem' }
const countChip: CSSProperties = { background: '#f1f5f9', color: '#64748b', fontSize: '0.8125rem', fontWeight: 600, padding: '2px 10px', borderRadius: 99 }
const colHead: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 0.75rem', fontSize: '0.875rem' }
const stagePill: CSSProperties = { padding: '2px 10px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 700 }
const stagePillFor = (s: CandidateStage): CSSProperties => ({ ...stagePill, background: STAGE_COLORS[s].bg, color: STAGE_COLORS[s].text })
const candCard: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 2, width: '100%', textAlign: 'left', padding: '0.625rem 0.75rem',
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem', color: '#1e293b',
}
const linkBtn: CSSProperties = { padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--brand-700)', fontSize: '0.875rem', fontFamily: 'inherit', textAlign: 'left' }

/** Each candidate's latest offer letter. */
function useLatestOffers() {
  const [latest, setLatest] = useState<Map<string, Offer>>(new Map())
  const reload = useCallback(async () => {
    const { data } = await supabase.from('offers').select('*').order('approved_at', { ascending: false })
    const m = new Map<string, Offer>()
    for (const o of (data ?? []) as Offer[]) if (!m.has(o.candidate_id)) m.set(o.candidate_id, o)
    setLatest(m)
  }, [])
  useEffect(() => { reload() }, [reload])
  return { latest, reload }
}

function OfferChip({ offer, today }: { offer: Offer; today: string }) {
  const s = OFFER_STATUS[shownStatus(offer, today)]
  return <span style={{ ...stagePill, alignSelf: 'flex-start', fontSize: '0.6875rem', background: s.bg, color: s.text }}>Offer {s.label.toLowerCase()}</span>
}

/** After hiring: the accepted offer letter becomes one of their documents ("Offer letter"). */
async function copyOfferToEmployee(o: Offer, employeeId: string) {
  const { data, error } = await supabase.storage.from(OFFER_BUCKET).download(o.pdf_path!)
  if (error || !data) throw new Error(`The offer letter couldn't be copied to their documents: ${error?.message ?? 'not found'}`)
  await uploadEmployeeDocument(employeeId, 'Offer letter', new File([data], offerFileName(o), { type: 'application/pdf' }))
}
