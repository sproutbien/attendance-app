-- ============================================================
-- Sproutbien — Only admins can edit employee profiles
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- The old policy let every employee UPDATE their own row, i.e. any column:
-- role (self-promote to admin), monthly_salary, phone, status, ...
-- Employees never edit their own profile in the app — all edits come from
-- the admin Employees page — so updates are now admin-only.
-- ============================================================

DROP POLICY IF EXISTS "employees: own row update or admin" ON employees;
DROP POLICY IF EXISTS "employees: admin update" ON employees;

CREATE POLICY "employees: admin update"
  ON employees FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());
