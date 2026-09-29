-- ============================================================
-- Sproutbien — Half-day leave (morning / afternoon)
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   Morning half-day   9:30 AM – 1:30 PM  → check-in opens at 1:30 PM
--   Afternoon half-day 1:30 PM – 5:30 PM  → auto check-out at 1:30 PM
-- Times are Asia/Kolkata.
-- ============================================================

-- ── Leave requests: full or half day ────────────────────────

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS duration         text NOT NULL DEFAULT 'full'
                                            CHECK (duration IN ('full', 'half')),
  ADD COLUMN IF NOT EXISTS half_day_session text
                                            CHECK (half_day_session IN ('morning', 'afternoon'));

-- A half day is a single date with a session; a full day has no session
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_half_day_shape;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_half_day_shape CHECK (
  (duration = 'full' AND half_day_session IS NULL) OR
  (duration = 'half' AND half_day_session IS NOT NULL AND start_date = end_date)
);

-- ── Attendance: which half of the day is approved leave ─────

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS half_day_session text
                           CHECK (half_day_session IN ('morning', 'afternoon'));

-- ── Approval trigger: half days tag the day instead of taking all of it ──

CREATE OR REPLACE FUNCTION handle_leave_approval()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  d date;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    IF NEW.duration = 'half' THEN
      -- Keep an existing check-in's present/late status; the other half is leave
      INSERT INTO attendance_records (employee_id, date, status, half_day_session)
      VALUES (NEW.employee_id, NEW.start_date, 'on_leave', NEW.half_day_session)
      ON CONFLICT (employee_id, date) DO UPDATE SET
        half_day_session = EXCLUDED.half_day_session,
        status = CASE WHEN attendance_records.check_in_time IS NULL
                      THEN 'on_leave' ELSE attendance_records.status END;
    ELSE
      d := NEW.start_date;
      WHILE d <= NEW.end_date LOOP
        INSERT INTO attendance_records (employee_id, date, status)
        VALUES (NEW.employee_id, d, 'on_leave')
        ON CONFLICT (employee_id, date)
          DO UPDATE SET status = 'on_leave', half_day_session = NULL;
        d := d + INTERVAL '1 day';
      END LOOP;
    END IF;

    IF NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Auto check-out for afternoon half days ──────────────────
-- Closes the day at 1:30 PM (folding any running break into break_seconds),
-- even if the employee never opens the app. Returns how many rows it closed.

CREATE OR REPLACE FUNCTION auto_checkout_afternoon_half_days()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  closed integer;
BEGIN
  UPDATE attendance_records ar SET
    break_seconds = ar.break_seconds + CASE
      WHEN ar.break_started_at IS NULL THEN 0
      ELSE GREATEST(0, floor(extract(epoch FROM c.cutoff - ar.break_started_at)))::integer
    END,
    break_started_at = NULL,
    check_out_time   = c.cutoff
  FROM (
    SELECT id, ((date + time '13:30') AT TIME ZONE 'Asia/Kolkata') AS cutoff
    FROM attendance_records
    WHERE half_day_session = 'afternoon'
      AND check_in_time IS NOT NULL
      AND check_out_time IS NULL
  ) c
  WHERE ar.id = c.id
    AND now() >= c.cutoff
    AND ar.check_in_time < c.cutoff;

  GET DIAGNOSTICS closed = ROW_COUNT;
  RETURN closed;
END;
$$;

REVOKE EXECUTE ON FUNCTION auto_checkout_afternoon_half_days() FROM PUBLIC, anon, authenticated;

-- Run every 5 minutes (re-running this file updates the job instead of duplicating it)
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'half-day-auto-checkout',
  '*/5 * * * *',
  $$SELECT auto_checkout_afternoon_half_days()$$
);
