-- ============================================================
-- Sproutbien — Pause/resume breaks during the work day
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- break_started_at: set while the employee is on a break, NULL otherwise
-- break_seconds:    total of all finished breaks for that day
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS break_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS break_seconds    integer NOT NULL DEFAULT 0
                                            CHECK (break_seconds >= 0);
