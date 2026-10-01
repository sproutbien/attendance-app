-- ============================================================
-- Sproutbien — Employee management: full profile + employment status
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Adds to employees: employee ID (SB001…), profile photo, employment type,
-- work location, reporting manager, emergency contact, last working day,
-- and the full employment-status list:
--
--   active, probation, on_notice   → work normally
--   on_long_leave                   → can log in, not marked Absent
--   resigned, terminated, inactive  → login blocked, left out of
--                                     attendance / leave / payroll lists
--
-- HR notes live in their own admin-only table (employees can read their
-- own employees row, so they can't go there).
-- Department / work location / employment type come from admin-managed
-- lists (employee_options).
-- ============================================================

-- ── Employment status ───────────────────────────────────────
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_status_check
  CHECK (status IN ('active', 'probation', 'on_notice', 'on_long_leave', 'resigned', 'terminated', 'inactive'));

-- ── New profile columns ─────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_code              text,
  ADD COLUMN IF NOT EXISTS photo_path                 text,   -- object path in the 'avatars' bucket
  ADD COLUMN IF NOT EXISTS employment_type            text,
  ADD COLUMN IF NOT EXISTS work_location              text,
  ADD COLUMN IF NOT EXISTS reporting_manager_id       uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_working_day           date,
  ADD COLUMN IF NOT EXISTS emergency_contact_name     text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relation text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone    text;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_manager_not_self;
ALTER TABLE employees ADD CONSTRAINT employees_manager_not_self
  CHECK (reporting_manager_id IS NULL OR reporting_manager_id <> id);

-- ── Employee ID: SB001, SB002, … (editable, unique) ─────────
CREATE SEQUENCE IF NOT EXISTS employee_code_seq;

-- Backfill existing staff in the order they were added
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, full_name) AS n
  FROM employees WHERE employee_code IS NULL
)
UPDATE employees e
   SET employee_code = 'SB' || lpad((n + (SELECT count(*) FROM employees WHERE employee_code IS NOT NULL))::text, 3, '0')
  FROM numbered WHERE e.id = numbered.id;

SELECT setval('employee_code_seq', greatest((SELECT count(*) FROM employees), 1), (SELECT count(*) FROM employees) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_code_key ON employees (upper(employee_code));

CREATE OR REPLACE FUNCTION assign_employee_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
BEGIN
  NEW.employee_code := nullif(upper(trim(NEW.employee_code)), '');
  IF NEW.employee_code IS NULL THEN
    LOOP  -- skip numbers an admin has already used by hand
      v_code := 'SB' || lpad(nextval('employee_code_seq')::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM employees WHERE upper(employee_code) = v_code);
    END LOOP;
    NEW.employee_code := v_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_assign_code ON employees;
CREATE TRIGGER employees_assign_code
  BEFORE INSERT OR UPDATE OF employee_code ON employees
  FOR EACH ROW EXECUTE FUNCTION assign_employee_code();

ALTER TABLE employees ALTER COLUMN employee_code SET NOT NULL;

-- ── Admin rights need a working status ──────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
      AND status NOT IN ('resigned', 'terminated', 'inactive')
  );
$$;

-- ── Status change → block / allow login ─────────────────────
-- Resigned, terminated, inactive and binned employees can't log in.
CREATE OR REPLACE FUNCTION sync_employee_login()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_blocked boolean := NEW.deleted_at IS NOT NULL OR NEW.status IN ('resigned', 'terminated', 'inactive');
BEGIN
  -- An admin locking themselves out (or dropping their own admin role) could leave nobody in charge
  IF NEW.id = auth.uid() AND (v_blocked OR (OLD.role = 'admin' AND NEW.role <> 'admin')) THEN
    RAISE EXCEPTION 'You cannot change your own status or role. Ask another admin';
  END IF;

  IF v_blocked THEN
    UPDATE auth.users SET banned_until = 'infinity' WHERE id = NEW.id;
    DELETE FROM auth.sessions WHERE user_id = NEW.id;
  ELSE
    UPDATE auth.users SET banned_until = NULL WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_sync_login ON employees;
CREATE TRIGGER employees_sync_login
  AFTER UPDATE OF status, deleted_at, role ON employees
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
     OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
     OR OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION sync_employee_login();

-- Employees deactivated before this migration could still log in — block them now
UPDATE auth.users SET banned_until = 'infinity'
 WHERE id IN (SELECT id FROM employees WHERE status = 'inactive');

-- ── Notice period ends → Resigned (daily, 00:05 IST) ────────
CREATE OR REPLACE FUNCTION close_ended_notice_periods()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE employees SET status = 'resigned'
   WHERE status = 'on_notice'
     AND last_working_day < (now() AT TIME ZONE 'Asia/Kolkata')::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_ended_notice_periods() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('close-notice-periods', '35 18 * * *', $$SELECT close_ended_notice_periods()$$);

-- ── HR notes (admin only) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_hr_notes (
  employee_id uuid        PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  notes       text        NOT NULL DEFAULT '',
  updated_by  uuid        REFERENCES employees(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_hr_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr_notes: admin all" ON employee_hr_notes;
CREATE POLICY "hr_notes: admin all"
  ON employee_hr_notes FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── Admin-managed lists ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_options (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text        NOT NULL CHECK (kind IN ('department', 'work_location', 'employment_type')),
  name       text        NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, name)
);

ALTER TABLE employee_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_options: everyone reads" ON employee_options;
CREATE POLICY "employee_options: everyone reads"
  ON employee_options FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "employee_options: admin write" ON employee_options;
CREATE POLICY "employee_options: admin write"
  ON employee_options FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

INSERT INTO employee_options (kind, name) VALUES
  ('employment_type', 'Full-time'),
  ('employment_type', 'Part-time'),
  ('employment_type', 'Intern'),
  ('employment_type', 'Contract')
ON CONFLICT DO NOTHING;

-- Departments already typed in become the starting list
INSERT INTO employee_options (kind, name)
SELECT DISTINCT 'department', trim(department) FROM employees WHERE nullif(trim(department), '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Renaming an option renames it on every employee that uses it
CREATE OR REPLACE FUNCTION rename_employee_option(p_id uuid, p_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old employee_options;
  v_new text := trim(p_name);
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can edit lists';
  END IF;
  SELECT * INTO v_old FROM employee_options WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Option not found'; END IF;

  UPDATE employee_options SET name = v_new WHERE id = p_id;
  IF v_old.kind = 'department' THEN
    UPDATE employees SET department = v_new WHERE department = v_old.name;
  ELSIF v_old.kind = 'work_location' THEN
    UPDATE employees SET work_location = v_new WHERE work_location = v_old.name;
  ELSE
    UPDATE employees SET employment_type = v_new WHERE employment_type = v_old.name;
  END IF;
END;
$$;

-- ── Profile photos ──────────────────────────────────────────
-- Public bucket (photos show in the app without signed URLs); files sit
-- under <employee id>/…, and only that employee or an admin can write there.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars: own folder or admin insert" ON storage.objects;
CREATE POLICY "avatars: own folder or admin insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "avatars: own folder or admin update" ON storage.objects;
CREATE POLICY "avatars: own folder or admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "avatars: own folder or admin delete" ON storage.objects;
CREATE POLICY "avatars: own folder or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- Employees can't update their own employees row, so they set their photo through this
CREATE OR REPLACE FUNCTION set_employee_photo(p_employee uuid, p_path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_employee <> auth.uid() AND NOT is_admin() THEN
    RAISE EXCEPTION 'You can only change your own photo';
  END IF;
  IF p_path IS NOT NULL AND split_part(p_path, '/', 1) <> p_employee::text THEN
    RAISE EXCEPTION 'Invalid photo path';
  END IF;
  UPDATE employees SET photo_path = p_path WHERE id = p_employee;
END;
$$;
