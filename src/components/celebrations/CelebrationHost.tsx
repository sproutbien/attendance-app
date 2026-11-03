import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { localDate } from '../../lib/calendar'
import { addDays } from '../../lib/leave'
import { LATE_DAYS, loadMyCelebrations, markSeen } from '../../lib/celebrations'
import type { MyCelebration } from '../../lib/celebrations'
import CelebrationPopup from './CelebrationPopup'

// Checked once per page load, not on every screen change
let checkedFor: string | null = null

/** Shows the birthday / anniversary pop-up once, on the day or in the next few days. */
export default function CelebrationHost() {
  const { employee } = useAuth()
  const [showing, setShowing] = useState<MyCelebration | null>(null)

  useEffect(() => {
    if (!employee || checkedFor === employee.id) return
    checkedFor = employee.id
    const today = localDate()
    loadMyCelebrations()
      .then(list => {
        const due = list.find(c => !c.seen_at && c.occasion_date <= today && c.occasion_date >= addDays(today, -LATE_DAYS))
        if (due) setShowing(due)
      })
      .catch(() => { checkedFor = null })   // e.g. migration 047 not run yet: try again next time
  }, [employee])

  if (!showing || !employee) return null
  return (
    <CelebrationPopup
      celebration={showing}
      name={employee.full_name}
      onClose={thanked => { markSeen(showing.id, thanked); setShowing(null) }}
    />
  )
}
