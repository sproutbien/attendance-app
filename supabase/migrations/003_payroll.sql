-- ============================================================
-- Sproutbien — Payroll: salary per employee + working days
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Monthly gross salary on each employee profile
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS monthly_salary numeric(12, 2);

-- One row per calendar month stores the company working-day count
CREATE TABLE IF NOT EXISTS payroll_settings (
  year_month   text PRIMARY KEY,                          -- e.g. "2026-09"
  working_days integer NOT NULL
    CHECK (working_days > 0 AND working_days <= 31),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can read or write payroll settings
CREATE POLICY "payroll_settings: admin only"
  ON payroll_settings FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());
