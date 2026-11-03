import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Cake, Check, Clock, ImagePlus, PartyPopper, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { BLOCKED_STATUSES } from '../../lib/employees'
import { localDate } from '../../lib/calendar'
import { addDays } from '../../lib/leave'
import EmployeeAvatar from '../employees/EmployeeAvatar'
import {
  ADMIN_OPENS_DAYS, LATE_DAYS, PHOTO_ACCEPT, TEAM_OPENS_DAYS, adminRemoveWish, firstName, fmtOccasion,
  occasionTitle, photoLinks, photoProblem, repeatBetween, signCard,
} from '../../lib/celebrations'
import type { CelebrationKind } from '../../lib/celebrations'
import type { Employee } from '../../types'
import '../../styles/celebrations.css'

type Person = Pick<Employee, 'id' | 'full_name' | 'photo_path' | 'designation'>

export type AdminWish = {
  id: string
  author_id: string | null
  author_name: string
  from_admin: boolean
  message: string
  photo_path: string | null
  created_at: string
}

export type Occasion = {
  key: string                    // `${person id}|${kind}|${date}`
  person: Person
  kind: CelebrationKind
  years: number | null
  date: string
  celebrationId: string | null
  wishes: AdminWish[]
}

export const occasionKey = (personId: string, kind: CelebrationKind, date: string) => `${personId}|${kind}|${date}`

const DISMISSED_KEY = 'sb.missedCelebrationsDismissed'
function readDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') } catch { return [] }
}

/** Birthdays and anniversaries from 3 days ago to 30 days ahead, with what's been written. */
export function useAdminCelebrations() {
  const [occasions, setOccasions] = useState<Occasion[] | null>(null)
  const [teamSize, setTeamSize] = useState(0)

  const load = useCallback(async () => {
    const today = localDate()
    const from = addDays(today, -LATE_DAYS), to = addDays(today, ADMIN_OPENS_DAYS)
    const [emp, cel] = await Promise.all([
      supabase.from('employees').select('id, full_name, photo_path, designation, date_of_birth, joining_date, status, deleted_at, no_celebrations'),
      supabase.from('celebrations')
        .select('id, employee_id, kind, occasion_date, celebration_wishes(id, author_id, author_name, from_admin, message, photo_path, created_at)')
        .gte('occasion_date', from).lte('occasion_date', to),
    ])
    if (emp.error || cel.error) { setOccasions([]); return }   // e.g. migration 047 not run yet
    type Row = Person & Pick<Employee, 'date_of_birth' | 'joining_date' | 'status' | 'deleted_at'> & { no_celebrations: boolean }
    const people = (emp.data ?? []) as Row[]
    const active = people.filter(p => !p.deleted_at && !BLOCKED_STATUSES.includes(p.status))
    setTeamSize(active.length)
    const saved = new Map((cel.data ?? []).map(c => [occasionKey(c.employee_id, c.kind as CelebrationKind, c.occasion_date), c]))

    const list: Occasion[] = []
    for (const p of people) {
      if (p.deleted_at || p.no_celebrations || !['active', 'probation'].includes(p.status)) continue
      const add = (kind: CelebrationKind, date: string | null, years: number | null) => {
        if (!date) return
        const key = occasionKey(p.id, kind, date)
        const c = saved.get(key)
        list.push({
          key, kind, date, years, person: p,
          celebrationId: c?.id ?? null,
          wishes: ((c?.celebration_wishes ?? []) as AdminWish[]).sort((a, b) => a.created_at.localeCompare(b.created_at)),
        })
      }
      add('birthday', repeatBetween(p.date_of_birth, from, to), null)
      const ann = repeatBetween(p.joining_date, from, to)
      add('anniversary', ann, ann ? Number(ann.slice(0, 4)) - Number(p.joining_date!.slice(0, 4)) : null)
    }
    list.sort((a, b) => a.date.localeCompare(b.date) || a.person.full_name.localeCompare(b.person.full_name))
    setOccasions(list)
  }, [])

  useEffect(() => { load() }, [load])
  return { occasions, teamSize, reload: load }
}

function inDays(date: string) {
  const n = Math.round((new Date(date + 'T00:00:00').getTime() - new Date(localDate() + 'T00:00:00').getTime()) / 86400000)
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n < 0 ? `${-n} days ago` : `in ${n} days`
}

/** Admin home: reminders for the next 3 days and celebrations nobody marked. */
export function CelebrationAlerts({ occasions, teamSize, onWrite }: {
  occasions: Occasion[]
  teamSize: number
  onWrite: (o: Occasion) => void
}) {
  const { employee } = useAuth()
  const [dismissed, setDismissed] = useState(readDismissed)
  const today = localDate()
  const mine = (o: Occasion) => o.person.id === employee?.id
  const soon = occasions.filter(o => !mine(o) && o.date >= today && o.date <= addDays(today, TEAM_OPENS_DAYS))
  const missed = occasions.filter(o => !mine(o) && o.date < today && o.wishes.length === 0 && !dismissed.includes(o.key))

  function dismiss(key: string) {
    const next = [...dismissed, key].slice(-50)
    setDismissed(next)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  if (soon.length === 0 && missed.length === 0) return null
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      {soon.map(o => {
        const myWish = o.wishes.find(w => w.author_id === employee?.id)
        const team = o.wishes.filter(w => w.author_id !== employee?.id).length   // everyone else, other admins included
        const Icon = o.kind === 'birthday' ? Cake : PartyPopper
        return (
          <section key={o.key} className="cel-alert" aria-label={occasionTitle(o.person.full_name, o.kind, o.years)}>
            <span className="cel-alert-icon"><Icon size={24} aria-hidden="true" /></span>
            <div className="cel-alert-text">
              <strong>
                {o.kind === 'birthday' ? `${o.person.full_name}’s birthday` : `${o.person.full_name}’s ${o.years}-year work anniversary`}
                {' '}is {inDays(o.date) === 'today' ? 'today' : `on ${fmtOccasion(o.date)} — ${inDays(o.date)}`}
              </strong>
              <div className="cel-alert-meta">
                {myWish
                  ? <span><Check size={14} aria-hidden="true" style={{ color: '#1d5a1f' }} /> Your wish is ready</span>
                  : <span><Clock size={14} aria-hidden="true" style={{ color: '#9a5b00' }} /> Your wish: not written yet</span>}
                <span>Team card: {team} of {Math.max(teamSize - 2, 0)} signed</span>
              </div>
            </div>
            <button type="button" className={myWish ? 'cel-btn ghost' : 'cel-btn'} onClick={() => onWrite(o)}>
              {myWish ? 'See the card' : 'Write a wish'}
            </button>
          </section>
        )
      })}
      {missed.map(o => (
        <section key={o.key} className="cel-alert quiet" aria-label="Missed celebration">
          <AlertCircle size={18} aria-hidden="true" style={{ color: '#a3401a', flexShrink: 0 }} />
          <p style={{ margin: 0, flex: '1 1 280px', fontSize: 14 }}>
            <strong style={{ color: '#10261a' }}>
              {o.kind === 'birthday' ? `${o.person.full_name}’s birthday` : `${o.person.full_name}’s work anniversary`} was {inDays(o.date)}
            </strong> — nobody wished them in the app.
          </p>
          <button type="button" className="cel-btn ghost small" onClick={() => onWrite(o)}>Send a belated wish</button>
          <button type="button" className="cel-btn ghost small" style={{ border: 'none', color: '#64748b' }} onClick={() => dismiss(o.key)}>Dismiss</button>
        </section>
      ))}
    </div>
  )
}

const STARTERS: { label: string; text: (n: string, kind: CelebrationKind, years: number | null) => string }[] = [
  { label: 'Warm', text: (n, k, y) => k === 'birthday'
    ? `Happy birthday, ${n}! Thank you for everything you bring to the team. Wishing you a wonderful day and a great year ahead.`
    : `Happy ${y}-year anniversary, ${n}! Thank you for all your hard work and the energy you bring every day. We’re lucky to have you.` },
  { label: 'Short & sweet', text: (n, k) => k === 'birthday' ? `Happy birthday, ${n}! Have a fantastic day.` : `Happy work anniversary, ${n}! Here’s to many more.` },
  { label: 'Fun', text: (n, k) => k === 'birthday'
    ? `Happy birthday, ${n}! Today the only deadline is cake. Enjoy every bit of it!`
    : `Happy anniversary, ${n}! Another year of putting up with all of us — thank you!` },
  { label: 'Thank-you', text: (n, k) => `Dear ${n}, on your ${k === 'birthday' ? 'birthday' : 'work anniversary'} I wanted to say a big thank you for your work this year. It doesn’t go unnoticed. Have a great day!` },
]

/** Admin writes (or edits) their wish, and can see and tidy the team's card. */
export function WishModal({ occasion, onClose, onSaved }: { occasion: Occasion; onClose: () => void; onSaved: () => void }) {
  const { employee } = useAuth()
  const mine = occasion.wishes.find(w => w.author_id === employee?.id) ?? null
  const [message, setMessage] = useState(mine?.message ?? '')
  const [photo, setPhoto] = useState<File | null | undefined>(undefined)
  const [preview, setPreview] = useState<string | null>(null)
  const [links, setLinks] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const name = firstName(occasion.person.full_name)
  const others = occasion.wishes.filter(w => w.author_id !== employee?.id)
  const today = localDate()
  const canWrite = today >= addDays(occasion.date, -ADMIN_OPENS_DAYS) && today <= addDays(occasion.date, LATE_DAYS)

  useEffect(() => {
    photoLinks(occasion.wishes.map(w => w.photo_path)).then(m => {
      setLinks(m)
      if (mine?.photo_path) setPreview(m.get(mine.photo_path) ?? null)
    })
  }, [occasion, mine?.photo_path])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  async function save() {
    if (!employee) return
    if (!message.trim()) { setError('Write a message first.'); return }
    setBusy(true)
    setError(null)
    try {
      await signCard({
        employeeId: occasion.person.id, kind: occasion.kind, occasionDate: occasion.date,
        message, authorId: employee.id, currentPhoto: mine?.photo_path ?? null, photo,
      })
      onSaved()
      onClose()
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  async function moderate(w: AdminWish, photoOnly: boolean) {
    setBusy(true)
    setError(null)
    try { await adminRemoveWish(w.id, photoOnly); onSaved() } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  const teamOpens = addDays(occasion.date, -TEAM_OPENS_DAYS)
  return (
    <div className="cel-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cel-modal" role="dialog" aria-modal="true" aria-labelledby="cel-wish-title">
        <div className="cel-modal-head">
          <EmployeeAvatar employee={occasion.person} size={48} />
          <div>
            <h2 id="cel-wish-title">{occasion.kind === 'birthday' ? 'Birthday' : `${occasion.years}-year anniversary`} wish for {occasion.person.full_name}</h2>
            <p>{[occasion.person.designation, `${fmtOccasion(occasion.date)} · ${inDays(occasion.date)}`].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" className="cel-x" onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
        </div>

        {canWrite ? (
          <div className="cel-modal-body">
            <label htmlFor="cel-wish-text">Your message</label>
            <textarea id="cel-wish-text" value={message} maxLength={1000} onChange={e => setMessage(e.target.value)} placeholder={`Write something for ${name}…`} />
            <div className="cel-chips">
              <span>Start from:</span>
              {STARTERS.map(s => (
                <button key={s.label} type="button" onClick={() => setMessage(s.text(name, occasion.kind, occasion.years))}>{s.label}</button>
              ))}
            </div>
            <div className="cel-row">
              {preview ? (
                <span className="cel-thumb">
                  <img src={preview} alt="Photo to add" />
                  <button type="button" aria-label="Remove photo" onClick={() => { setPhoto(mine?.photo_path ? null : undefined); setPreview(null) }}><X size={14} aria-hidden="true" /></button>
                </span>
              ) : (
                <button type="button" className="cel-photo-pick" onClick={() => input.current?.click()}><ImagePlus size={17} aria-hidden="true" /> Add a photo (optional)</button>
              )}
              <input ref={input} type="file" accept={PHOTO_ACCEPT} hidden onChange={e => {
                const f = e.target.files?.[0]; e.target.value = ''
                if (!f) return
                const problem = photoProblem(f)
                if (problem) { setError(problem); return }
                setError(null); setPhoto(f); setPreview(URL.createObjectURL(f))
              }} />
            </div>
            {error && <p className="cel-err" role="alert">{error}</p>}
          </div>
        ) : (
          <div className="cel-modal-body"><p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>Wishes can be written from {ADMIN_OPENS_DAYS} days before until {LATE_DAYS} days after.</p></div>
        )}

        {canWrite && (
          <div className="cel-modal-foot">
            <p>
              {today < occasion.date ? `Shows when ${name} opens the app on ${fmtOccasion(occasion.date, false)}. You can edit it until then.` : `${name} will see it the next time they open the app.`}
            </p>
            <button type="button" className="cel-btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="cel-btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : mine ? 'Save changes' : 'Save wish'}</button>
          </div>
        )}

        <div className="cel-board">
          <h3>Team card · {others.length} message{others.length === 1 ? '' : 's'}</h3>
          {others.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              {today < teamOpens ? `Opens for the team on ${fmtOccasion(teamOpens, false)}.` : 'No messages yet.'}
            </p>
          ) : (
            <ul>
              {others.map(w => (
                <li key={w.id}>
                  {w.photo_path && links.get(w.photo_path) && (
                    <a href={links.get(w.photo_path)} target="_blank" rel="noreferrer"><img className="cel-board-photo" src={links.get(w.photo_path)} alt={`Photo from ${w.author_name}`} /></a>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{w.author_name}{w.from_admin && <span className="cel-tag" style={{ marginLeft: 6 }}>Admin</span>}</strong>
                    <p>{w.message}</p>
                    <div className="cel-row">
                      {w.photo_path && <button type="button" className="cel-link danger" disabled={busy} onClick={() => moderate(w, true)}><Trash2 size={12} aria-hidden="true" /> Remove photo</button>}
                      <button type="button" className="cel-link danger" disabled={busy} onClick={() => moderate(w, false)}>Remove message</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
