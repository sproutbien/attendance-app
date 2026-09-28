// Decorative leaf artwork for the employee dashboard. Colours come from the
// --leaf-* CSS tokens so the leaves darken with the theme.

const LEAF = 'M0 0 C 25 -28, 72 -30, 100 0 C 72 30, 25 28, 0 0 Z'
const RIB = 'M6 0 Q 50 -3 94 0'

type LeafProps = { x: number; y: number; r: number; s: number; fill: string; blur?: boolean; opacity?: number }

function Leaf({ x, y, r, s, fill, blur, opacity = 1 }: LeafProps) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} opacity={opacity} filter={blur ? 'url(#sb-leaf-blur)' : undefined}>
      <path d={LEAF} style={{ fill }} />
      <path d={RIB} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M0 0 C 25 -28, 72 -30, 100 0" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={2} />
    </g>
  )
}

/** Branch hanging in from the top-right corner of the hero. */
export function HeroLeaves({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 300 300" aria-hidden="true">
      <defs>
        <linearGradient id="sb-leaf-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--leaf-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--leaf-1)' }} />
        </linearGradient>
        <linearGradient id="sb-leaf-b" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--leaf-1)' }} />
          <stop offset="1" style={{ stopColor: 'var(--leaf-3)' }} />
        </linearGradient>
        <filter id="sb-leaf-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* soft, out-of-focus leaves behind the branch */}
      <Leaf x={150} y={40}  r={25}  s={0.8} fill="var(--leaf-2)" blur opacity={0.35} />
      <Leaf x={110} y={150} r={-20} s={0.7} fill="var(--leaf-2)" blur opacity={0.25} />

      <path d="M320 -10 C 262 60, 214 140, 168 262" fill="none" style={{ stroke: 'var(--leaf-3)' }} strokeWidth={3} strokeLinecap="round" />
      <path d="M306 60 C 290 90, 282 120, 280 170" fill="none" style={{ stroke: 'var(--leaf-3)' }} strokeWidth={2.5} strokeLinecap="round" />

      <Leaf x={296} y={14}  r={205} s={0.85} fill="url(#sb-leaf-b)" />
      <Leaf x={272} y={46}  r={150} s={0.95} fill="url(#sb-leaf-a)" />
      <Leaf x={252} y={82}  r={212} s={1.05} fill="url(#sb-leaf-b)" />
      <Leaf x={232} y={116} r={128} s={1.0}  fill="url(#sb-leaf-a)" />
      <Leaf x={212} y={152} r={196} s={1.15} fill="url(#sb-leaf-b)" />
      <Leaf x={194} y={192} r={112} s={0.95} fill="url(#sb-leaf-a)" />
      <Leaf x={176} y={232} r={172} s={1.05} fill="url(#sb-leaf-b)" />
      <Leaf x={296} y={92}  r={160} s={0.9}  fill="url(#sb-leaf-a)" />
      <Leaf x={286} y={140} r={118} s={0.85} fill="url(#sb-leaf-b)" />
      <Leaf x={281} y={170} r={80}  s={0.75} fill="url(#sb-leaf-a)" />
    </svg>
  )
}

/** Two small leaves peeking in at the bottom-left of the check-in panel. */
export function CornerLeaves({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 110 80" aria-hidden="true">
      <Leaf x={6}  y={84} r={-48} s={0.72} fill="var(--leaf-2)" />
      <Leaf x={34} y={86} r={-18} s={0.55} fill="var(--leaf-2)" opacity={0.8} />
    </svg>
  )
}
