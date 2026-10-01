import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { fmtHM } from '../../lib/breaks'
import { fmtDays, fmtMinutes, fmtPct } from '../../lib/stats'
import type { DayKind, DayStat, MonthStats } from '../../lib/stats'
import { daysInMonth, monthLabel } from '../../lib/calendar'

// Hand-built SVG charts for the Reports screen. Colours come from stats.css
// tokens (--c-*). Every chart has a hover/focus tooltip and its numbers are
// also on screen as labels or in a table.

export const KIND_META: Record<DayKind, { label: string; color: string }> = {
  on_time: { label: 'On time', color: 'var(--c-on-time)' },
  late:    { label: 'Late',    color: 'var(--c-late)' },
  leave:   { label: 'Leave',   color: 'var(--c-leave)' },
  absent:  { label: 'Absent',  color: 'var(--c-absent)' },
}
const KINDS: DayKind[] = ['on_time', 'late', 'leave', 'absent']

/** Width of an element, kept up to date (callback ref, so it works when the element mounts late). */
function useWidth<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  const ref = useCallback((el: T | null) => setNode(el), [])
  useEffect(() => {
    if (!node) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(node)
    return () => ro.disconnect()
  }, [node])
  return [ref, width] as const
}

type Tip = { x: number; y: number; content: ReactNode } | null

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null
  return <div className="st-tip" role="status" style={{ left: tip.x, top: tip.y }}>{tip.content}</div>
}

const dayLabel = (date: string) =>
  new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** "8h" / "8.5h" for axis ticks */
const hoursTick = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`

// ── Day breakdown donut ───────────────────────────────────────

export function DayDonut({ stats }: { stats: MonthStats }) {
  const [active, setActive] = useState<DayKind | null>(null)
  const values: Record<DayKind, number> = { on_time: stats.onTime, late: stats.late, leave: stats.leave, absent: stats.absent }
  const total = stats.workingDays
  const size = 168, r = 70, stroke = 22, c = size / 2

  // Arc paths; a 2px surface stroke separates the segments
  let angle = -Math.PI / 2
  const arcs = KINDS.filter(k => values[k] > 0).map(k => {
    const sweep = (values[k] / total) * Math.PI * 2
    const a0 = angle, a1 = angle + sweep
    angle = a1
    const full = sweep >= Math.PI * 2 - 1e-6
    const p = (a: number) => `${c + r * Math.cos(a)} ${c + r * Math.sin(a)}`
    const d = full
      ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r}`
      : `M ${p(a0)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${p(a1)}`
    return { k, d }
  })

  return (
    <div className="st-donut-wrap">
      <div className="st-donut" style={{ width: size, height: size }}>
        {total === 0 ? (
          <svg width={size} height={size} aria-hidden="true">
            <circle cx={c} cy={c} r={r} fill="none" stroke="var(--c-grid)" strokeWidth={stroke} />
          </svg>
        ) : (
          <svg width={size} height={size} role="img" aria-label={`Day breakdown: ${KINDS.map(k => `${KIND_META[k].label} ${fmtDays(values[k])}`).join(', ')}`}>
            {arcs.map(({ k, d }) => (
              <path
                key={k} d={d} fill="none" stroke={KIND_META[k].color} strokeWidth={stroke}
                className={active && active !== k ? 'is-dim' : undefined}
                tabIndex={0}
                onMouseEnter={() => setActive(k)} onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(k)} onBlur={() => setActive(null)}
              />
            ))}
            {/* Surface gaps between segments */}
            {arcs.length > 1 && arcs.map((_, i) => {
              let a = -Math.PI / 2
              for (let j = 0; j <= i; j++) a += (values[arcs[j].k] / total) * Math.PI * 2
              return (
                <line key={i} x1={c + (r - stroke / 2 - 1) * Math.cos(a)} y1={c + (r - stroke / 2 - 1) * Math.sin(a)}
                  x2={c + (r + stroke / 2 + 1) * Math.cos(a)} y2={c + (r + stroke / 2 + 1) * Math.sin(a)}
                  stroke="var(--surface)" strokeWidth={2} pointerEvents="none" />
              )
            })}
          </svg>
        )}
        <div className="st-donut-center">
          {active ? (
            <>
              <b>{fmtDays(values[active])}</b>
              <span>{KIND_META[active].label} day{values[active] === 1 ? '' : 's'}</span>
            </>
          ) : (
            <>
              <b>{fmtPct(stats.attendanceRate)}</b>
              <span>Attendance</span>
            </>
          )}
        </div>
      </div>

      <ul className="st-breakdown">
        {KINDS.map(k => (
          <li key={k} onMouseEnter={() => setActive(k)} onMouseLeave={() => setActive(null)}>
            <span className="st-swatch" style={{ background: KIND_META[k].color }} />
            {KIND_META[k].label}
            <b>{fmtDays(values[k])}</b>
            <em>{total ? `${Math.round((values[k] / total) * 100)}%` : '—'}</em>
          </li>
        ))}
        <li>
          <span className="st-swatch" style={{ background: 'transparent' }} />
          Working days
          <b>{fmtDays(total)}</b>
          <em />
        </li>
      </ul>
    </div>
  )
}

// ── Daily hours (columns) with each day's shift target ───────

export function DailyHoursChart({ days, yearMonth }: { days: DayStat[]; yearMonth: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  const [hover, setHover] = useState<string | null>(null)
  const shown = days.filter(d => d.worked > 0 || d.expected > 0 || d.kind)

  const height = 220, top = 14, bottom = 24, left = 34, right = 6
  const plotH = height - top - bottom
  const plotW = Math.max(0, width - left - right)
  const maxH = Math.max(8, ...shown.map(d => Math.max(d.worked, d.expected) / 3600))
  const yMax = Math.ceil(maxH / 2) * 2
  const y = (h: number) => top + plotH - (h / yMax) * plotH
  const ticks = Array.from({ length: yMax / 2 + 1 }, (_, i) => i * 2)

  // One slot per calendar day so gaps (Sundays, holidays) stay visible
  const nDays = daysInMonth(yearMonth)
  const slot = plotW / nDays
  const barW = Math.max(3, Math.min(18, slot - 4))
  const xOf = (date: string) => left + (Number(date.slice(8)) - 0.5) * slot

  if (!shown.length) return <p className="st-empty">No working days recorded this month yet.</p>

  return (
    <div className="st-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Hours worked each day compared with shift hours">
          {ticks.map(t => (
            <g key={t}>
              <line className={t === 0 ? 'st-baseline' : 'st-gridline'} x1={left} x2={width - right} y1={y(t)} y2={y(t)} />
              <text x={left - 6} y={y(t) + 4} textAnchor="end">{hoursTick(t)}</text>
            </g>
          ))}
          {[1, 8, 15, 22, 29].filter(n => n <= nDays).map(n => (
            <text key={n} x={left + (n - 0.5) * slot} y={height - 6} textAnchor="middle">{n}</text>
          ))}
          {shown.map(d => {
            const x = xOf(d.date)
            const h = d.worked / 3600
            const bh = Math.max(0, y(0) - y(h))
            const r = Math.min(4, barW / 2, bh)
            const dim = hover !== null && hover !== d.date
            return (
              <g key={d.date}>
                {bh > 0 && (
                  <path
                    className={`st-bar${dim ? ' is-dim' : ''}`}
                    d={`M ${x - barW / 2} ${y(0)} V ${y(h) + r} Q ${x - barW / 2} ${y(h)} ${x - barW / 2 + r} ${y(h)} H ${x + barW / 2 - r} Q ${x + barW / 2} ${y(h)} ${x + barW / 2} ${y(h) + r} V ${y(0)} Z`}
                  />
                )}
                {d.expected > 0 && (
                  <line className="st-target" x1={x - barW / 2 - 2} x2={x + barW / 2 + 2} y1={y(d.expected / 3600)} y2={y(d.expected / 3600)} opacity={dim ? 0.35 : 1} />
                )}
                <rect
                  className="st-hit" x={x - slot / 2} y={top} width={slot} height={plotH} tabIndex={0}
                  aria-label={`${dayLabel(d.date)}: worked ${fmtHM(d.worked)}${d.expected ? `, shift ${fmtHM(d.expected)}` : ''}`}
                  onMouseEnter={() => { setHover(d.date); setTip({ x, y: y(Math.max(h, d.expected / 3600)), content: dayTip(d) }) }}
                  onFocus={() => { setHover(d.date); setTip({ x, y: y(Math.max(h, d.expected / 3600)), content: dayTip(d) }) }}
                  onMouseLeave={() => { setHover(null); setTip(null) }} onBlur={() => { setHover(null); setTip(null) }}
                />
              </g>
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}

function dayTip(d: DayStat) {
  const diff = d.worked - d.expected
  return (
    <>
      <b>{dayLabel(d.date)}</b>
      {d.kind && <div>{KIND_META[d.kind].label}{d.half ? ' · half-day leave' : ''}</div>}
      <div>Worked {fmtHM(d.worked)}</div>
      {d.expected > 0 && <div>Shift {fmtHM(d.expected)} · {diff >= 0 ? '+' : '−'}{fmtHM(Math.abs(diff))}</div>}
      {d.breaks > 0 && <div>Breaks {fmtHM(d.breaks)}</div>}
    </>
  )
}

// ── Check-in times (dots) against the late threshold ─────────

export function CheckInChart({ days, yearMonth }: { days: DayStat[]; yearMonth: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  const [hover, setHover] = useState<string | null>(null)
  const pts = days.filter(d => d.checkIn != null && (d.kind === 'on_time' || d.kind === 'late'))
  if (!pts.length) return <p className="st-empty">No check-ins this month yet.</p>

  const height = 170, top = 12, bottom = 24, left = 58, right = 8
  const plotH = height - top - bottom
  const plotW = Math.max(0, width - left - right)
  const lateLines = [...new Set(pts.map(p => p.lateAfter))]
  const lo = Math.floor((Math.min(...pts.map(p => p.checkIn!), ...lateLines) - 15) / 30) * 30
  const hi = Math.ceil((Math.max(...pts.map(p => p.checkIn!), ...lateLines) + 15) / 30) * 30
  const y = (m: number) => top + ((m - lo) / (hi - lo)) * plotH   // earlier = higher up
  const nDays = daysInMonth(yearMonth)
  const slot = plotW / nDays
  const xOf = (date: string) => left + (Number(date.slice(8)) - 0.5) * slot
  const step = hi - lo > 180 ? 60 : 30
  const ticks: number[] = []
  for (let m = lo; m <= hi; m += step) ticks.push(m)

  return (
    <div className="st-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Check-in time each day against the late threshold">
          {ticks.map(t => (
            <g key={t}>
              <line className="st-gridline" x1={left} x2={width - right} y1={y(t)} y2={y(t)} />
              <text x={left - 6} y={y(t) + 4} textAnchor="end">{fmtMinutes(t)}</text>
            </g>
          ))}
          <line className="st-baseline" x1={left} x2={width - right} y1={top + plotH} y2={top + plotH} />
          {/* Late threshold(s) — named in the card legend so the label never covers dots */}
          {lateLines.map(m => (
            <line key={m} className="st-ref" x1={left} x2={width - right} y1={y(m)} y2={y(m)}>
              <title>Late after {fmtMinutes(m)}</title>
            </line>
          ))}
          {[1, 8, 15, 22, 29].filter(n => n <= nDays).map(n => (
            <text key={n} x={left + (n - 0.5) * slot} y={height - 6} textAnchor="middle">{n}</text>
          ))}
          {pts.map(p => {
            const x = xOf(p.date), cy = y(p.checkIn!)
            const show = () => { setHover(p.date); setTip({ x, y: cy, content: <><b>{dayLabel(p.date)}</b>Checked in {fmtMinutes(p.checkIn!)} · {KIND_META[p.kind!].label}</> }) }
            const hide = () => { setHover(null); setTip(null) }
            return (
              <g key={p.date}>
                <circle className={`st-dot${hover && hover !== p.date ? ' is-dim' : ''}`} cx={x} cy={cy} r={5} fill={KIND_META[p.kind!].color} />
                <circle className="st-hit" cx={x} cy={cy} r={12} tabIndex={0}
                  aria-label={`${dayLabel(p.date)}: checked in ${fmtMinutes(p.checkIn!)}, ${KIND_META[p.kind!].label}`}
                  onMouseEnter={show} onFocus={show} onMouseLeave={hide} onBlur={hide} />
              </g>
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}

// ── Monthly trend: total hours per month ──────────────────────

export function TrendChart({ trend, current }: { trend: MonthStats[]; current: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  const [hover, setHover] = useState<string | null>(null)

  const height = 200, top = 22, bottom = 26, left = 40, right = 6
  const plotH = height - top - bottom
  const plotW = Math.max(0, width - left - right)
  const maxH = Math.max(10, ...trend.map(m => m.worked / 3600))
  const stepH = maxH > 120 ? 40 : maxH > 60 ? 20 : 10
  const yMax = Math.ceil(maxH / stepH) * stepH
  const y = (h: number) => top + plotH - (h / yMax) * plotH
  const slot = plotW / trend.length
  const barW = Math.min(24, slot * 0.5)
  const ticks = Array.from({ length: yMax / stepH + 1 }, (_, i) => i * stepH)

  return (
    <div className="st-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Total hours worked per month">
          {ticks.map(t => (
            <g key={t}>
              <line className={t === 0 ? 'st-baseline' : 'st-gridline'} x1={left} x2={width - right} y1={y(t)} y2={y(t)} />
              <text x={left - 6} y={y(t) + 4} textAnchor="end">{t}h</text>
            </g>
          ))}
          {trend.map((m, i) => {
            const x = left + (i + 0.5) * slot
            const h = m.worked / 3600
            const bh = Math.max(0, y(0) - y(h))
            const r = Math.min(4, bh)
            const short = new Date(m.yearMonth + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' })
            const isCur = m.yearMonth === current
            const content = (
              <>
                <b>{monthLabel(m.yearMonth)}</b>
                <div>Worked {fmtHM(m.worked)}</div>
                <div>Present {fmtDays(m.present)} of {fmtDays(m.workingDays)} days</div>
                <div>Attendance {fmtPct(m.attendanceRate)} · On time {fmtPct(m.onTimeRate)}</div>
              </>
            )
            const show = () => { setHover(m.yearMonth); setTip({ x, y: y(h), content }) }
            const hide = () => { setHover(null); setTip(null) }
            return (
              <g key={m.yearMonth}>
                {bh > 0 && (
                  <path
                    className={`st-bar${hover && hover !== m.yearMonth ? ' is-dim' : ''}`}
                    opacity={isCur || hover === m.yearMonth ? 1 : 0.55}
                    d={`M ${x - barW / 2} ${y(0)} V ${y(h) + r} Q ${x - barW / 2} ${y(h)} ${x - barW / 2 + r} ${y(h)} H ${x + barW / 2 - r} Q ${x + barW / 2} ${y(h)} ${x + barW / 2} ${y(h) + r} V ${y(0)} Z`}
                  />
                )}
                {isCur && h > 0 && <text className="st-value-label" x={x} y={y(h) - 6} textAnchor="middle">{Math.round(h)}h</text>}
                <text x={x} y={height - 8} textAnchor="middle" style={isCur ? { fill: 'var(--text-strong)', fontWeight: 700 } : undefined}>{short}</text>
                <rect className="st-hit" x={x - slot / 2} y={top} width={slot} height={plotH} tabIndex={0}
                  aria-label={`${monthLabel(m.yearMonth)}: ${fmtHM(m.worked)} worked`}
                  onMouseEnter={show} onFocus={show} onMouseLeave={hide} onBlur={hide} />
              </g>
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}
