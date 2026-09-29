-- ============================================================
-- Sproutbien — Limits on leave requested for today
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- For leave starting today (Asia/Kolkata):
--                        not checked in         already checked in
--   full day             until 10:30 AM         not allowed
--   morning half day     any time               not allowed
--   afternoon half day   any time               until 1:30 PM
-- Leave can't start in the past. Mirrors sameDayLeaveBlock() in src/lib/halfDay.ts.
-- ============================================================

CREATE OR REPLACE FUNCTION check_leave_request_timing()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local      timestamp := now() AT TIME ZONE 'Asia/Kolkata';
  v_today      date      := v_local::date;
  v_time       time      := date_trunc('minute', v_local)::time;  -- 10:30 counts as 10:30
  v_checked_in boolean;
BEGIN
  IF NEW.start_date < v_today THEN
    RAISE EXCEPTION 'Leave can''t start in the past';
  END IF;
  IF NEW.start_date > v_today THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM attendance_records
    WHERE employee_id = NEW.employee_id AND date = v_today AND check_in_time IS NOT NULL
  ) INTO v_checked_in;

  IF v_checked_in THEN
    IF NEW.duration = 'full' THEN
      RAISE EXCEPTION 'You''ve already checked in today, so you can''t take a full day''s leave for today';
    ELSIF NEW.half_day_session = 'morning' THEN
      RAISE EXCEPTION 'You''ve already checked in today, so you can''t take the morning off';
    ELSIF v_time > time '13:30' THEN
      RAISE EXCEPTION 'Afternoon half-day leave for today can only be requested until 1:30 PM';
    END IF;
  ELSIF NEW.duration = 'full' AND v_time > time '10:30' THEN
    RAISE EXCEPTION 'Full-day leave for today can only be requested until 10:30 AM. You can still request a half day';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_request_timing ON leave_requests;

CREATE TRIGGER on_leave_request_timing
  BEFORE INSERT ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION check_leave_request_timing();
