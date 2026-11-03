import { supabase } from './supabase'

/**
 * Birthdays and work anniversaries (migration 047).
 * Team cards open 3 days before and close at the end of the day; admins can write
 * from 30 days before until 3 days after. Only the person (from the day) and admins
 * read the messages; teammates only see who signed.
 */

export type CelebrationKind = 'birthday' | 'anniversary'

export const PHOTO_BUCKET = 'celebration-photos'
export const TEAM_OPENS_DAYS = 3        // team card opens this many days before
export const ADMIN_OPENS_DAYS = 30      // admins can write this early
export const LATE_DAYS = 3              // admins (and the pop-up) up to this many days after

export type Signer = { name: string; photo_path: string | null }

/** A card a teammate can sign right now (team_celebrations RPC). */
export type TeamCelebration = {
  employee_id: string
  full_name: string
  designation: string | null
  photo_path: string | null
  kind: CelebrationKind
  years: number | null
  occasion_date: string
  celebration_id: string | null
  my_message: string | null
  my_photo_path: string | null
  signers: Signer[]
}

export type Wish = {
  id: string
  author_name: string
  author_photo: string | null
  author_designation: string | null
  from_admin: boolean
  message: string
  photo_path: string | null
  created_at: string
}

/** One of the caller's own celebrations (my_celebrations RPC). */
export type MyCelebration = {
  id: string
  kind: CelebrationKind
  years: number | null
  occasion_date: string
  seen_at: string | null
  thanked_at: string | null
  wishes: Wish[]
}

export type Thanks = {
  celebration_id: string
  full_name: string
  photo_path: string | null
  kind: CelebrationKind
  years: number | null
  occasion_date: string
}

export const firstName = (full: string) => full.split(' ')[0]

export function yearsLabel(years: number | null) {
  return `${years ?? 1} year${years === 1 ? '' : 's'}`
}

/** "Priya’s birthday" / "Priya’s 2-year work anniversary" */
export function occasionTitle(name: string, kind: CelebrationKind, years: number | null) {
  const n = firstName(name)
  return kind === 'birthday' ? `${n}’s birthday` : `${n}’s ${years ?? 1}-year work anniversary`
}

/** "Happy birthday, Priya!" / "Happy 2-year anniversary, Priya!" */
export function greeting(name: string, kind: CelebrationKind, years: number | null) {
  const n = firstName(name)
  return kind === 'birthday' ? `Happy birthday, ${n}!` : `Happy ${years ?? 1}-year anniversary, ${n}!`
}

export function fmtOccasion(date: string, withWeekday = true) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-GB', withWeekday
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long' })
}

/** The yearly repeat of `date` between `from` and `to` (29 Feb → 28 Feb in other years). Mirrors yearly_repeat_between(). */
export function repeatBetween(date: string | null, from: string, to: string): string | null {
  if (!date) return null
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    const md = date.slice(5) === '02-29' && !leap ? '02-28' : date.slice(5)
    const d = `${y}-${md}`
    if (d > date && d >= from && d <= to) return d
  }
  return null
}

// ── Server calls ──────────────────────────────────────────────

export async function loadTeamCelebrations(): Promise<TeamCelebration[]> {
  const { data, error } = await supabase.rpc('team_celebrations')
  if (error) throw new Error(error.message)
  return (data ?? []) as TeamCelebration[]
}

export async function loadMyCelebrations(): Promise<MyCelebration[]> {
  const { data, error } = await supabase.rpc('my_celebrations')
  if (error) throw new Error(error.message)
  return (data ?? []) as MyCelebration[]
}

export async function loadThanks(): Promise<Thanks[]> {
  const { data, error } = await supabase.rpc('my_thanks')
  if (error) throw new Error(error.message)
  return (data ?? []) as Thanks[]
}

export async function dismissThanks(celebrationId: string) {
  await supabase.rpc('dismiss_thanks', { p_celebration: celebrationId })
}

export async function markSeen(celebrationId: string, thanked: boolean) {
  await supabase.rpc('celebration_seen', { p_id: celebrationId, p_thanked: thanked })
}

/**
 * Saves the caller's message on a card. `photo`: a new File to upload, null to remove
 * the current photo, undefined to keep it. Returns the celebration id.
 */
export async function signCard(opts: {
  employeeId: string
  kind: CelebrationKind
  occasionDate: string
  message: string
  authorId: string
  currentPhoto: string | null
  photo: File | null | undefined
}): Promise<string> {
  const { data: id, error } = await supabase.rpc('open_celebration', {
    p_employee: opts.employeeId, p_kind: opts.kind, p_occasion: opts.occasionDate,
  })
  if (error) throw new Error(error.message)
  const celebrationId = id as string

  let photoPath = opts.currentPhoto
  if (opts.photo) {
    const blob = await shrinkPhoto(opts.photo)
    const path = `${celebrationId}/${opts.authorId}/${crypto.randomUUID()}.jpg`
    const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
    if (upErr) throw new Error(`The photo didn’t upload: ${upErr.message}`)
    photoPath = path
  } else if (opts.photo === null) {
    photoPath = null
  }

  const { error: signErr } = await supabase.rpc('sign_celebration', {
    p_celebration: celebrationId, p_message: opts.message, p_photo_path: photoPath,
  })
  if (signErr) {
    if (opts.photo && photoPath) await supabase.storage.from(PHOTO_BUCKET).remove([photoPath])
    throw new Error(signErr.message)
  }
  // The old photo is no longer used
  if (opts.currentPhoto && opts.currentPhoto !== photoPath) {
    await supabase.storage.from(PHOTO_BUCKET).remove([opts.currentPhoto])
  }
  return celebrationId
}

export async function removeMyWish(celebrationId: string) {
  const { data, error } = await supabase.rpc('remove_my_wish', { p_celebration: celebrationId })
  if (error) throw new Error(error.message)
  if (data) await supabase.storage.from(PHOTO_BUCKET).remove([data as string])
}

/** Admins: take a photo (or the whole message) off a card. */
export async function adminRemoveWish(wishId: string, photoOnly: boolean) {
  const { data, error } = await supabase.rpc('admin_remove_wish', { p_wish: wishId, p_photo_only: photoOnly })
  if (error) throw new Error(error.message)
  if (data) await supabase.storage.from(PHOTO_BUCKET).remove([data as string])
}

/** Signed links for private card photos, by path. */
export async function photoLinks(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p))]
  if (list.length === 0) return new Map()
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(list, 60 * 60)
  const links = new Map<string, string>()
  for (const d of data ?? []) if (d.path && d.signedUrl) links.set(d.path, d.signedUrl)
  return links
}

// ── Photos ────────────────────────────────────────────────────

const MAX_SIDE = 1600
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'

export function photoProblem(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Choose a JPG, PNG or WebP photo.'
  if (file.size > 25 * 1024 * 1024) return 'That photo is too large (over 25 MB).'
  return null
}

/** Shrinks a photo to at most 1600 px on the long side as a JPEG (keeps phone orientation). */
export async function shrinkPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Couldn’t read that photo.'))), 'image/jpeg', 0.82))
}
