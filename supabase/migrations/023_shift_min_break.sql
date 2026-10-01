-- ============================================================
-- Sproutbien — Minimum break per shift
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Each shift has a minimum break (minutes). On a full working day, worked
-- hours are reduced by whichever is larger: the breaks the employee actually
-- paused for, or this minimum. So not pausing the timer gains nothing.
--   • Full days only — half days (half_day_session set) aren't affected.
--   • Only once the day is checked out, and only when the day lasted at least
--     half the shift (someone who left after 2 hours didn't take lunch).
-- Worked hours are worked out in the app, so nothing else changes here;
-- payroll is by days and isn't affected.
-- ============================================================

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS min_break_minutes smallint NOT NULL DEFAULT 40
    CHECK (min_break_minutes BETWEEN 0 AND 240);
