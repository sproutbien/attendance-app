-- ============================================================
-- Sproutbien — My Profile: employees update their own contact details
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • update_my_contact(): an employee saves their phone / WhatsApp number
--     and emergency contact. Saved straight away; nothing else on their
--     record can be changed this way (employees UPDATE stays admin-only).
--     employees.contact_updated_at records when they last did, for HR.
--   • my_reporting_manager(): name, designation, photo and contact of the
--     caller's reporting manager (employees can otherwise only read their
--     own row).
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS contact_updated_at timestamptz;   -- by the employee, via My Profile

CREATE OR REPLACE FUNCTION update_my_contact(p_phone text, p_ec_name text, p_ec_relation text, p_ec_phone text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM employees WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Enter a valid phone number with country code, e.g. +91 98765 43210.';
  END IF;
  IF length(coalesce(p_ec_name, '')) > 100 OR length(coalesce(p_ec_relation, '')) > 50 OR length(coalesce(p_ec_phone, '')) > 30 THEN
    RAISE EXCEPTION 'One of the emergency contact fields is too long.';
  END IF;

  UPDATE employees SET
    phone                      = v_phone,
    emergency_contact_name     = nullif(btrim(coalesce(p_ec_name, '')), ''),
    emergency_contact_relation = nullif(btrim(coalesce(p_ec_relation, '')), ''),
    emergency_contact_phone    = nullif(btrim(coalesce(p_ec_phone, '')), ''),
    contact_updated_at         = now()
  WHERE id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION my_reporting_manager()
RETURNS TABLE (full_name text, designation text, photo_path text, email text, phone text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.full_name, m.designation, m.photo_path, m.email, m.phone
  FROM employees me JOIN employees m ON m.id = me.reporting_manager_id
  WHERE me.id = auth.uid() AND m.deleted_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION update_my_contact(text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION update_my_contact(text, text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION my_reporting_manager() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION my_reporting_manager() TO authenticated;
