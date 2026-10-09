-- ============================================================
-- Sproutbien — Employee date of birth
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Set by admins on the Add / Edit Employee form. The admin home page
-- lists birthdays coming up in the next 30 days (day and month only).
-- Same access as the rest of the employees row: admins read and write,
-- employees read only their own.
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth date;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_date_of_birth_check;
ALTER TABLE employees ADD CONSTRAINT employees_date_of_birth_check
  CHECK (date_of_birth IS NULL OR (date_of_birth >= DATE '1900-01-01' AND date_of_birth <= current_date));
