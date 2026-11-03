import { useCallback, useEffect, useRef, useState } from 'react'
import { Cake, Check, ImagePlus, Lock, PartyPopper, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import EmployeeAvatar from '../employees/EmployeeAvatar'
import { localDate } from '../../lib/calendar'
import {
  PHOTO_ACCEPT, dismissThanks, firstName, fmtOccasion, loadTeamCelebrations, loadThanks,
  occasionTitle, photoLinks, photoProblem, removeMyWish, signCard,
} from '../../lib/celebrations'
import type { TeamCelebration, Thanks } from '../../lib/celebrations'
import '../../styles/celebrations.css'

function whenLabel(date: string) {
  const n = Math.round((new Date(date + 'T00:00:00').getTime() - new Date(localDate() + 'T00:00:00').getTime()) / 86400000)
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
}

/** Employee dashboard: open team cards to sign, and thank-you notes from people they signed for. */
export default function TeamCelebrations() {
  const [cards, setCards] = useState<TeamCelebration[]>([])
  const [thanks, setThanks] = useState<Thanks[]>([])

  const load = useCallback(() => {
    loadTeamCelebrations().then(setCards).catch(() => setCards([]))
    loadThanks().then(setThanks).catch(() => setThanks([]))
  }, [])
  useEffect(load, [load])

  return (
    <>
      {thanks.map(t => (
        <div key={t.celebration_id} className="cel-thanks" role="status">
          <EmployeeAvatar employee={t} size={34} />
          <span><strong>{firstName(t.full_name)} says thank you!</strong> for your message on {t.kind === 'birthday' ? 'their birthday' : 'their work anniversary'}.</span>
          <button type="button" aria-label="Dismiss" onClick={() => { dismissThanks(t.celebration_id); setThanks(l => l.filter(x => x !== t)) }}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
      {cards.map(c => <SignCard key={`${c.employee_id}-${c.kind}-${c.occasion_date}`} card={c} onSaved={load} />)}
    </>
  )
}

function SignCard({ card, onSaved }: { card: TeamCelebration; onSaved: () => void }) {
  const { employee } = useAuth()
  const signed = card.my_message != null
  const [editing, setEditing] = useState(!signed)
  const [message, setMessage] = useState(card.my_message ?? '')
  // undefined = keep current photo, null = remove it, File = new one
  const [photo, setPhoto] = useState<File | null | undefined>(undefined)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const name = firstName(card.full_name)
  const textId = `cel-msg-${card.employee_id}-${card.kind}`

  // Show the photo already on the card
  useEffect(() => {
    if (photo !== undefined) return
    if (!card.my_photo_path) { setPreview(null); return }
    photoLinks([card.my_photo_path]).then(m => setPreview(m.get(card.my_photo_path!) ?? null))
  }, [card.my_photo_path, photo])

  function pick(file: File) {
    const problem = photoProblem(file)
    if (problem) { setError(problem); return }
    setError(null)
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  async function save() {
    if (!employee) return
    if (!message.trim()) { setError('Write a message first.'); return }
    setBusy(true)
    setError(null)
    try {
      await signCard({
        employeeId: card.employee_id, kind: card.kind, occasionDate: card.occasion_date,
        message, authorId: employee.id, currentPhoto: card.my_photo_path, photo,
      })
      setPhoto(undefined)
      setEditing(false)
      onSaved()
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  async function remove() {
    if (!card.celebration_id) return
    setBusy(true)
    setError(null)
    try { await removeMyWish(card.celebration_id); setMessage(''); setPhoto(undefined); setEditing(true); onSaved() }
    catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  const others = card.signers.length - (signed ? 1 : 0)
  const Icon = card.kind === 'birthday' ? Cake : PartyPopper

  return (
    <section className="cel-card" aria-label={`${occasionTitle(card.full_name, card.kind, card.years)} card`}>
      <div className="cel-card-who">
        <div className="cel-card-person">
          <EmployeeAvatar employee={card} size={60} />
          <div>
            <div className="cel-kicker"><Icon size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {fmtOccasion(card.occasion_date)} · {whenLabel(card.occasion_date)}</div>
            <h2>{occasionTitle(card.full_name, card.kind, card.years)}</h2>
            {card.designation && <div style={{ fontSize: 13, color: 'var(--text-muted, #5b6f61)' }}>{card.designation}</div>}
          </div>
        </div>
        <p>Add a line to the team’s card. {name} will see all the messages together on the day.</p>
        <div className="cel-signers">
          {card.signers.length > 0 && (
            <span className="cel-stack">
              {card.signers.slice(0, 6).map((s, i) => <EmployeeAvatar key={i} employee={{ full_name: s.name, photo_path: s.photo_path }} size={30} />)}
            </span>
          )}
          <span>
            {card.signers.length === 0 ? 'No one has signed yet — be the first.'
              : signed ? (others === 0 ? 'You’ve signed.' : `You and ${others} other${others === 1 ? '' : 's'} have signed.`)
              : `${card.signers.length} ${card.signers.length === 1 ? 'person has' : 'people have'} signed.`}
          </span>
        </div>
      </div>

      <div className="cel-card-form">
        {!editing ? (
          <>
            <div className="cel-done"><Check size={18} aria-hidden="true" /> You signed {name}’s card</div>
            <div className="cel-row" style={{ alignItems: 'flex-start' }}>
              {preview && <span className="cel-thumb"><img src={preview} alt="Your photo" /></span>}
              <p style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 14, whiteSpace: 'pre-line', overflowWrap: 'anywhere', color: 'var(--text, #2c4234)' }}>“{card.my_message}”</p>
            </div>
            <div className="cel-row">
              <button type="button" className="cel-link" onClick={() => { setMessage(card.my_message ?? ''); setEditing(true) }}>Edit</button>
              <button type="button" className="cel-link danger" onClick={remove} disabled={busy}>Remove my message</button>
            </div>
          </>
        ) : (
          <>
            <label htmlFor={textId}>Your message</label>
            <textarea id={textId} value={message} maxLength={1000} placeholder={`Write something nice for ${name}…`} onChange={e => setMessage(e.target.value)} />
            <div className="cel-row">
              {preview ? (
                <span className="cel-thumb">
                  <img src={preview} alt="Photo to add" />
                  <button type="button" aria-label="Remove photo" onClick={() => { setPhoto(card.my_photo_path ? null : undefined); setPreview(null) }}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              ) : (
                <button type="button" className="cel-photo-pick" onClick={() => input.current?.click()}>
                  <ImagePlus size={17} aria-hidden="true" /> Add a photo
                </button>
              )}
              <input ref={input} type="file" accept={PHOTO_ACCEPT} hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f) }} />
              <span className="cel-spacer" />
              {signed && <button type="button" className="sb-btn-ghost" onClick={() => { setEditing(false); setPhoto(undefined); setError(null) }} disabled={busy}>Cancel</button>}
              <button type="button" className="sb-btn-primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : signed ? 'Save changes' : 'Sign the card'}
              </button>
            </div>
            {error && <p className="cel-err" role="alert">{error}</p>}
            <p className="cel-note-small">
              <Lock size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> Only {name} and HR can read the messages and photos.
              {' '}Only share photos everyone in them would be happy for {name} to see.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
