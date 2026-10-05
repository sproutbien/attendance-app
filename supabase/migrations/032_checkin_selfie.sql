-- ============================================================
-- Sproutbien — Selfie at check-in
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Admin switches it on for everyone (attendance_settings.selfie_required)
--     and can override per person (employees.selfie_rule: default/always/never).
--   • When it applies, the employee takes a selfie with the camera to check in.
--     If the camera doesn't work they can still check in; the day is flagged
--     "No selfie" with the reason (selfie_missing_reason) for the admin.
--   • Selfies live in the private 'checkin-selfies' bucket under <employee id>/…
--     The employee and admins can see them. They're deleted after 15 days:
--     the app removes expired files through the Storage API whenever an admin
--     or the employee opens it (SQL can't delete Storage files).
--   • Only check-in. Admin edits, corrections and server jobs aren't affected.
-- ============================================================

-- ── Company setting (one row) ──────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_settings (
  id              boolean     PRIMARY KEY DEFAULT true CHECK (id),   -- a single row
  selfie_required boolean     NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        REFERENCES employees(id) ON DELETE SET NULL
);
INSERT INTO attendance_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE attendance_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_settings: everyone reads" ON attendance_settings;
CREATE POLICY "attendance_settings: everyone reads" ON attendance_settings FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "attendance_settings: admin update" ON attendance_settings;
CREATE POLICY "attendance_settings: admin update" ON attendance_settings FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- ── Per-person override ────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS selfie_rule text NOT NULL DEFAULT 'default';
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_selfie_rule;
ALTER TABLE employees ADD CONSTRAINT employees_selfie_rule CHECK (selfie_rule IN ('default', 'always', 'never'));

-- ── On the attendance record ───────────────────────────────
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS selfie_path           text,   -- object path in 'checkin-selfies'
  ADD COLUMN IF NOT EXISTS selfie_missing_reason text;   -- set = checked in without the required selfie

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_selfie_owner;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_selfie_owner
  CHECK (selfie_path IS NULL OR selfie_path LIKE employee_id::text || '/%');

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_selfie_reason_length;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_selfie_reason_length
  CHECK (selfie_missing_reason IS NULL OR length(selfie_missing_reason) <= 300);

-- A selfie belongs to one check-in
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_selfie_path_key
  ON attendance_records (selfie_path) WHERE selfie_path IS NOT NULL;

-- ── Does this person need a selfie to check in? ────────────
CREATE OR REPLACE FUNCTION selfie_required(p_employee uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE e.selfie_rule
           WHEN 'always' THEN true
           WHEN 'never'  THEN false
           ELSE COALESCE((SELECT s.selfie_required FROM attendance_settings s WHERE s.id), false)
         END
  FROM employees e
  WHERE e.id = p_employee AND (p_employee = auth.uid() OR is_admin() OR auth.uid() IS NULL);
$$;

REVOKE EXECUTE ON FUNCTION selfie_required(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION selfie_required(uuid) TO authenticated;

-- ── Enforced on the employee's own check-in ────────────────
CREATE OR REPLACE FUNCTION attendance_check_in_selfie()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checking_in boolean := NEW.check_in_time IS NOT NULL
                           AND (TG_OP = 'INSERT' OR OLD.check_in_time IS NULL);
BEGIN
  -- Admin entries, approved corrections and server jobs are left alone
  IF auth.uid() IS NULL OR auth.uid() <> NEW.employee_id THEN RETURN NEW; END IF;

  IF v_checking_in THEN
    NEW.selfie_missing_reason := NULLIF(trim(NEW.selfie_missing_reason), '');
    IF NEW.selfie_path IS NOT NULL THEN
      -- Must be a photo just uploaded, not an older one reused
      IF NOT EXISTS (SELECT 1 FROM storage.objects o
                     WHERE o.bucket_id = 'checkin-selfies' AND o.name = NEW.selfie_path
                       AND o.created_at > now() - interval '15 minutes') THEN
        RAISE EXCEPTION 'The selfie didn''t upload. Please take it again.';
      END IF;
      NEW.selfie_missing_reason := NULL;
    ELSIF selfie_required(NEW.employee_id) THEN
      IF NEW.selfie_missing_reason IS NULL THEN
        RAISE EXCEPTION 'A selfie is needed to check in.';
      END IF;
    ELSE
      NEW.selfie_missing_reason := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Otherwise employees can't add or change the selfie fields
  IF TG_OP = 'INSERT' THEN
    NEW.selfie_path := NULL;
    NEW.selfie_missing_reason := NULL;
  ELSIF NOT is_admin()
    AND (NEW.selfie_path IS DISTINCT FROM OLD.selfie_path
         OR NEW.selfie_missing_reason IS DISTINCT FROM OLD.selfie_missing_reason) THEN
    RAISE EXCEPTION 'The check-in selfie can''t be changed.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_check_in_selfie ON attendance_records;
CREATE TRIGGER attendance_check_in_selfie
  BEFORE INSERT OR UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION attendance_check_in_selfie();

-- ── Storage ────────────────────────────────────────────────
-- Private; the app saves a small JPEG (about 50–100 KB)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('checkin-selfies', 'checkin-selfies', false, 1048576, ARRAY['image/jpeg', 'image/webp', 'image/png'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "checkin-selfies: own folder insert" ON storage.objects;
CREATE POLICY "checkin-selfies: own folder insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'checkin-selfies' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "checkin-selfies: own folder or admin read" ON storage.objects;
CREATE POLICY "checkin-selfies: own folder or admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'checkin-selfies' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- Admins: any. Employees: an upload whose check-in then failed, or their own expired selfies.
DROP POLICY IF EXISTS "checkin-selfies: expired, unattached own or admin delete" ON storage.objects;
CREATE POLICY "checkin-selfies: expired, unattached own or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'checkin-selfies'
    AND (public.is_admin()
         OR ((storage.foldername(name))[1] = auth.uid()::text
             AND (created_at < now() - interval '15 days'
                  OR NOT EXISTS (SELECT 1 FROM public.attendance_records r WHERE r.selfie_path = storage.objects.name))))
  );

-- Files past 15 days, for the app to remove (admins: everyone's; employees: their own)
CREATE OR REPLACE FUNCTION expired_checkin_selfies()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.name FROM storage.objects o
  WHERE o.bucket_id = 'checkin-selfies'
    AND o.created_at < now() - interval '15 days'
    AND (is_admin() OR (storage.foldername(o.name))[1] = auth.uid()::text)
  ORDER BY o.created_at
  LIMIT 500;
$$;

REVOKE EXECUTE ON FUNCTION expired_checkin_selfies() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION expired_checkin_selfies() TO authenticated;
