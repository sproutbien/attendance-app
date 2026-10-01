import { supabase } from './supabase'
import type { Employee, EmployeeOptionKind, EmployeeStatus } from '../types'

// Employment statuses — must match the CHECK constraint and login rules in migration 019.

export const EMPLOYEE_STATUSES: EmployeeStatus[] = [
  'active', 'probation', 'on_notice', 'on_long_leave', 'resigned', 'terminated', 'inactive',
]

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active:        'Active',
  probation:     'Probation',
  on_notice:     'On notice',
  on_long_leave: 'On long leave',
  resigned:      'Resigned',
  terminated:    'Terminated',
  inactive:      'Inactive',
}

export const EMPLOYEE_STATUS_COLORS: Record<EmployeeStatus, { bg: string; text: string }> = {
  active:        { bg: '#dcfce7', text: '#166534' },
  probation:     { bg: '#e0f2fe', text: '#075985' },
  on_notice:     { bg: '#fef3c7', text: '#92400e' },
  on_long_leave: { bg: '#ede9fe', text: '#5b21b6' },
  resigned:      { bg: '#f1f5f9', text: '#475569' },
  terminated:    { bg: '#fee2e2', text: '#991b1b' },
  inactive:      { bg: '#f1f5f9', text: '#64748b' },
}

/** Statuses whose attendance is tracked (they show in attendance, leave and payroll lists). */
export const TRACKED_STATUSES: EmployeeStatus[] = ['active', 'probation', 'on_notice', 'on_long_leave']

/** Statuses that can't log in. */
export const BLOCKED_STATUSES: EmployeeStatus[] = ['resigned', 'terminated', 'inactive']

/** Statuses that come with a last working day. */
export const LEAVING_STATUSES: EmployeeStatus[] = ['on_notice', 'resigned', 'terminated']

export const OPTION_KIND_LABELS: Record<EmployeeOptionKind, string> = {
  department:      'Departments',
  work_location:   'Work locations',
  employment_type: 'Employment types',
}

export function photoUrl(e: Pick<Employee, 'photo_path'>): string | null {
  return e.photo_path ? supabase.storage.from('avatars').getPublicUrl(e.photo_path).data.publicUrl : null
}

export function initials(name: string) {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
}

const PHOTO_SIZE = 320   // px, square

/** Centre-crops and shrinks an image to a small square JPEG. */
async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(PHOTO_SIZE, side)
  canvas.getContext('2d')!.drawImage(
    bitmap,
    (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
    0, 0, canvas.width, canvas.height,
  )
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not read that image'))), 'image/jpeg', 0.85))
}

/**
 * Uploads a new profile photo (or removes it when `file` is null) and points the
 * employee at it. Returns the new path, or throws with a readable message.
 */
export async function savePhoto(employee: Pick<Employee, 'id' | 'photo_path'>, file: File | null): Promise<string | null> {
  let path: string | null = null
  if (file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file')
    const blob = await squareJpeg(file)
    // New name each time so browsers don't keep showing the cached old photo
    path = `${employee.id}/${Date.now()}.jpg`
    const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' })
    if (error) throw new Error(error.message)
  }
  const { error } = await supabase.rpc('set_employee_photo', { p_employee: employee.id, p_path: path })
  if (error) throw new Error(error.message)
  if (employee.photo_path) await supabase.storage.from('avatars').remove([employee.photo_path])
  return path
}

/** "+91 98765 43210" / "9876543210" → "919876543210"; null if blank, undefined if invalid */
export function normalizePhone(input: string): string | null | undefined {
  const digits = input.replace(/\D/g, '')
  if (digits === '') return null
  const full = digits.length === 10 ? `91${digits}` : digits // bare 10-digit = Indian mobile
  return /^[1-9][0-9]{7,14}$/.test(full) ? full : undefined
}

export function fmtPhone(phone: string) {
  return phone.startsWith('91') && phone.length === 12
    ? `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`
    : `+${phone}`
}

export function fmtDate(d: string | Date) {
  return (typeof d === 'string' ? new Date(`${d.slice(0, 10)}T00:00:00`) : d)
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
