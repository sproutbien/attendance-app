-- ============================================================
-- Sproutbien — Shifts drive the attendance rules
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Each shift has (all Asia/Kolkata, same day — no overnight shifts):
--   start_time      work starts; full-day leave for today can be requested until start + 1 hour
--   late_after      checking in after this is Late
--   half_day_after  checking in after this makes the morning a half-day leave
--   split_time      where the morning and afternoon halves meet: morning-leave check-in
--                   opens, afternoon-leave auto check-out, and on a morning half day
--                   checking in after this is Late
--   end_time        work ends
--
-- The "General" shift (9:30–5:30, late after 9:40, half day after 11:30, split
-- 1:30) is the default and matches the old fixed rules, so nothing changes for
-- anyone until they're given another shift.
--
-- Shift changes are dated (employee_shifts.effective_from): past days keep the
-- shift they were worked under. Employees with no row are on the default shift.
--
-- Check-in status (present / late / automatic morning half day) is now set by
-- the server (attendance_records trigger), not the browser.
-- ============================================================

-- ── Shifts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  start_time     time        NOT NULL,
  end_time       time        NOT NULL,
  late_after     time        NOT NULL,
  half_day_after time        NOT NULL,
  split_time     time        NOT NULL,
  is_default     boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shifts_times_in_order CHECK (
    start_time <= late_after
    AND late_after <= half_day_after
    AND half_day_after <= split_time
    AND start_time < split_time
    AND split_time < end_time
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_default ON shifts (is_default) WHERE is_default;

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shifts: everyone reads" ON shifts;
CREATE POLICY "shifts: everyone reads" ON shifts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "shifts: admin write" ON shifts;
CREATE POLICY "shifts: admin write" ON shifts FOR ALL USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO shifts (name, start_time, end_time, late_after, half_day_after, split_time, is_default)
SELECT 'General', '09:30', '17:30', '09:40', '11:30', '13:30', true
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE is_default);

-- The default shift can't be deleted (everyone without a shift is on it)
CREATE OR REPLACE FUNCTION protect_default_shift()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_default THEN
    RAISE EXCEPTION 'The default shift can''t be deleted. Make another shift the default first';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS shifts_protect_default ON shifts;
CREATE TRIGGER shifts_protect_default BEFORE DELETE ON shifts
  FOR EACH ROW EXECUTE FUNCTION protect_default_shift();

CREATE OR REPLACE FUNCTION set_default_shift(p_shift uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can change shifts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shifts WHERE id = p_shift) THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;
  UPDATE shifts SET is_default = false WHERE is_default AND id <> p_shift;
  UPDATE shifts SET is_default = true WHERE id = p_shift;
END;
$$;

-- ── Who works which shift, from when ────────────────────────
CREATE TABLE IF NOT EXISTS employee_shifts (
  employee_id    uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from date        NOT NULL,
  shift_id       uuid        NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  created_by     uuid        REFERENCES employees(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, effective_from)
);

ALTER TABLE employee_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_shifts: own or admin read" ON employee_shifts;
CREATE POLICY "employee_shifts: own or admin read" ON employee_shifts FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "employee_shifts: admin write" ON employee_shifts;
CREATE POLICY "employee_shifts: admin write" ON employee_shifts FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- Move someone to a shift from a date. Later scheduled changes are dropped,
-- so the newest decision wins.
CREATE OR REPLACE FUNCTION set_employee_shift(p_employee uuid, p_shift uuid, p_from date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can change shifts';
  END IF;
  IF p_from < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'A shift change can''t start in the past';
  END IF;

  DELETE FROM employee_shifts WHERE employee_id = p_employee AND effective_from > p_from;
  INSERT INTO employee_shifts (employee_id, effective_from, shift_id, created_by)
  VALUES (p_employee, p_from, p_shift, auth.uid())
  ON CONFLICT (employee_id, effective_from)
    DO UPDATE SET shift_id = EXCLUDED.shift_id, created_by = EXCLUDED.created_by, created_at = now();
END;
$$;

-- The shift an employee works on a date (default shift when none assigned)
CREATE OR REPLACE FUNCTION shift_for(p_employee uuid, p_date date)
RETURNS shifts
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s shifts;
BEGIN
  IF auth.uid() IS NOT NULL AND p_employee <> auth.uid() AND NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  SELECT * INTO s FROM shifts WHERE id = (
    SELECT shift_id FROM employee_shifts
     WHERE employee_id = p_employee AND effective_from <= p_date
     ORDER BY effective_from DESC LIMIT 1
  );
  IF s.id IS NULL THEN
    SELECT * INTO s FROM shifts WHERE is_default;
  END IF;
  RETURN s;
END;
$$;

-- "9:30 AM"
CREATE OR REPLACE FUNCTION fmt_clock(t time)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(date '2000-01-01' + t, 'FMHH12:MI AM') $$;  -- to_char has no time variant

-- ── Check-in status from the shift ──────────────────────────
--   ≤ late_after present · after it late · after half_day_after automatic morning half day
--   On a morning half day: present until split_time, late after.

DROP FUNCTION IF EXISTS check_in_status(timestamptz, text);

CREATE OR REPLACE FUNCTION check_in_status(p_employee uuid, p_check_in timestamptz, p_session text, OUT status text, OUT session text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local timestamp := p_check_in AT TIME ZONE 'Asia/Kolkata';
  v_time  time      := date_trunc('minute', v_local)::time;   -- 9:40:59 still counts as 9:40
  s       shifts    := shift_for(p_employee, v_local::date);
BEGIN
  session := COALESCE(p_session, CASE WHEN v_time > s.half_day_after THEN 'morning' END);
  IF session = 'morning' THEN
    status := CASE WHEN v_time <= s.split_time THEN 'present' ELSE 'late' END;
  ELSE
    status := CASE WHEN v_time <= s.late_after THEN 'present' ELSE 'late' END;
  END IF;
END;
$$;

-- Server sets status whenever a day gets its first check-in
CREATE OR REPLACE FUNCTION set_check_in_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.check_in_time IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.check_in_time IS NULL) THEN
    SELECT * INTO r FROM check_in_status(NEW.employee_id, NEW.check_in_time, NEW.half_day_session);
    NEW.status := r.status;
    NEW.half_day_session := r.session;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_set_check_in_status ON attendance_records;
CREATE TRIGGER attendance_set_check_in_status
  BEFORE INSERT OR UPDATE OF check_in_time ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION set_check_in_status();

-- ── Correction approval uses the shift too ──────────────────
CREATE OR REPLACE FUNCTION approve_attendance_correction(
  p_id        uuid,
  p_check_in  timestamptz,
  p_check_out timestamptz,
  p_note      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c          attendance_corrections;
  v_rec      attendance_records;
  v_in       timestamptz;
  v_out      timestamptz;
  v_leave    text;   -- session of an approved half-day leave on that date
  v_result   record;
  v_breaks   integer;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve corrections';
  END IF;

  SELECT * INTO c FROM attendance_corrections WHERE id = p_id FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'Correction request not found';
  END IF;
  IF c.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been %', c.status;
  END IF;

  SELECT * INTO v_rec FROM attendance_records
  WHERE employee_id = c.employee_id AND date = c.date FOR UPDATE;

  v_in  := COALESCE(p_check_in,  v_rec.check_in_time);
  v_out := COALESCE(p_check_out, v_rec.check_out_time);

  IF v_in IS NULL THEN
    RAISE EXCEPTION 'A check-in time is needed';
  END IF;
  IF (v_in AT TIME ZONE 'Asia/Kolkata')::date <> c.date
  OR (v_out IS NOT NULL AND (v_out AT TIME ZONE 'Asia/Kolkata')::date <> c.date) THEN
    RAISE EXCEPTION 'Times must be on the day being corrected';
  END IF;
  IF v_out IS NOT NULL AND v_out <= v_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;
  IF v_in > now() OR v_out > now() THEN
    RAISE EXCEPTION 'Times can''t be in the future';
  END IF;

  -- Re-derive late / half day from the corrected check-in. Only an approved
  -- half-day leave keeps its session; an automatic one (late check-in) is recomputed.
  SELECT half_day_session INTO v_leave FROM leave_requests
  WHERE employee_id = c.employee_id AND status = 'approved' AND duration = 'half'
    AND start_date = c.date
  LIMIT 1;
  SELECT * INTO v_result FROM check_in_status(c.employee_id, v_in, v_leave);

  -- A break still running at check-out ends at check-out
  v_breaks := COALESCE(v_rec.break_seconds, 0);
  IF v_rec.break_started_at IS NOT NULL AND v_out IS NOT NULL THEN
    v_breaks := v_breaks + GREATEST(0, floor(extract(epoch FROM v_out - v_rec.break_started_at)))::integer;
  END IF;

  INSERT INTO attendance_records
    (employee_id, date, check_in_time, check_out_time, status, half_day_session, break_seconds, break_started_at)
  VALUES
    (c.employee_id, c.date, v_in, v_out, v_result.status, v_result.session, v_breaks,
     CASE WHEN v_out IS NULL THEN v_rec.break_started_at END)
  ON CONFLICT (employee_id, date) DO UPDATE SET
    check_in_time    = EXCLUDED.check_in_time,
    check_out_time   = EXCLUDED.check_out_time,
    status           = EXCLUDED.status,
    half_day_session = EXCLUDED.half_day_session,
    break_seconds    = EXCLUDED.break_seconds,
    break_started_at = EXCLUDED.break_started_at;

  UPDATE attendance_corrections SET
    status             = 'approved',
    approved_check_in  = v_in,
    approved_check_out = v_out,
    admin_note         = NULLIF(trim(p_note), ''),
    reviewed_by        = auth.uid(),
    reviewed_at        = now()
  WHERE id = p_id;
END;
$$;

-- ── Afternoon half days: auto check-out at the shift's split ─
CREATE OR REPLACE FUNCTION auto_checkout_afternoon_half_days()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
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
    SELECT id, ((date + (shift_for(employee_id, date)).split_time) AT TIME ZONE 'Asia/Kolkata') AS cutoff
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

-- ── When a leave starts: shift start, or the split for an afternoon half ──
CREATE OR REPLACE FUNCTION leave_starts_at(p_employee uuid, p_start date, p_session text)
RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s shifts := shift_for(p_employee, p_start);
BEGIN
  RETURN (p_start + CASE WHEN p_session = 'afternoon' THEN s.split_time ELSE s.start_time END)
         AT TIME ZONE 'Asia/Kolkata';
END;
$$;

CREATE OR REPLACE FUNCTION cancel_leave_request(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r leave_requests;
BEGIN
  SELECT * INTO r FROM leave_requests WHERE id = p_id FOR UPDATE;

  IF r.id IS NULL OR r.employee_id <> auth.uid() THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;
  IF r.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Only pending or approved leave can be cancelled';
  END IF;
  IF now() >= leave_starts_at(r.employee_id, r.start_date, r.half_day_session) - interval '10 minutes' THEN
    RAISE EXCEPTION 'Too late to cancel: leave can be cancelled up to 10 minutes before it starts';
  END IF;

  -- Undo what approval put on the attendance sheet (days without a check-in)
  IF r.status = 'approved' THEN
    DELETE FROM attendance_records
    WHERE employee_id = r.employee_id
      AND date BETWEEN r.start_date AND r.end_date
      AND check_in_time IS NULL AND status = 'on_leave';
    UPDATE attendance_records SET
      paid_leave = 0,
      half_day_session = CASE WHEN r.duration = 'half' THEN NULL ELSE half_day_session END
    WHERE employee_id = r.employee_id
      AND date BETWEEN r.start_date AND r.end_date;
  END IF;

  UPDATE leave_requests SET
    status                   = 'cancelled',
    cancelled_at             = now(),
    cancelled_after_approval = (r.status = 'approved')
  WHERE id = p_id;
END;
$$;

DROP FUNCTION IF EXISTS leave_starts_at(date, text);

-- ── Same-day leave limits from the shift ────────────────────
--                        not checked in            already checked in
--   full day             until start + 1 hour      not allowed
--   morning half day     any time                  not allowed
--   afternoon half day   any time                  until split_time
-- Mirrors sameDayLeaveBlock() in src/lib/shifts.ts.
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
  s            shifts;
  v_full_until time;
BEGIN
  IF NEW.start_date < v_today THEN
    RAISE EXCEPTION 'Leave can''t start in the past';
  END IF;
  IF NEW.start_date > v_today THEN
    RETURN NEW;
  END IF;

  s := shift_for(NEW.employee_id, v_today);
  v_full_until := s.start_time + interval '1 hour';

  SELECT EXISTS (
    SELECT 1 FROM attendance_records
    WHERE employee_id = NEW.employee_id AND date = v_today AND check_in_time IS NOT NULL
  ) INTO v_checked_in;

  IF v_checked_in THEN
    IF NEW.duration = 'full' THEN
      RAISE EXCEPTION 'You''ve already checked in today, so you can''t take a full day''s leave for today';
    ELSIF NEW.half_day_session = 'morning' THEN
      RAISE EXCEPTION 'You''ve already checked in today, so you can''t take the morning off';
    ELSIF v_time > s.split_time THEN
      RAISE EXCEPTION 'Afternoon half-day leave for today can only be requested until %', fmt_clock(s.split_time);
    END IF;
  ELSIF NEW.duration = 'full' AND v_time > v_full_until THEN
    RAISE EXCEPTION 'Full-day leave for today can only be requested until %. You can still request a half day', fmt_clock(v_full_until);
  END IF;

  RETURN NEW;
END;
$$;

-- Signed-in users only (the WhatsApp function and cron run as service role / postgres)
REVOKE EXECUTE ON FUNCTION shift_for(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION shift_for(uuid, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION check_in_status(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION check_in_status(uuid, timestamptz, text) TO authenticated, service_role;
