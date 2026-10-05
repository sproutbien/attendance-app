-- ============================================================
-- Sproutbien — Change the temporary password at first login
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • An account an admin creates starts with must_change_password = true;
--     the app then shows only a "choose your own password" screen.
--   • The flag clears itself when the password in auth.users actually changes
--     (this screen, or a "forgot password" reset), so it can't be skipped by
--     calling the API directly.
--   • Accounts that have never been logged in to are flagged now too.
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Created by someone else (an admin through create_employee) → flag it.
-- Server jobs and the SQL editor (no signed-in user) leave it off.
CREATE OR REPLACE FUNCTION employees_flag_temporary_password()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.id <> auth.uid() THEN
    NEW.must_change_password := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_flag_temporary_password ON employees;
CREATE TRIGGER employees_flag_temporary_password
  BEFORE INSERT ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_flag_temporary_password();

-- Only the server may clear it: employees can't update their own row (migration 011),
-- and admins shouldn't switch it off by accident
CREATE OR REPLACE FUNCTION employees_keep_password_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
     AND current_setting('sb.password_changed', true) IS DISTINCT FROM 'on' THEN
    NEW.must_change_password := OLD.must_change_password;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_keep_password_flag ON employees;
CREATE TRIGGER employees_keep_password_flag
  BEFORE UPDATE OF must_change_password ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_keep_password_flag();

-- The password itself changed → done
CREATE OR REPLACE FUNCTION public.clear_temporary_password_flag()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    PERFORM set_config('sb.password_changed', 'on', true);
    UPDATE public.employees SET must_change_password = false
    WHERE id = NEW.id AND must_change_password;
    PERFORM set_config('sb.password_changed', 'off', true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_temporary_password_flag ON auth.users;
CREATE TRIGGER clear_temporary_password_flag
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.clear_temporary_password_flag();

-- Accounts nobody has logged in to yet still have the admin's password
UPDATE employees e SET must_change_password = true
FROM auth.users u
WHERE u.id = e.id AND u.last_sign_in_at IS NULL AND e.deleted_at IS NULL;
