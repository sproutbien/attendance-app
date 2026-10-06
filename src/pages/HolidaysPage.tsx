import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { CalendarPlus, PartyPopper } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ChoiceHolidayCard from '../components/ChoiceHolidayCard'
import { useAuth } from '../contexts/AuthContext'
import { useBranding } from '../contexts/BrandingContext'
import { downloadHolidayCalendar, holidaysFor, loadHolidays } from '../lib/holidays'
import { isSunday, localDate } from '../lib/calendar'
import { leaveYearLabel, leaveYearOf } from '../lib/leave'
import { daysUntil, relativeDays } from '../lib/onboarding'

type Holiday = { date: string; name: string; choice: boolean }

/** Employee: the leave year's public holidays and their own choice holidays, with an .ics download. */
export default function HolidaysPage() {
  const { employee } = useAuth()
  const { branding } = useBranding()
  const today = localDate()
  const thisYear = leaveYearOf(today)
  const [year, setYear] = useState(thisYear)
  const [byYear, setByYear] = useState<Map<number, Holiday[]> | null>(null)
  const [error, setError] = useState<string | null>(null)

  // This leave year and the next (shown once HR has announced any)
  const load = useCallback(async () => {
    if (!employee) return
    const { holidays, error } = await loadHolidays(`${thisYear}-04-01`, `${thisYear + 2}-03-31`)
    setError(error)
    const mine = holidaysFor(holidays, employee.id)
    const all = [...mine].map(([date, name]) => ({ date, name, choice: !holidays.common.has(date) }))
      .sort((a, b) => a.date.localeCompare(b.date))
    setByYear(new Map([thisYear, thisYear + 1].map(y => [y, all.filter(h => leaveYearOf(h.date) === y)])))
  }, [employee, thisYear])

  useEffect(() => { load() }, [load])

  const list = byYear?.get(year) ?? []
  const hasNext = (byYear?.get(thisYear + 1)?.length ?? 0) > 0
  const next = (byYear?.get(thisYear) ?? []).concat(byYear?.get(thisYear + 1) ?? []).find(h => h.date >= today)
  const months = useMemo(() => {
    const m = new Map<string, Holiday[]>()
    for (const h of list) {
      const key = h.date.slice(0, 7)
      m.set(key, [...(m.get(key) ?? []), h])
    }
    return [...m]
  }, [list])
  const counts = { pub: list.filter(h => !h.choice).length, choice: list.filter(h => h.choice).length }

  return (
    <AppLayout medium>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <PartyPopper size={24} style={{ color: 'var(--green-dark, #1d5a1f)' }} />
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text-strong, #10261a)', flex: 1 }}>Holidays</h1>
        {hasNext && (
          <div role="group" aria-label="Leave year" style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 10, background: 'var(--surface-soft, #f4f8f2)', border: '1px solid var(--border, #e2ebdf)' }}>
            {[thisYear, thisYear + 1].map(y => (
              <button key={y} type="button" aria-pressed={year === y} onClick={() => setYear(y)} style={{ ...segBtn, ...(year === y ? segOn : null) }}>
                {leaveYearLabel(y)}
              </button>
            ))}
          </div>
        )}
      </div>
      <p style={{ margin: '0 0 1.25rem', color: 'var(--text-muted, #5b6f61)', fontSize: 14 }}>
        Leave year {leaveYearLabel(year)}
        {byYear && <> · {counts.pub} public holiday{counts.pub === 1 ? '' : 's'}{counts.choice > 0 && <> · {counts.choice} choice holiday{counts.choice === 1 ? '' : 's'}</>}</>}
      </p>

      {next && (
        <div className="sb-card" style={{ marginBottom: '1rem', flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'var(--green-soft, #e6f2e1)' }}>
          <span style={{ fontSize: 26 }} aria-hidden="true">🎉</span>
          <span style={{ flex: '1 1 200px' }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--green-dark, #1d5a1f)' }}>
              {next.date === today ? 'Today' : 'Next holiday'}
            </span>
            <span style={{ display: 'block', fontSize: 17, fontWeight: 800, color: 'var(--text-strong, #10261a)' }}>{next.name}</span>
            <span style={{ fontSize: 14, color: 'var(--text, #2c4234)' }}>
              {fmtDay(next.date)}{next.date !== today && <> · {relativeDays(daysUntil(next.date, today))}</>}
            </span>
          </span>
        </div>
      )}

      <ChoiceHolidayCard onChanged={load} />

      <section className="sb-card" style={{ marginBottom: '1rem' }}>
        <div className="sb-card-head" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
          <h2 style={{ flex: 1 }}>{leaveYearLabel(year)}</h2>
          {list.length > 0 && (
            <button type="button" className="sb-btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13 }}
              onClick={() => downloadHolidayCalendar(list, `holidays-${leaveYearLabel(year).replace(/\s+/g, '').replace('–', '-')}.ics`, `${branding.company_name} holidays`)}>
              <CalendarPlus size={16} /> Add to my calendar
            </button>
          )}
        </div>
        {error ? <p style={{ ...muted, color: 'var(--red, #b42318)' }}>{error}</p>
          : !byYear ? <p style={muted}>Loading…</p>
          : list.length === 0 ? <p style={muted}>No holidays announced yet for this leave year.</p>
          : months.map(([month, days]) => (
            <div key={month} style={{ marginTop: 10 }}>
              <div style={monthHead}>{new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {days.map(h => {
                  const past = h.date < today
                  return (
                    <li key={h.date + h.name} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-soft, #edf3ea)', opacity: past ? 0.5 : 1 }}>
                      <span style={{ width: 92, flexShrink: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-strong, #10261a)' }}>{fmtDay(h.date)}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--text, #2c4234)' }}>
                        {h.name}
                        {h.choice && <span style={{ ...tag, background: 'var(--blue-soft, #e3edfb)', color: 'var(--blue, #1f5fbf)' }}>Your choice holiday</span>}
                        {isSunday(h.date) && <span style={{ ...tag, background: 'var(--surface-soft, #f4f8f2)', color: 'var(--text-muted, #5b6f61)' }}>Falls on a Sunday</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
      </section>
    </AppLayout>
  )
}

/** "Mon 9 Nov" */
function fmtDay(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

const muted: CSSProperties = { margin: '6px 0 0', fontSize: 14, color: 'var(--text-muted, #5b6f61)' }
const monthHead: CSSProperties = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--green-dark, #1d5a1f)', margin: '6px 0 2px' }
const tag: CSSProperties = { display: 'inline-block', marginLeft: 8, padding: '1px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }
const segBtn: CSSProperties = { padding: '5px 10px', border: 'none', borderRadius: 8, background: 'transparent', color: 'var(--text-muted, #5b6f61)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const segOn: CSSProperties = { background: 'var(--surface, #fff)', color: 'var(--text-strong, #10261a)', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }
