-- ============================================================
-- Sproutbien — Admin: reset an employee's password
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Sets a new temporary password the admin shares, signs the person out
--     of their devices (no new sessions from old logins; an open tab stops
--     working within the hour), and asks them to choose their own password
--     at the next login (must_change_password, migration 033).
--   • Not for your own account: use "Forgot password" for that.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_reset_password(p_employee uuid, p_password text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_old text;
  v_new text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_employee = auth.uid() THEN
    RAISE EXCEPTION 'To change your own password, use “Forgot password” on the login page.';
  END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'The temporary password must be at least 8 characters.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT encrypted_password INTO v_old FROM auth.users WHERE id = p_employee;
  IF NOT FOUND THEN RAISE EXCEPTION 'This employee has no login account.'; END IF;

  UPDATE auth.users
     SET encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
   WHERE id = p_employee
  RETURNING encrypted_password INTO v_new;

  -- Something kept the old password (e.g. a protected demo login): change nothing
  IF v_new IS NOT DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'This account''s password can''t be changed.';
  END IF;

  -- Sign out everywhere: no device can renew its login
  DELETE FROM auth.sessions WHERE user_id = p_employee;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_employee::text;

  -- The password change above cleared the flag (migration 033); this one is temporary again
  PERFORM set_config('sb.password_changed', 'on', true);
  UPDATE public.employees SET must_change_password = true WHERE id = p_employee;
  PERFORM set_config('sb.password_changed', 'off', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_reset_password(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION admin_reset_password(uuid, text) TO authenticated;
