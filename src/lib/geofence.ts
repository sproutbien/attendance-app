import { supabase } from './supabase'
import type { Employee } from '../types'

export type GeofenceRule = Employee['geofence_rule']

export const GEOFENCE_RULE_LABELS: Record<GeofenceRule, string> = {
  default: 'Company setting',
  always:  'Always check',
  never:   'Never check',
}

export const LOCATION_KEEP_DAYS = 30
export const DEFAULT_RADIUS_M = 200

/** The office area this person is checked against today, or null when they aren't (migration 037). */
export type GeofenceArea = { location: string; lat: number; lng: number; radius_m: number; is_strict: boolean }

export async function geofenceArea(employeeId: string): Promise<GeofenceArea | null> {
  const { data, error } = await supabase.rpc('geofence_area', { p_employee: employeeId })
  if (error || !data?.length) return null   // the server still checks at check-in
  return data[0] as GeofenceArea
}

/** What goes on the attendance record: the reading, or why there isn't one. */
export type LocationFields =
  | { check_in_lat: number; check_in_lng: number; check_in_accuracy_m: number }
  | { geofence_note: string }

/** One fresh reading from the phone or browser. */
export function readLocation(): Promise<LocationFields> {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve({ geofence_note: 'This browser can’t share its location' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      p => resolve({
        check_in_lat: p.coords.latitude,
        check_in_lng: p.coords.longitude,
        check_in_accuracy_m: Math.round(p.coords.accuracy),
      }),
      e => resolve({ geofence_note: locationErrorText(e) }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}

function locationErrorText(e: GeolocationPositionError) {
  if (e.code === e.PERMISSION_DENIED) return 'Location permission was blocked'
  if (e.code === e.TIMEOUT) return 'Location took too long to find'
  return 'Location wasn’t available'
}

/** "45 m" / "2.3 km" */
export function fmtDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`
}

export function mapLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

/** Pulls "lat, lng" out of pasted text, e.g. coordinates copied from Google Maps or a Maps link. */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const m = text.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/)
  if (!m) return null
  const lat = Number(m[1]), lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}
