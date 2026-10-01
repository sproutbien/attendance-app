-- ============================================================
-- Sproutbien — No check-in on a leave day; cancel today's leave instead
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Employees can't check in on a day covered by their own pending or
--     approved FULL-day leave (half days keep their existing rules).
--     Admin-approved attendance corrections are not affected.
--   • cancel_leave_today(id, mode) lets them cancel today's part of such a
--     leave at any time that day, as long as they haven't checked in
--     (the usual "10 minutes before it starts" rule still applies to leave
--     on later days):
--       mode 'today'  → only today; days before and after stay as leave
--       mode 'onward' → today to the end of the leave; earlier days stay
--     A multi-day leave is split into separate requests. The cancelled part
--     shows up for the admin like any other cancellation; paid days that are
--     freed go back to the balance (approved leave keeps paid days on its
--     earliest remaining dates).
-- ============================================================

-- ── Splitting a leave must not re-run the "new request" checks ──
-- The pieces of a split leave were already checked (and maybe approved) as a
-- whole, so these insert triggers are skipped while cancel_leave_today()
-- writes them (transaction-local setting).

DROP TRIGGER IF EXISTS on_leave_request_timing ON leave_requests;
CREATE TRIGGER on_leave_request_timing
  BEFORE INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION check_leave_request_timing();

DROP TRIGGER IF EXISTS on_leave_request_days ON leave_requests;
CREATE TRIGGER on_leave_request_days
  BEFORE INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION set_leave_request_days();

DROP TRIGGER IF EXISTS on_leave_overlap ON leave_requests;
CREATE TRIGGER on_leave_overlap
  BEFORE INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION check_leave_overlap();

DROP TRIGGER IF EXISTS on_leave_balance ON leave_requests;
CREATE TRIGGER on_leave_balance
  BEFORE INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION check_leave_balance();

-- No "new leave request" WhatsApp for the pieces (the cancellation still notifies)
DROP TRIGGER IF EXISTS on_leave_whatsapp ON leave_requests;
CREATE TRIGGER on_leave_whatsapp
  AFTER INSERT OR UPDATE OF status ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION notify_leave_whatsapp();

-- ── Cancel today's part of a full-day leave ─────────────────

CREATE OR REPLACE FUNCTION cancel_leave_today(p_id uuid, p_mode text DEFAULT 'onward')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          leave_requests;
  v_today    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_cut_end  date;            -- last cancelled day
  v_before   numeric := 0;    -- working days kept before today
  v_after    numeric := 0;    -- working days kept after the cancelled part
  v_cut      numeric;
  v_paid     numeric;         -- paid days (approved) or planned paid days (pending) to share out
  v_paid_b   numeric := 0;
  v_paid_a   numeric := 0;
BEGIN
  IF p_mode NOT IN ('today', 'onward') THEN
    RAISE EXCEPTION 'Unknown cancel option';
  END IF;

  SELECT * INTO r FROM leave_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR r.employee_id <> auth.uid() THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;
  IF r.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Only pending or approved leave can be cancelled';
  END IF;
  IF r.duration <> 'full' OR v_today NOT BETWEEN r.start_date AND r.end_date THEN
    RAISE EXCEPTION 'This leave doesn''t cover today';
  END IF;
  IF EXISTS (SELECT 1 FROM attendance_records
             WHERE employee_id = r.employee_id AND date = v_today AND check_in_time IS NOT NULL) THEN
    RAISE EXCEPTION 'You''ve already checked in today';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('leave:' || r.employee_id::text));

  v_cut_end := CASE WHEN p_mode = 'today' THEN v_today ELSE r.end_date END;
  IF r.start_date < v_today THEN
    v_before := leave_working_days(r.start_date, v_today - 1, 'full');
  END IF;
  IF v_cut_end < r.end_date THEN
    v_after := leave_working_days(v_cut_end + 1, r.end_date, 'full');
  END IF;
  v_cut := leave_working_days(v_today, v_cut_end, 'full');

  -- Paid days stay on the earliest remaining dates
  v_paid := CASE WHEN r.status = 'approved' THEN r.paid_days ELSE r.planned_paid_days END;
  IF v_paid IS NOT NULL THEN
    v_paid_b := least(v_paid, v_before);
    v_paid_a := least(v_paid - v_paid_b, v_after);
  END IF;

  -- Take today's (and maybe later) days off the attendance sheet
  IF r.status = 'approved' THEN
    DELETE FROM attendance_records
    WHERE employee_id = r.employee_id
      AND date BETWEEN v_today AND v_cut_end
      AND check_in_time IS NULL AND status = 'on_leave';
  END IF;

  -- Kept days become their own requests (same status, reason, voice note, review)
  PERFORM set_config('sb.leave_split', 'on', true);
  IF v_before > 0 THEN
    INSERT INTO leave_requests (
      employee_id, start_date, end_date, duration, half_day_session, leave_type, reason,
      voice_note_path, voice_note_seconds, split_with_lop, planned_paid_days,
      status, requested_at, reviewed_by, reviewed_at, days, paid_days, lop_days)
    VALUES (
      r.employee_id, r.start_date, v_today - 1, 'full', NULL, r.leave_type, r.reason,
      r.voice_note_path, r.voice_note_seconds, r.split_with_lop,
      CASE WHEN r.status = 'pending' AND v_paid IS NOT NULL THEN v_paid_b END,
      r.status, r.requested_at, r.reviewed_by, r.reviewed_at, v_before,
      CASE WHEN r.status = 'approved' THEN v_paid_b END,
      CASE WHEN r.status = 'approved' THEN v_before - v_paid_b END);
  END IF;
  IF v_after > 0 THEN
    INSERT INTO leave_requests (
      employee_id, start_date, end_date, duration, half_day_session, leave_type, reason,
      voice_note_path, voice_note_seconds, split_with_lop, planned_paid_days,
      status, requested_at, reviewed_by, reviewed_at, days, paid_days, lop_days)
    VALUES (
      r.employee_id, v_cut_end + 1, r.end_date, 'full', NULL, r.leave_type, r.reason,
      r.voice_note_path, r.voice_note_seconds, r.split_with_lop,
      CASE WHEN r.status = 'pending' AND v_paid IS NOT NULL THEN v_paid_a END,
      r.status, r.requested_at, r.reviewed_by, r.reviewed_at, v_after,
      CASE WHEN r.status = 'approved' THEN v_paid_a END,
      CASE WHEN r.status = 'approved' THEN v_after - v_paid_a END);
    -- A freed paid day may now cover a day that was Loss of Pay
    IF r.status = 'approved' THEN
      PERFORM apply_leave_to_attendance(r.employee_id, v_cut_end + 1, r.end_date, 'full', NULL, v_paid_a);
    END IF;
  END IF;
  PERFORM set_config('sb.leave_split', 'off', true);

  -- The original request becomes the cancelled part (admin is notified as usual)
  UPDATE leave_requests SET
    start_date               = v_today,
    end_date                 = v_cut_end,
    days                     = v_cut,
    paid_days                = CASE WHEN r.status = 'approved' THEN greatest(0, least(v_cut, v_paid - v_paid_b - v_paid_a)) END,
    lop_days                 = CASE WHEN r.status = 'approved' THEN v_cut - greatest(0, least(v_cut, v_paid - v_paid_b - v_paid_a)) END,
    planned_paid_days        = NULL,
    status                   = 'cancelled',
    cancelled_at             = now(),
    cancelled_after_approval = (r.status = 'approved')
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_leave_today(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION cancel_leave_today(uuid, text) TO authenticated;

-- ── No check-in on your own full-day leave ──────────────────
-- Only when the employee checks themselves in; an admin approving an
-- attendance correction (auth.uid() = the admin) isn't blocked.

CREATE OR REPLACE FUNCTION block_check_in_on_leave()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.check_in_time IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.check_in_time IS NULL)
     AND auth.uid() = NEW.employee_id
     AND EXISTS (
       SELECT 1 FROM leave_requests l
       WHERE l.employee_id = NEW.employee_id
         AND l.status IN ('pending', 'approved')
         AND l.duration = 'full'
         AND NEW.date BETWEEN l.start_date AND l.end_date)
  THEN
    RAISE EXCEPTION 'You have leave today. Cancel today''s leave on the Leaves page before checking in.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_block_check_in_on_leave ON attendance_records;
CREATE TRIGGER attendance_block_check_in_on_leave
  BEFORE INSERT OR UPDATE OF check_in_time ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION block_check_in_on_leave();
