-- ============================================================
-- Sproutbien — Delete employees to a bin (kept 6 months)
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Deleting an employee moves them to the bin: employees.deleted_at is set,
-- status becomes 'inactive' (so every report / attendance / leave list that
-- filters on active staff drops them) and their login is blocked.
-- From the bin an admin can restore them, or delete them permanently.
-- A daily pg_cron job permanently deletes anyone binned more than 6 months ago.
--
-- Permanent delete removes the auth user; employees, attendance, leave,
-- corrections and leave adjustments cascade away with it. Rows they *reviewed*
-- as an admin are kept, with the reviewer cleared.
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── A binned admin is no longer an admin ────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
  );
$$;

-- ── Reviewer / creator links must not block a permanent delete ──
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_reviewed_by_fkey;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE attendance_corrections DROP CONSTRAINT IF EXISTS attendance_corrections_reviewed_by_fkey;
ALTER TABLE attendance_corrections
  ADD CONSTRAINT attendance_corrections_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE leave_adjustments DROP CONSTRAINT IF EXISTS leave_adjustments_created_by_fkey;
ALTER TABLE leave_adjustments
  ADD CONSTRAINT leave_adjustments_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;

-- ── Move to bin ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bin_employee(p_employee uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can delete employees';
  END IF;
  IF p_employee = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete your own account';
  END IF;

  UPDATE employees
     SET deleted_at = now(), status = 'inactive'
   WHERE id = p_employee AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found or already in the bin';
  END IF;

  -- Block login and sign them out everywhere
  UPDATE auth.users SET banned_until = 'infinity' WHERE id = p_employee;
  DELETE FROM auth.sessions WHERE user_id = p_employee;
END;
$$;

-- ── Restore from bin (comes back active) ────────────────────
CREATE OR REPLACE FUNCTION restore_employee(p_employee uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can restore employees';
  END IF;

  UPDATE employees
     SET deleted_at = NULL, status = 'active'
   WHERE id = p_employee AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee is not in the bin';
  END IF;

  UPDATE auth.users SET banned_until = NULL WHERE id = p_employee;
END;
$$;

-- ── Delete permanently (only from the bin) ──────────────────
CREATE OR REPLACE FUNCTION purge_employee(p_employee uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can delete employees';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Only employees in the bin can be deleted permanently';
  END IF;

  DELETE FROM auth.users WHERE id = p_employee;   -- cascades to employees and their records
END;
$$;

-- ── Daily auto-purge of anyone binned > 6 months ago ────────
CREATE OR REPLACE FUNCTION purge_expired_binned_employees()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  purged integer;
BEGIN
  DELETE FROM auth.users
   WHERE id IN (SELECT id FROM employees WHERE deleted_at < now() - interval '6 months');
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_expired_binned_employees() FROM PUBLIC, anon, authenticated;

-- 03:00 IST every day (21:30 UTC). Re-running this file updates the job.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'purge-binned-employees',
  '30 21 * * *',
  $$SELECT purge_expired_binned_employees()$$
);
