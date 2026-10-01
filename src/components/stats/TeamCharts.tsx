import { useState } from 'react'
import type { ReactNode } from 'react'
import { KIND_META, Tooltip, useWidth } from './Charts'
import type { Tip } from './Charts'
import { fmtDays } from '../../lib/stats'
import type { DayKind } from '../../lib/stats'

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
