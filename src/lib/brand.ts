import { supabase } from './supabase'

/**
 * White-label branding (migration 035). One row in `branding`, readable before
 * sign-in. The brand colour becomes a set of CSS variables:
 *   --brand-50 … --brand-950, --brand-side   admin area and shared bits
 *   --green*, --bg, --text*, --side-bg …     employee area tokens (app.css)
 *   --auth-*                                 login screens (auth.css)
 * With the default colour nothing is injected, so the hand-tuned defaults in
 * the stylesheets stay exactly as they are.
 */

export type Branding = {
  app_name: string
  tagline: string
  product_name: string
  company_name: string
  company_address: string
  support_email: string
  support_phone: string
  primary_color: string
  logo_path: string | null
  icon_path: string | null
  admin_edit_look: boolean      // customer admins may change logo, icon, colour (migration 036)
  admin_edit_details: boolean   // … and names + contact details
  updated_at?: string
}

export const DEFAULT_BRANDING: Branding = {
  app_name: 'SproutBien',
  tagline: 'nurturing businesses digitally',
  product_name: 'Attendance Tracker',
  company_name: 'Sproutbien',
  company_address: '',
  support_email: '',
  support_phone: '',
  primary_color: '#2a7a22',
  logo_path: null,
  icon_path: null,
  admin_edit_look: false,
  admin_edit_details: false,
}

export const BRANDING_BUCKET = 'branding'
const BUILT_IN_LOGO = '/logo.jpg'
const CACHE_KEY = 'sb.branding'

export function logoUrl(b: Branding): string {
  return b.logo_path ? supabase.storage.from(BRANDING_BUCKET).getPublicUrl(b.logo_path).data.publicUrl : BUILT_IN_LOGO
}

/** Square mark for the sidebar and browser tab; falls back to the logo. */
export function iconUrl(b: Branding): string {
  return b.icon_path ? supabase.storage.from(BRANDING_BUCKET).getPublicUrl(b.icon_path).data.publicUrl : logoUrl(b)
}

export function isDefaultColor(hex: string) {
  return hex.toLowerCase() === DEFAULT_BRANDING.primary_color
}

// ── Colour maths (OKLCH, so shades of any hue look evenly spaced) ──────────

type Lch = { l: number; c: number; h: number }

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255) as [number, number, number]
}
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

export function hexToLch(hex: string): Lch {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 }
}

function lchToLinear({ l, c, h }: Lch): [number, number, number] {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

/** OKLCH → hex, lowering chroma until it fits in sRGB. */
export function lchToHex(lch: Lch): string {
  let { c } = lch
  let rgb = lchToLinear({ ...lch, c })
  for (let i = 0; i < 30 && rgb.some(v => v < -0.0005 || v > 1.0005); i++) {
    c *= 0.92
    rgb = lchToLinear({ ...lch, c })
  }
  return '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255)
    .toString(16).padStart(2, '0')).join('')
}

/** WCAG contrast ratio between two hex colours (1–21). */
export function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map(toLinear)
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// Lightness/chroma profile of a well-balanced 50–950 scale (Tailwind's green, in OKLCH)
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
const STEP_L = [0.982, 0.962, 0.925, 0.871, 0.792, 0.723, 0.627, 0.527, 0.448, 0.393, 0.266]
const STEP_C = [0.09, 0.23, 0.43, 0.77, 1.03, 1.13, 1.0, 0.79, 0.61, 0.43, 0.34]   // × the brand's own chroma

export type Palette = Record<(typeof STEPS)[number], string> & { side: string; sideMuted: string; base: string }

/**
 * The brand colour as a 50–950 scale. 600 (buttons, headings) is the exact
 * colour when white text on it is readable, otherwise the nearest darker shade
 * that is; the steps around it stay lighter above and darker below.
 */
export function brandPalette(hex: string): Palette {
  const base = hexToLch(hex)
  const c = Math.max(base.c, 0.01)
  const make = (l: number, i: number) => lchToHex({ l, c: c * STEP_C[i], h: base.h })

  let main = hex.toLowerCase()
  let mainL = base.l
  while (contrast('#ffffff', main) < 4.5 && mainL > 0.2) {
    mainL -= 0.01
    main = lchToHex({ l: mainL, c, h: base.h })
  }

  const out = {} as Palette
  STEPS.forEach((step, i) => {
    const gap = STEP_L[i] - STEP_L[6]                         // distance from 600 on the reference scale
    const l = gap > 0 ? Math.max(STEP_L[i], mainL + gap) : Math.min(STEP_L[i], mainL + gap)
    out[step] = make(Math.min(0.985, Math.max(0.15, l)), i)
  })
  out[600] = main
  // Sidebar: the brand itself, darkened if needed so white text stays readable
  out.side = base.l <= 0.5 ? hex.toLowerCase() : lchToHex({ l: 0.46, c, h: base.h })
  out.sideMuted = lchToHex({ l: 0.82, c: c * 0.45, h: base.h })
  out.base = hex.toLowerCase()
  return out
}

/** How readable the main brand uses are; anything under 4.5 deserves a warning. */
export function brandChecks(hex: string) {
  const p = brandPalette(hex)
  const darkened = p[600] !== p.base
  return [
    {
      label: 'White text on buttons',
      ratio: contrast('#ffffff', p[600]),
      note: darkened ? 'buttons use a slightly darker shade of your colour so the text stays readable' : '',
    },
    { label: 'Current page in the menu', ratio: contrast(p[700], p[50]), note: '' },
    { label: 'Brand-coloured text and links on white', ratio: contrast(p[700], '#ffffff'), note: '' },
  ]
}

/** CSS that re-colours the whole app for a brand colour ('' for the default). */
export function brandCss(hex: string): string {
  if (isDefaultColor(hex)) return ''
  const p = brandPalette(hex)
  const { c, h } = hexToLch(hex)
  const tone = (l: number, cf: number) => lchToHex({ l, c: c * cf, h })
  // Background tints: gentle, and none at all for a grey brand
  const tint = (l: number, cn: number) => lchToHex({ l, c: cn * Math.min(1, c / 0.12), h })

  const light = `
    --green: ${tone(0.5, 0.95)}; --green-dark: ${tone(0.4, 0.8)}; --green-soft: ${tint(0.95, 0.035)};
    --green-btn-1: ${tone(0.55, 1)}; --green-btn-2: ${tone(0.43, 0.9)};
    --bg: ${tint(0.975, 0.008)}; --surface-soft: ${tint(0.965, 0.012)}; --border: ${tint(0.92, 0.014)};
    --border-soft: ${tint(0.95, 0.01)}; --row-hover: ${tint(0.98, 0.008)}; --grey-soft: ${tint(0.945, 0.006)};
    --text-strong: ${tint(0.25, 0.03)}; --text: ${tint(0.36, 0.025)}; --text-muted: ${tint(0.52, 0.02)}; --text-faint: ${tint(0.7, 0.014)};`
  const dark = `
    --green: ${tone(0.8, 0.9)}; --green-dark: ${tone(0.85, 0.8)}; --green-soft: ${tint(0.3, 0.045)};
    --green-btn-1: ${tone(0.55, 1)}; --green-btn-2: ${tone(0.45, 0.9)};
    --bg: ${tint(0.17, 0.015)}; --surface: ${tint(0.205, 0.016)}; --surface-soft: ${tint(0.235, 0.02)};
    --border: ${tint(0.31, 0.025)}; --border-soft: ${tint(0.27, 0.02)}; --row-hover: ${tint(0.235, 0.02)}; --grey-soft: ${tint(0.25, 0.012)};
    --text-strong: ${tint(0.95, 0.012)}; --text: ${tint(0.87, 0.015)}; --text-muted: ${tint(0.72, 0.02)}; --text-faint: ${tint(0.55, 0.02)};`

  return `
html:root {
  ${STEPS.map(s => `--brand-${s}: ${p[s]};`).join(' ')}
  --brand-side: ${p.side};
  --auth-ink: ${tone(0.3, 0.7)}; --auth-accent: ${tone(0.6, 1)}; --auth-link: ${tone(0.52, 1)};
  --auth-focus: ${tone(0.7, 0.8)}; --auth-ring: ${tone(0.6, 1)}24;
  --auth-btn: linear-gradient(90deg, ${tone(0.4, 0.8)} 0%, ${tone(0.47, 0.9)} 45%, ${tone(0.6, 1)} 100%);
  --auth-btn-shadow: ${tone(0.5, 1)}8c; --auth-card-shadow: ${tone(0.35, 0.6)}2e;
  --auth-bg-1: ${tint(0.97, 0.008)}; --auth-bg-2: ${tint(0.945, 0.012)}; --auth-bg-3: ${tint(0.93, 0.012)};
  --auth-glow-1: ${tint(0.925, 0.02)}; --auth-glow-2: ${tint(0.935, 0.018)}; --auth-glow-3: ${tint(0.945, 0.012)};
}
html .sb-app {${light}
}
html .sb-app[data-theme="dark"] {${dark}
}
@media (prefers-color-scheme: dark) {
  html .sb-app:not([data-theme="light"]) {${dark}
  }
}`
}

/** Applies colours, page title and browser-tab icon. */
export function applyBranding(b: Branding) {
  let style = document.getElementById('brand-theme') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'brand-theme'
    document.head.appendChild(style)
  }
  style.textContent = brandCss(b.primary_color)
  document.title = [b.app_name, b.product_name].filter(Boolean).join(' ')
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!icon) {
    icon = document.createElement('link')
    icon.rel = 'icon'
    document.head.appendChild(icon)
  }
  icon.href = iconUrl(b)
}

export function cachedBranding(): Branding {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return { ...DEFAULT_BRANDING, ...JSON.parse(raw) }
  } catch { /* storage blocked or bad JSON */ }
  return DEFAULT_BRANDING
}

export async function fetchBranding(): Promise<Branding | null> {
  const { data, error } = await supabase.from('branding').select('*').maybeSingle()
  if (error || !data) return null
  const b = { ...DEFAULT_BRANDING, ...data } as Branding
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(b)) } catch { /* fine */ }
  return b
}

/** Splits "SproutBien" into "Sprout" + "Bien" for the two-tone wordmark; other names stay whole. */
export function wordmarkParts(name: string): [string, string] {
  const m = name.match(/^([A-Z][a-z]+)([A-Z][a-z]+)$/)
  return m ? [m[1], m[2]] : [name, '']
}
