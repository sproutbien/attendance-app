-- ============================================================
-- Sproutbien — Employee designation (job title), set by admins
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS designation text;
