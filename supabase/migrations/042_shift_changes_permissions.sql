-- ============================================================
-- Sproutbien — One-day shift changes and permissions (short leave)
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Shift change for a day: an employee asks to work another shift on one
--     date (e.g. Afternoon instead of Morning). An admin approves or rejects,
--     or sets one directly. Once approved, shift_for() returns that shift for
--     the day, so every shift rule follows it (late / half day, leave cut-offs,
--     auto check-out, minimum break). Asked for before the new shift starts
--     and before checking in; not on a day with leave.
--   • Permission: a few hours out on one day (e.g. 2:00–4:00 PM), inside the
--     shift, made up the same day by working later. Admin approves or rejects.
--     Limits (attendance_settings): permissions per month (default 2) and
--     minutes each (default 120); pending and approved ones count. Whether the
--     time was made up is worked out in the app from that day's hours; a
--     shortfall is only flagged for HR, nothing is deducted.
--   • Employees cancel their own pending requests, or approved ones for a
--     later day. All writes go through the functions below.
-- ============================================================

ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS permission_monthly_limit smallint NOT NULL DEFAULT 2   CHECK (permission_monthly_limit BETWEEN 0 AND 31),
  ADD COLUMN IF NOT EXISTS permission_max_minutes   smallint NOT NULL DEFAULT 120 CHECK (permission_max_minutes BETWEEN 15 AND 480);

-- ── Tables ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_changes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          date        NOT NULL,
  shift_id      uuid        NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,   -- the shift for that day
  from_shift_id uuid        REFERENCES shifts(id) ON DELETE SET NULL,           -- their usual shift then
  reason        text        NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 300),
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note    text        CHECK (length(admin_note) <= 300),
  requested_by  uuid        REFERENCES employees(id) ON DELETE SET NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_by   uuid        REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS shift_changes_one_open ON shift_changes (employee_id, date) WHERE status IN ('pending', 'approved');

CREATE TABLE IF NOT EXISTS permission_requests (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date         date        NOT NULL,
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  reason       text        NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 300),
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note   text        CHECK (length(admin_note) <= 300),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid        REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  CHECK (end_time > start_time)
);
CREATE UNIQUE INDEX IF NOT EXISTS permission_requests_one_open ON permission_requests (employee_id, date) WHERE status IN ('pending', 'approved');

ALTER TABLE shift_changes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shift_changes: own or admin read" ON shift_changes;
CREATE POLICY "shift_changes: own or admin read" ON shift_changes FOR SELECT USING (employee_id = auth.uid() OR is_admin());
DROP POLICY IF EXISTS "permission_requests: own or admin read" ON permission_requests;
CREATE POLICY "permission_requests: own or admin read" ON permission_requests FOR SELECT USING (employee_id = auth.uid() OR is_admin());

-- ── The shift on a date: an approved one-day change first ───
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
  SELECT sh.* INTO s FROM shift_changes c JOIN shifts sh ON sh.id = c.shift_id
  WHERE c.employee_id = p_employee AND c.date = p_date AND c.status = 'approved';
  IF s.id IS NULL THEN
    SELECT * INTO s FROM shifts WHERE id = (
      SELECT shift_id FROM employee_shifts
       WHERE employee_id = p_employee AND effective_from <= p_date
       ORDER BY effective_from DESC LIMIT 1
    );
  END IF;
  IF s.id IS NULL THEN
    SELECT * INTO s FROM shifts WHERE is_default;
  END IF;
  RETURN s;
END;
$$;

-- Their usual shift on a date, ignoring one-day changes
CREATE OR REPLACE FUNCTION assigned_shift_for(p_employee uuid, p_date date)
RETURNS shifts
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM shifts WHERE id = COALESCE(
    (SELECT shift_id FROM employee_shifts WHERE employee_id = p_employee AND effective_from <= p_date ORDER BY effective_from DESC LIMIT 1),
    (SELECT id FROM shifts WHERE is_default LIMIT 1));
$$;
REVOKE EXECUTE ON FUNCTION assigned_shift_for(uuid, date) FROM PUBLIC, anon, authenticated;

-- Shared checks for a day someone wants to change
CREATE OR REPLACE FUNCTION request_day_problem(p_employee uuid, p_date date, p_starts time)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now   timestamp := now() AT TIME ZONE 'Asia/Kolkata';
  v_today date      := v_now::date;
BEGIN
  IF p_date < v_today THEN RETURN 'That day has already passed.'; END IF;
  IF p_date = v_today AND v_now::time >= p_starts THEN RETURN 'It’s past the start time for today.'; END IF;
  IF EXISTS (SELECT 1 FROM attendance_records WHERE employee_id = p_employee AND date = p_date AND check_in_time IS NOT NULL) THEN
    RETURN 'Already checked in that day.';
  END IF;
  IF EXISTS (SELECT 1 FROM leave_requests WHERE employee_id = p_employee AND status IN ('pending', 'approved')
             AND p_date BETWEEN start_date AND end_date) THEN
    RETURN 'There’s leave on that day. Cancel the leave first.';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION request_day_problem(uuid, date, time) FROM PUBLIC, anon, authenticated;

-- ── Shift change: request (employee) or set directly (admin) ─
CREATE OR REPLACE FUNCTION request_shift_change(p_date date, p_shift uuid, p_reason text, p_employee uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin  boolean := is_admin();
  v_emp    uuid    := COALESCE(p_employee, auth.uid());
  v_direct boolean := v_admin AND p_employee IS NOT NULL AND p_employee <> auth.uid();
  v_usual  shifts;
  v_new    shifts;
  v_prob   text;
  v_id     uuid;
BEGIN
  IF auth.uid() IS NULL OR (v_emp <> auth.uid() AND NOT v_admin) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'Say why you want to change shift.'; END IF;
  SELECT * INTO v_new FROM shifts WHERE id = p_shift;
  IF v_new.id IS NULL THEN RAISE EXCEPTION 'Shift not found'; END IF;
  v_usual := assigned_shift_for(v_emp, p_date);
  IF v_usual.id = v_new.id THEN RAISE EXCEPTION 'That’s already the shift for that day.'; END IF;
  IF EXISTS (SELECT 1 FROM shift_changes WHERE employee_id = v_emp AND date = p_date AND status IN ('pending', 'approved')) THEN
    RAISE EXCEPTION 'There’s already a shift change for that day.';
  END IF;
  v_prob := request_day_problem(v_emp, p_date, least(v_usual.start_time, v_new.start_time));
  IF v_prob IS NOT NULL THEN RAISE EXCEPTION '%', v_prob; END IF;

  INSERT INTO shift_changes (employee_id, date, shift_id, from_shift_id, reason, status, requested_by, reviewed_by, reviewed_at)
  VALUES (v_emp, p_date, v_new.id, v_usual.id, btrim(p_reason),
          CASE WHEN v_direct THEN 'approved' ELSE 'pending' END, auth.uid(),
          CASE WHEN v_direct THEN auth.uid() END, CASE WHEN v_direct THEN now() END)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── Permission: request ─────────────────────────────────────
CREATE OR REPLACE FUNCTION request_permission(p_date date, p_start time, p_end time, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp   uuid := auth.uid();
  v_set   attendance_settings;
  v_shift shifts;
  v_mins  integer;
  v_used  integer;
  v_prob  text;
  v_id    uuid;
BEGIN
  IF v_emp IS NULL OR NOT EXISTS (SELECT 1 FROM employees WHERE id = v_emp) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN RAISE EXCEPTION 'Say why you need the time.'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN RAISE EXCEPTION 'The end time must be after the start time.'; END IF;
  SELECT * INTO v_set FROM attendance_settings LIMIT 1;
  v_mins := extract(epoch FROM (p_end - p_start))::integer / 60;
  IF v_mins > v_set.permission_max_minutes THEN
    RAISE EXCEPTION 'A permission can be up to % minutes.', v_set.permission_max_minutes;
  END IF;
  v_shift := shift_for(v_emp, p_date);
  IF p_start < v_shift.start_time OR p_end > v_shift.end_time THEN
    RAISE EXCEPTION 'Choose a time within your shift (% – %).', fmt_clock(v_shift.start_time), fmt_clock(v_shift.end_time);
  END IF;
  IF EXISTS (SELECT 1 FROM permission_requests WHERE employee_id = v_emp AND date = p_date AND status IN ('pending', 'approved')) THEN
    RAISE EXCEPTION 'There’s already a permission for that day.';
  END IF;
  SELECT count(*) INTO v_used FROM permission_requests
  WHERE employee_id = v_emp AND status IN ('pending', 'approved')
    AND date_trunc('month', date) = date_trunc('month', p_date);
  IF v_used >= v_set.permission_monthly_limit THEN
    RAISE EXCEPTION 'You’ve used your % permission% for %.', v_set.permission_monthly_limit,
      CASE WHEN v_set.permission_monthly_limit = 1 THEN '' ELSE 's' END, to_char(p_date, 'FMMonth');
  END IF;
  -- Before the permission starts; being checked in already is fine (they leave mid-day)
  v_prob := request_day_problem(v_emp, p_date, p_start);
  IF v_prob IS NOT NULL AND v_prob <> 'Already checked in that day.' THEN RAISE EXCEPTION '%', v_prob; END IF;

  INSERT INTO permission_requests (employee_id, date, start_time, end_time, reason)
  VALUES (v_emp, p_date, p_start, p_end, btrim(p_reason)) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── Admin: approve / reject ─────────────────────────────────
CREATE OR REPLACE FUNCTION review_shift_change(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c    shift_changes;
  v_sh shifts;
  v_us shifts;
  v_pr text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO c FROM shift_changes WHERE id = p_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF c.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been %.', c.status; END IF;
  IF p_approve THEN
    SELECT * INTO v_sh FROM shifts WHERE id = c.shift_id;
    v_us := assigned_shift_for(c.employee_id, c.date);
    v_pr := request_day_problem(c.employee_id, c.date, least(v_us.start_time, v_sh.start_time));
    IF v_pr IS NOT NULL THEN RAISE EXCEPTION 'Can’t approve: %', v_pr; END IF;
  END IF;
  UPDATE shift_changes SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    admin_note = nullif(btrim(coalesce(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION review_permission(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r permission_requests;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO r FROM permission_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been %.', r.status; END IF;
  IF p_approve AND r.date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Can’t approve: that day has already passed.';
  END IF;
  UPDATE permission_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    admin_note = nullif(btrim(coalesce(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_id;
END;
$$;

-- ── Employee: cancel (pending, or approved for a later day) ─
CREATE OR REPLACE FUNCTION cancel_my_request(p_kind text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_emp    uuid;
  v_status text;
  v_date   date;
BEGIN
  IF p_kind = 'shift' THEN
    SELECT employee_id, status, date INTO v_emp, v_status, v_date FROM shift_changes WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'permission' THEN
    SELECT employee_id, status, date INTO v_emp, v_status, v_date FROM permission_requests WHERE id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Unknown request type';
  END IF;
  IF v_emp IS NULL OR v_emp <> auth.uid() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF NOT (v_status = 'pending' OR (v_status = 'approved' AND v_date > v_today)) THEN
    RAISE EXCEPTION 'This request can’t be cancelled any more. Ask your admin.';
  END IF;
  IF p_kind = 'shift' THEN
    UPDATE shift_changes SET status = 'cancelled' WHERE id = p_id;
  ELSE
    UPDATE permission_requests SET status = 'cancelled' WHERE id = p_id;
  END IF;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'request_shift_change(date, uuid, text, uuid)', 'request_permission(date, time, time, text)',
    'review_shift_change(uuid, boolean, text)', 'review_permission(uuid, boolean, text)', 'cancel_my_request(text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
