import { useEffect, useState } from 'react'
import { Cake, ChevronRight, Gift, PartyPopper } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { fmtOccasion, loadMyCelebrations, yearsLabel } from '../../lib/celebrations'
import type { MyCelebration } from '../../lib/celebrations'
import CelebrationPopup from './CelebrationPopup'
import '../../styles/celebrations.css'

/** Profile: every birthday and anniversary card received, to open again. Hidden until there is one. */
export default function MyWishes() {
  const { employee } = useAuth()
  const [list, setList] = useState<MyCelebration[]>([])
  const [open, setOpen] = useState<MyCelebration | null>(null)

  useEffect(() => { loadMyCelebrations().then(setList).catch(() => setList([])) }, [])

  if (!employee || list.length === 0) return null
  return (
    <section className="sb-card" style={{ marginBottom: '1rem' }}>
      <div className="sb-card-head" style={{ marginBottom: 10 }}>
        <Gift size={18} /><h2>My wishes</h2>
      </div>
      <ul className="cel-wish-list">
        {list.map(c => {
          const people = c.wishes.length
          return (
            <li key={c.id}>
              <button type="button" className="cel-wish-item" onClick={() => setOpen(c)}>
                <span className="cel-wish-icon" style={{ background: c.kind === 'birthday' ? '#b4568c' : '#1a661b' }}>
                  {c.kind === 'birthday' ? <Cake size={20} aria-hidden="true" /> : <PartyPopper size={20} aria-hidden="true" />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{c.kind === 'birthday' ? `Birthday ${c.occasion_date.slice(0, 4)}` : `Work anniversary · ${yearsLabel(c.years)}`}</strong>
                  <span className="cel-sub">
                    {people === 0 ? 'A card from the company' : `${people} message${people === 1 ? '' : 's'}`} · {fmtOccasion(c.occasion_date, false)} {c.occasion_date.slice(0, 4)}
                  </span>
                </span>
                <ChevronRight size={18} aria-hidden="true" style={{ color: 'var(--text-muted, #5b6f61)' }} />
              </button>
            </li>
          )
        })}
      </ul>
      {open && <CelebrationPopup celebration={open} name={employee.full_name} review onClose={() => setOpen(null)} />}
    </section>
  )
}
