-- ============================================================
-- Sproutbien — Location check (geofence) at check-in
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Each work location can have an area: a centre point and a radius in metres
--     (employee_options.lat / lng / radius_m). Locations without an area (e.g.
--     "Remote") are never checked.
--   • Admin switches it on for everyone (attendance_settings.geofence_required),
--     with a per-person override (employees.geofence_rule: default/always/never).
--     "Strict" (geofence_strict) refuses check-ins clearly outside the area or
--     without a location; otherwise they go through and are flagged.
--   • At check-in the app sends the reading (lat, lng, accuracy); the server
--     works out the distance and one of:
--       inside       within the area
--       unsure       the reading is too rough to tell (e.g. a laptop on Wi-Fi)
--       outside      clearly outside, even allowing for the reading's accuracy
--       no_location  the location couldn't be read (geofence_note says why)
--   • Coordinates are cleared after 30 days (daily job); the result and the
--     distance stay. Check-in only.
-- ============================================================

-- ── Settings ───────────────────────────────────────────────
ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS geofence_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geofence_strict   boolean NOT NULL DEFAULT false;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS geofence_rule text NOT NULL DEFAULT 'default';
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_geofence_rule;
ALTER TABLE employees ADD CONSTRAINT employees_geofence_rule CHECK (geofence_rule IN ('default', 'always', 'never'));

-- ── Office areas on work locations ─────────────────────────
ALTER TABLE employee_options
  ADD COLUMN IF NOT EXISTS lat      double precision,
  ADD COLUMN IF NOT EXISTS lng      double precision,
  ADD COLUMN IF NOT EXISTS radius_m integer;
ALTER TABLE employee_options DROP CONSTRAINT IF EXISTS employee_options_area;
ALTER TABLE employee_options ADD CONSTRAINT employee_options_area CHECK (
  (lat IS NULL AND lng IS NULL AND radius_m IS NULL)
  OR (kind = 'work_location' AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180 AND radius_m BETWEEN 25 AND 5000)
);

-- ── On the attendance record ───────────────────────────────
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS check_in_lat         double precision,
  ADD COLUMN IF NOT EXISTS check_in_lng         double precision,
  ADD COLUMN IF NOT EXISTS check_in_accuracy_m  integer,
  ADD COLUMN IF NOT EXISTS check_in_distance_m  integer,
  ADD COLUMN IF NOT EXISTS geofence_status      text,
  ADD COLUMN IF NOT EXISTS geofence_location    text,   -- the work location checked against
  ADD COLUMN IF NOT EXISTS geofence_note        text;
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_geofence_status;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_geofence_status
  CHECK (geofence_status IS NULL OR geofence_status IN ('inside', 'unsure', 'outside', 'no_location'));
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_geofence_note_length;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_geofence_note_length
  CHECK (geofence_note IS NULL OR length(geofence_note) <= 300);

-- ── Which area (if any) applies to this person today ───────
CREATE OR REPLACE FUNCTION geofence_area(p_employee uuid)
RETURNS TABLE (location text, lat double precision, lng double precision, radius_m integer, is_strict boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.name, o.lat, o.lng, o.radius_m, s.geofence_strict
  FROM employees e
  JOIN attendance_settings s ON s.id
  JOIN employee_options o ON o.kind = 'work_location' AND o.name = e.work_location AND o.lat IS NOT NULL
  WHERE e.id = p_employee
    AND (p_employee = auth.uid() OR is_admin() OR auth.uid() IS NULL)
    AND CASE e.geofence_rule WHEN 'always' THEN true WHEN 'never' THEN false ELSE s.geofence_required END;
$$;

REVOKE EXECUTE ON FUNCTION geofence_area(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION geofence_area(uuid) TO authenticated;

-- Great-circle distance in metres
CREATE OR REPLACE FUNCTION distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ── Checked on the employee's own check-in ─────────────────
CREATE OR REPLACE FUNCTION attendance_check_in_geofence()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checking_in boolean := NEW.check_in_time IS NOT NULL
                           AND (TG_OP = 'INSERT' OR OLD.check_in_time IS NULL);
  a   record;
  d   double precision;
  acc double precision;
BEGIN
  -- Admin entries, approved corrections and server jobs are left alone
  IF auth.uid() IS NULL OR auth.uid() <> NEW.employee_id THEN RETURN NEW; END IF;

  IF v_checking_in THEN
    SELECT * INTO a FROM geofence_area(NEW.employee_id) LIMIT 1;
    IF a.location IS NULL THEN
      -- Not checked for this person: keep nothing
      NEW.check_in_lat := NULL; NEW.check_in_lng := NULL; NEW.check_in_accuracy_m := NULL;
      NEW.check_in_distance_m := NULL; NEW.geofence_status := NULL; NEW.geofence_location := NULL; NEW.geofence_note := NULL;
      RETURN NEW;
    END IF;

    NEW.geofence_location := a.location;
    IF NEW.check_in_lat IS NULL OR NEW.check_in_lng IS NULL THEN
      NEW.check_in_lat := NULL; NEW.check_in_lng := NULL; NEW.check_in_accuracy_m := NULL; NEW.check_in_distance_m := NULL;
      NEW.geofence_status := 'no_location';
      NEW.geofence_note := COALESCE(NULLIF(trim(NEW.geofence_note), ''), 'Location not shared');
      IF a.is_strict THEN
        RAISE EXCEPTION 'Your company needs your location to check in. Allow location access and try again.';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.check_in_lat NOT BETWEEN -90 AND 90 OR NEW.check_in_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'That location doesn''t look right. Please try again.';
    END IF;
    acc := GREATEST(COALESCE(NEW.check_in_accuracy_m, 0), 0);
    d := distance_m(NEW.check_in_lat, NEW.check_in_lng, a.lat, a.lng);
    NEW.check_in_distance_m := round(d);
    NEW.check_in_accuracy_m := round(acc);
    NEW.geofence_note := NULL;
    NEW.geofence_status := CASE
      WHEN d <= a.radius_m AND acc <= a.radius_m THEN 'inside'
      WHEN d - acc > a.radius_m THEN 'outside'
      ELSE 'unsure'
    END;
    IF a.is_strict AND NEW.geofence_status = 'outside' THEN
      RAISE EXCEPTION 'You’re about % from % — check-in only works inside the office area.',
        CASE WHEN d >= 1000 THEN round((d / 1000)::numeric, 1) || ' km' ELSE round(d) || ' m' END, a.location;
    END IF;
    RETURN NEW;
  END IF;

  -- Otherwise employees can't add or change the location fields
  IF TG_OP = 'INSERT' THEN
    NEW.check_in_lat := NULL; NEW.check_in_lng := NULL; NEW.check_in_accuracy_m := NULL;
    NEW.check_in_distance_m := NULL; NEW.geofence_status := NULL; NEW.geofence_location := NULL; NEW.geofence_note := NULL;
  ELSIF NOT is_admin() AND (
       NEW.check_in_lat IS DISTINCT FROM OLD.check_in_lat OR NEW.check_in_lng IS DISTINCT FROM OLD.check_in_lng
    OR NEW.check_in_accuracy_m IS DISTINCT FROM OLD.check_in_accuracy_m OR NEW.check_in_distance_m IS DISTINCT FROM OLD.check_in_distance_m
    OR NEW.geofence_status IS DISTINCT FROM OLD.geofence_status OR NEW.geofence_location IS DISTINCT FROM OLD.geofence_location
    OR NEW.geofence_note IS DISTINCT FROM OLD.geofence_note) THEN
    RAISE EXCEPTION 'The check-in location can''t be changed.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_check_in_geofence ON attendance_records;
CREATE TRIGGER attendance_check_in_geofence
  BEFORE INSERT OR UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION attendance_check_in_geofence();

-- ── Coordinates kept 30 days; the result and distance stay ─
CREATE OR REPLACE FUNCTION clear_old_check_in_locations()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE attendance_records
     SET check_in_lat = NULL, check_in_lng = NULL, check_in_accuracy_m = NULL
   WHERE check_in_lat IS NOT NULL AND date < current_date - 30;
$$;

REVOKE EXECUTE ON FUNCTION clear_old_check_in_locations() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('clear-old-check-in-locations')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clear-old-check-in-locations');
SELECT cron.schedule('clear-old-check-in-locations', '50 18 * * *', $$SELECT clear_old_check_in_locations()$$);
