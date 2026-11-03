import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import EmployeeAvatar from '../employees/EmployeeAvatar'
import { useBranding } from '../../contexts/BrandingContext'
import { fmtOccasion, greeting, photoLinks } from '../../lib/celebrations'
import type { MyCelebration } from '../../lib/celebrations'
import '../../styles/celebrations.css'

const COLOURS = ['#f6c344', '#ff8a7a', '#8fdc6a', '#7cc4ff', '#f3a6d2', '#ffffff']

/** Full-screen card for the person celebrated: admins' wishes as letters, the team's as notes with photos. */
export default function CelebrationPopup({ celebration, name, onClose, review = false }: {
  celebration: MyCelebration
  name: string
  onClose: (thanked: boolean) => void
  review?: boolean          // opened again from My wishes: no "Thank you!" step
}) {
  const { branding } = useBranding()
  const [links, setLinks] = useState<Map<string, string>>(new Map())
  const closeBtn = useRef<HTMLButtonElement>(null)
  const letters = celebration.wishes.filter(w => w.from_admin)
  const notes = celebration.wishes.filter(w => !w.from_admin)

  useEffect(() => {
    photoLinks(celebration.wishes.map(w => w.photo_path)).then(setLinks)
  }, [celebration])

  // Esc closes; page behind doesn't scroll
  useEffect(() => {
    closeBtn.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(false) }
    window.addEventListener('keydown', key)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', key) }
  }, [onClose])

  const confetti = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: `${(i * 37 + 11) % 100}%`,
    width: 7 + (i % 3) * 3,
    height: i % 4 === 0 ? 8 + (i % 3) * 2 : 14 + (i % 2) * 6,
    background: COLOURS[i % COLOURS.length],
    borderRadius: i % 4 === 0 ? '50%' : 2,
    animationDuration: `${3.2 + (i % 7) * 0.45}s`,
    animationDelay: `${(i % 10) * 0.18}s`,
    ['--spin' as string]: `${(i % 2 ? 1 : -1) * (360 + (i * 47) % 360)}deg`,
    ['--rest' as string]: `${(i * 29) % 95}%`,
  })), [])

  return (
    <div className="cel-overlay" role="dialog" aria-modal="true" aria-labelledby="cel-title">
      <div className="cel-confetti" aria-hidden="true">
        {confetti.map((s, i) => <span key={i} style={s} />)}
      </div>
      <button ref={closeBtn} type="button" className="cel-close" onClick={() => onClose(false)} aria-label="Close">
        <X size={20} aria-hidden="true" />
      </button>

      <div className="cel-sheet">
        <div>
          <p className="cel-date">{fmtOccasion(celebration.occasion_date)}</p>
          <h1 id="cel-title" className="cel-title">{greeting(name, celebration.kind, celebration.years)}</h1>
        </div>

        {letters.map(w => (
          <article key={w.id} className="cel-letter">
            {w.photo_path && links.get(w.photo_path) && <img className="cel-letter-photo" src={links.get(w.photo_path)} alt={`Photo from ${w.author_name}`} />}
            <p>{w.message}</p>
            <div className="cel-by">
              <EmployeeAvatar employee={{ full_name: w.author_name, photo_path: w.author_photo }} size={44} />
              <div><strong>{w.author_name}</strong>{w.author_designation && <span>{w.author_designation}</span>}</div>
            </div>
          </article>
        ))}

        {celebration.wishes.length === 0 && (
          <article className="cel-letter">
            <p>
              {celebration.kind === 'birthday'
                ? `Everyone at ${branding.company_name} wishes you a wonderful birthday and a great year ahead.`
                : `Thank you for ${celebration.years === 1 ? 'a great first year' : `${celebration.years} great years`} with ${branding.company_name}. We’re glad you’re on the team.`}
            </p>
            <div className="cel-by"><div><strong>{branding.company_name}</strong></div></div>
          </article>
        )}

        {notes.length > 0 && (
          <section className="cel-team" aria-label="Messages from your team">
            <h2>From your team · {notes.length} message{notes.length === 1 ? '' : 's'}</h2>
            <div className="cel-notes">
              {notes.map(w => (
                <article key={w.id} className="cel-note">
                  {w.photo_path && links.get(w.photo_path) && <img className="cel-polaroid" src={links.get(w.photo_path)} alt={`Photo from ${w.author_name}`} />}
                  <p>{w.message}</p>
                  <div className="cel-by">
                    <EmployeeAvatar employee={{ full_name: w.author_name, photo_path: w.author_photo }} size={26} />
                    <strong>{w.author_name}</strong>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="cel-actions">
          {review ? (
            <button type="button" className="cel-thanks-btn" onClick={() => onClose(false)}>Close</button>
          ) : (
            <>
              <button type="button" className="cel-thanks-btn" onClick={() => onClose(true)}>Thank you!</button>
              <span className="cel-hint">
                {notes.length > 0 ? 'Everyone who signed will see your thank-you. ' : ''}This card stays in My profile → My wishes.
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
