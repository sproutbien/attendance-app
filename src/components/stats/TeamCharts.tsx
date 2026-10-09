import { useState } from 'react'
import type { ReactNode } from 'react'
import { KIND_META, Tooltip, useWidth } from './Charts'
import type { Tip } from './Charts'
import { fmtDays, fmtMinutes } from '../../lib/stats'
import type { DayKind, DayStat } from '../../lib/stats'
import { fmtHM } from '../../lib/breaks'
import { isSunday } from '../../lib/calendar'

// Team comparison charts (admin Team Stats). Same tokens and rules as Charts.tsx:
// thin marks, 2px surface gaps, hover/focus tooltips, numbers also in the table.

const KINDS: DayKind[] = ['on_time', 'late', 'leave', 'absent']
const NAME_W = 132     // left column for names
const ROW_H = 30

export type BreakdownRow = { id: string; name: string; values: Record<DayKind, number>; note: string }

/** One 100% bar per person: how their working days split into on time / late / leave / absent. */
export function BreakdownBars({ rows }: { rows: BreakdownRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  const [hover, setHover] = useState<string | null>(null)
  const noteW = 44
  const plotW = Math.max(0, width - NAME_W - noteW - 8)
  const barH = 14
  const height = rows.length * ROW_H + 4

  return (
    <div className="st-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Day breakdown for each person">
          {rows.map((r, i) => {
            const total = KINDS.reduce((n, k) => n + r.values[k], 0)
            const y = i * ROW_H + (ROW_H - barH) / 2
            let x = NAME_W
            const segs = total === 0 ? [] : KINDS.filter(k => r.values[k] > 0).map(k => {
              const w = (r.values[k] / total) * plotW
              const seg = { k, x, w }
              x += w
              return seg
            })
            return (
              <g key={r.id} opacity={hover && hover !== r.id ? 0.4 : 1}>
                <text x={NAME_W - 10} y={y + barH / 2 + 4} textAnchor="end" style={{ fill: 'var(--text)', fontSize: 12 }}>{clip(r.name, 18)}</text>
                {total === 0 && <rect x={NAME_W} y={y} width={plotW} height={barH} rx={4} fill="var(--c-grid)" />}
                {segs.map((s, j) => {
                  const first = j === 0, last = j === segs.length - 1
                  // 2px surface gap between segments; rounded only at the two ends
                  const gx = first ? s.x : s.x + 1, gw = Math.max(0, s.w - (first ? 0 : 1) - (last ? 0 : 1))
                  return (
                    <path key={s.k} d={roundedBar(gx, y, gw, barH, first ? 4 : 0, last ? 4 : 0)} fill={KIND_META[s.k].color} />
                  )
                })}
                <text x={width - 4} y={y + barH / 2 + 4} textAnchor="end" className="st-value-label">{r.note}</text>
                <rect
                  className="st-hit" x={0} y={i * ROW_H} width={width} height={ROW_H} tabIndex={0}
                  aria-label={`${r.name}: ${KINDS.map(k => `${KIND_META[k].label} ${fmtDays(r.values[k])}`).join(', ')}`}
                  onMouseEnter={() => show(r, i)} onFocus={() => show(r, i)}
                  onMouseLeave={hide} onBlur={hide}
                />
              </g>
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )

  function show(r: BreakdownRow, i: number) {
    setHover(r.id)
    setTip({
      x: NAME_W + plotW / 2, y: i * ROW_H + 4,
      content: (
        <>
          <b>{r.name}</b>
          {KINDS.map(k => <div key={k}>{KIND_META[k].label}: {fmtDays(r.values[k])} day{r.values[k] === 1 ? '' : 's'}</div>)}
        </>
      ),
    })
  }
  function hide() { setHover(null); setTip(null) }
}

export type RankRow = { id: string; name: string; value: number | null; tip?: ReactNode }

/** Horizontal bars, one per person, with a reference line (e.g. team average). */
export function RankBars({ rows, max, format, reference, referenceLabel }: {
  rows: RankRow[]                  // already sorted
  max: number                      // value at the full bar width
  format: (v: number) => string
  reference?: number | null
  referenceLabel?: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  const [hover, setHover] = useState<string | null>(null)
  const valueW = 64
  const plotW = Math.max(0, width - NAME_W - valueW)
  const barH = 12
  const top = reference != null ? 18 : 0
  const height = top + rows.length * ROW_H + 2
  const xOf = (v: number) => NAME_W + (Math.min(v, max) / max) * plotW

  return (
    <div className="st-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Ranking${referenceLabel ? `, ${referenceLabel}` : ''}`}>
          <line className="st-baseline" x1={NAME_W} x2={NAME_W} y1={top} y2={height} />
          {reference != null && (
            <g>
              <line className="st-ref" x1={xOf(reference)} x2={xOf(reference)} y1={top - 4} y2={height} />
              <text className="st-ref-label" x={xOf(reference)} y={10} textAnchor="middle">{referenceLabel} {format(reference)}</text>
            </g>
          )}
          {rows.map((r, i) => {
            const y = top + i * ROW_H + (ROW_H - barH) / 2
            const w = r.value == null ? 0 : xOf(r.value) - NAME_W
            const show = () => { setHover(r.id); setTip({ x: NAME_W + Math.max(w, 20) / 2, y: top + i * ROW_H + 4, content: <><b>{r.name}</b>{r.tip ?? (r.value == null ? 'No data' : format(r.value))}</> }) }
            const hide = () => { setHover(null); setTip(null) }
            return (
              <g key={r.id} opacity={hover && hover !== r.id ? 0.4 : 1}>
                <text x={NAME_W - 10} y={y + barH / 2 + 4} textAnchor="end" style={{ fill: 'var(--text)', fontSize: 12 }}>{clip(r.name, 18)}</text>
                {w > 0 && <path className="st-bar" d={roundedBar(NAME_W, y, w, barH, 0, Math.min(4, w))} />}
                <text x={NAME_W + w + 6} y={y + barH / 2 + 4} className="st-value-label">{r.value == null ? '—' : format(r.value)}</text>
                <rect className="st-hit" x={0} y={top + i * ROW_H} width={width} height={ROW_H} tabIndex={0}
                  aria-label={`${r.name}: ${r.value == null ? 'no data' : format(r.value)}`}
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

export type WeekDay = { date: string; off: string | null; values: Record<DayKind, number> }

/**
 * One stacked column per day: how many people were on time / late / on leave / absent.
 * The worst finished working day is labelled so it stands out; today is marked "so far".
 */
export function WeekColumns({ days, today }: { days: WeekDay[]; today: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  const [hover, setHover] = useState<string | null>(null)
  const height = 190, top = 22, bottom = 36, left = 6, right = 6
  const plotH = height - top - bottom
  const plotW = Math.max(0, width - left - right)
  const slot = plotW / Math.max(1, days.length)
  const barW = Math.min(36, slot * 0.55)
  const max = Math.max(1, ...days.map(d => KINDS.reduce((n, k) => n + d.values[k], 0)))
  const h = (n: number) => (n / max) * plotH
  const rate = (d: WeekDay) => {
    const due = d.values.on_time + d.values.late + d.values.absent
    return due > 0 ? (d.values.on_time + d.values.late) / due : null
  }
  // Worst finished day; ignore today, which is still filling in
  const done = days.filter(d => !d.off && d.date !== today && rate(d) != null)
  const worst = done.length > 1 ? done.reduce((a, b) => (rate(b)! < rate(a)! ? b : a)) : null
  const pct = (d: WeekDay) => `${Math.round(rate(d)! * 100)}%`

  return (
    <div className="st-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Attendance over the last seven days">
          <line className="st-baseline" x1={left} x2={width - right} y1={top + plotH} y2={top + plotH} />
          {days.map((d, i) => {
            const x = left + (i + 0.5) * slot
            const isToday = d.date === today
            const isWorst = worst?.date === d.date
            const label = new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
            // Stack bottom-up with a 2px surface gap; only the top segment is rounded
            const segs = KINDS.filter(k => d.values[k] > 0)
            let yTop = top + plotH
            const show = () => {
              setHover(d.date)
              setTip({
                x, y: yTop,
                content: (
                  <>
                    <b>{new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}{isToday ? ' · so far' : ''}</b>
                    {d.off ? <div>{d.off} — no one due in</div> : (
                      <>
                        {KINDS.map(k => <div key={k}>{KIND_META[k].label}: {d.values[k]}</div>)}
                        {rate(d) != null && <div>Attendance {pct(d)}</div>}
                      </>
                    )}
                  </>
                ),
              })
            }
            const hide = () => { setHover(null); setTip(null) }
            const paths = segs.map((k, j) => {
              const sh = Math.max(0, h(d.values[k]) - (j === 0 ? 0 : 2))
              yTop -= sh + (j === 0 ? 0 : 2)
              return <path key={k} d={roundedBar(x - barW / 2, yTop, barW, sh, 0, 0, j === segs.length - 1 ? Math.min(4, sh) : 0)} fill={KIND_META[k].color} />
            })
            return (
              <g key={d.date} opacity={hover && hover !== d.date ? 0.45 : 1}>
                {d.off
                  ? <rect x={x - barW / 2} y={top + plotH - 4} width={barW} height={4} rx={2} fill="var(--c-grid)" />
                  : paths}
                {(isWorst || isToday) && rate(d) != null && (
                  <text className="st-value-label" x={x} y={yTop - 6} textAnchor="middle"
                    style={isWorst ? { fill: 'var(--text-strong)', fontWeight: 700 } : undefined}>
                    {pct(d)}
                  </text>
                )}
                <text x={x} y={height - 20} textAnchor="middle" style={isToday ? { fill: 'var(--text-strong)', fontWeight: 700 } : undefined}>{label}</text>
                <text x={x} y={height - 6} textAnchor="middle" style={{ fontSize: 10, fill: isWorst ? 'var(--text-strong)' : undefined, fontWeight: isWorst ? 700 : undefined }}>
                  {isWorst ? '▲ Lowest' : isToday ? 'so far' : d.off && d.off !== 'Sunday' ? 'Holiday' : ''}
                </text>
                <rect className="st-hit" x={x - slot / 2} y={top} width={slot} height={plotH} tabIndex={0}
                  aria-label={`${d.date}: ${d.off ?? KINDS.map(k => `${KIND_META[k].label} ${d.values[k]}`).join(', ')}`}
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

/** Small column chart: one value per month, the selected month emphasised. */
export function MonthColumns({ points, current, max, format, ticks }: {
  points: { yearMonth: string; value: number | null; tip: ReactNode }[]
  current: string
  max: number
  format: (v: number) => string
  ticks: number[]
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  const [hover, setHover] = useState<string | null>(null)
  const height = 180, top = 20, bottom = 24, left = 44, right = 6
  const plotH = height - top - bottom
  const plotW = Math.max(0, width - left - right)
  const y = (v: number) => top + plotH - (Math.min(v, max) / max) * plotH
  const slot = plotW / Math.max(1, points.length)
  const barW = Math.min(24, slot * 0.5)

  return (
    <div className="st-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Monthly trend">
          {ticks.map(t => (
            <g key={t}>
              <line className={t === 0 ? 'st-baseline' : 'st-gridline'} x1={left} x2={width - right} y1={y(t)} y2={y(t)} />
              <text x={left - 6} y={y(t) + 4} textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            const x = left + (i + 0.5) * slot
            const v = p.value ?? 0
            const bh = Math.max(0, y(0) - y(v))
            const isCur = p.yearMonth === current
            const short = new Date(p.yearMonth + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' })
            const show = () => { setHover(p.yearMonth); setTip({ x, y: y(v), content: p.tip }) }
            const hide = () => { setHover(null); setTip(null) }
            return (
              <g key={p.yearMonth}>
                {bh > 0 && (
                  <path className={`st-bar${hover && hover !== p.yearMonth ? ' is-dim' : ''}`} opacity={isCur || hover === p.yearMonth ? 1 : 0.55}
                    d={roundedBar(x - barW / 2, y(v), barW, bh, 0, 0, Math.min(4, bh))} />
                )}
                {isCur && p.value != null && <text className="st-value-label" x={x} y={y(v) - 6} textAnchor="middle">{format(p.value)}</text>}
                <text x={x} y={height - 8} textAnchor="middle" style={isCur ? { fill: 'var(--text-strong)', fontWeight: 700 } : undefined}>{short}</text>
                <rect className="st-hit" x={x - slot / 2} y={top} width={slot} height={plotH} tabIndex={0}
                  aria-label={`${p.yearMonth}: ${p.value == null ? 'no data' : format(p.value)}`}
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

export type HeatRow = {
  id: string
  name: string
  days: DayStat[]                  // from computeMonthStats
  holidays: Map<string, string>    // date → name (public + their choice holidays)
  activeFrom?: string | null       // joining date
  activeTo?: string | null         // last working day
}

const HEAT_CELL_MIN = 16   // narrowest cell before the chart scrolls sideways
const HEAT_CELL_MAX = 34
const HEAT_ROW = 26
const HEAT_TOP = 30        // day numbers + weekday letters
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** One row per person, one cell per date: on time / late / leave / absent, with Sundays and holidays greyed. */
export function TeamHeatmap({ rows, dates, today }: { rows: HeatRow[]; dates: string[]; today: string }) {
  const [ref, box] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  const [hover, setHover] = useState<{ id: string; date: string } | null>(null)
  const nameW = box < 560 ? 96 : NAME_W
  const n = dates.length
  const cell = Math.min(HEAT_CELL_MAX, Math.max(HEAT_CELL_MIN, Math.floor((box - nameW) / n)))
  const width = nameW + cell * n
  const height = HEAT_TOP + rows.length * HEAT_ROW
  const size = cell - 3, h = HEAT_ROW - 8

  return (
    <div className="st-heat-scroll" ref={ref}>
      {box > 0 && (
        <div className="st-chart" style={{ width }}>
          <svg width={width} height={height} role="img" aria-label="Daily attendance for each person">
            {dates.map((d, j) => {
              const x = nameW + j * cell + cell / 2
              const isToday = d === today
              const style = isToday ? { fill: 'var(--text-strong)', fontWeight: 700 } : { fill: 'var(--text-muted)', opacity: isSunday(d) ? 0.5 : 1 }
              return (
                <g key={d}>
                  {isToday && <rect x={x - cell / 2} y={0} width={cell} height={height} rx={6} fill="var(--c-today)" />}
                  <text x={x} y={11} textAnchor="middle" style={style}>{Number(d.slice(8))}</text>
                  {cell >= 20 && <text x={x} y={23} textAnchor="middle" style={{ ...style, fontSize: 9 }}>{WEEKDAY[new Date(d + 'T00:00:00').getDay()]}</text>}
                </g>
              )
            })}
            {rows.map((r, i) => {
              const byDate = new Map(r.days.map(d => [d.date, d]))
              const y = HEAT_TOP + i * HEAT_ROW + 4
              const dimRow = !!hover && hover.id !== r.id
              return (
                <g key={r.id}>
                  <text x={nameW - 10} y={y + h / 2 + 4} textAnchor="end" style={{ fill: 'var(--text)', fontSize: 12, opacity: dimRow ? 0.5 : 1 }}>{clip(r.name, nameW < NAME_W ? 12 : 18)}</text>
                  {dates.map((d, j) => {
                    const st = cellState(r, d, byDate.get(d), today)
                    if (st.type === 'none') return null
                    const x = nameW + j * cell + 1.5
                    const on = hover?.id === r.id && hover.date === d
                    const show = () => { setHover({ id: r.id, date: d }); setTip({ x: x + size / 2, y: y - 2, content: heatTip(r.name, d, st) }) }
                    const hide = () => { setHover(null); setTip(null) }
                    return (
                      <g key={d} opacity={dimRow ? 0.45 : 1}>
                        <HeatCell x={x} y={y} w={size} h={h} st={st} />
                        {on && <rect x={x - 1.5} y={y - 1.5} width={size + 3} height={h + 3} rx={5} fill="none" stroke="var(--text-strong)" strokeWidth={1.5} />}
                        <rect className="st-hit" x={x - 1.5} y={y - 4} width={cell} height={HEAT_ROW} tabIndex={st.type === 'future' ? -1 : 0}
                          aria-label={`${r.name}, ${heatDay(d)}: ${stateLabel(st)}`}
                          onMouseEnter={show} onFocus={show} onMouseLeave={hide} onBlur={hide} />
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </svg>
          <Tooltip tip={tip} />
        </div>
      )}
    </div>
  )
}

type HeatState =
  | { type: 'none' }                                   // before joining / after leaving / before tracking
  | { type: 'future' }                                 // later this month, or today before check-in
  | { type: 'off'; label: string }                     // Sunday / holiday with no check-in
  | { type: 'day'; day: DayStat }

function cellState(r: HeatRow, date: string, day: DayStat | undefined, today: string): HeatState {
  if ((r.activeFrom && date < r.activeFrom) || (r.activeTo && date > r.activeTo)) return { type: 'none' }
  if (day?.kind) return { type: 'day', day }
  const holiday = r.holidays.get(date)
  if (holiday) return { type: 'off', label: holiday }
  if (isSunday(date)) return { type: 'off', label: 'Sunday' }
  if (date >= today) return { type: 'future' }
  return { type: 'none' }
}

function HeatCell({ x, y, w, h, st }: { x: number; y: number; w: number; h: number; st: HeatState }) {
  if (st.type === 'future') return <rect x={x} y={y} width={w} height={h} rx={4} fill="var(--c-grid)" opacity={0.4} />
  if (st.type === 'off') return <rect x={x} y={y} width={w} height={h} rx={4} fill="var(--c-grid)" />
  if (st.type !== 'day') return null
  const { kind, half } = st.day
  // Half-day leave: leave colour on top, the other half's status below
  if (half && kind !== 'leave') {
    return (
      <g>
        <path d={halfRect(x, y, w, h / 2 - 0.75, 4)} fill={KIND_META.leave.color} />
        <path d={halfRect(x, y + h, w, -(h / 2 - 0.75), 4)} fill={KIND_META[kind!].color} />
      </g>
    )
  }
  return <rect x={x} y={y} width={w} height={h} rx={4} fill={KIND_META[kind!].color} />
}

/** Rect whose two corners on the `y` edge are rounded; a negative h grows upward (the bottom half). */
function halfRect(x: number, y: number, w: number, h: number, r: number) {
  const s = Math.sign(h), a = Math.abs(h)
  r = Math.min(r, w / 2, a)
  return `M ${x} ${y + s * a} V ${y + s * r} Q ${x} ${y} ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + s * r} V ${y + s * a} Z`
}

function stateLabel(st: HeatState) {
  if (st.type === 'future') return 'Not yet'
  if (st.type === 'off') return st.label
  if (st.type !== 'day') return ''
  const k = KIND_META[st.day.kind!].label
  return st.day.half ? (st.day.kind === 'leave' ? 'Half-day leave' : `Half-day leave · ${k}`) : k
}

const heatDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

function heatTip(name: string, date: string, st: HeatState) {
  const day = st.type === 'day' ? st.day : null
  return (
    <>
      <b>{name} · {heatDay(date)}</b>
      <div>{stateLabel(st)}</div>
      {day?.checkIn != null && <div>In {fmtMinutes(day.checkIn)}{day.checkOut != null ? ` · out ${fmtMinutes(day.checkOut)}` : ''}</div>}
      {day && day.worked > 0 && <div>Worked {fmtHM(day.worked)}</div>}
    </>
  )
}

/**
 * Bar path with optional rounding. Horizontal bars: `rl`/`rr` round the left/right ends.
 * Vertical columns: pass `rt` to round the top only.
 */
function roundedBar(x: number, y: number, w: number, h: number, rl: number, rr: number, rt = 0): string {
  if (rt) {
    return `M ${x} ${y + h} V ${y + rt} Q ${x} ${y} ${x + rt} ${y} H ${x + w - rt} Q ${x + w} ${y} ${x + w} ${y + rt} V ${y + h} Z`
  }
  rl = Math.min(rl, w / 2, h / 2)
  rr = Math.min(rr, w / 2, h / 2)
  return `M ${x + rl} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h - rr} Q ${x + w} ${y + h} ${x + w - rr} ${y + h}`
    + ` H ${x + rl} Q ${x} ${y + h} ${x} ${y + h - rl} V ${y + rl} Q ${x} ${y} ${x + rl} ${y} Z`
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
