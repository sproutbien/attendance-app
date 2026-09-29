-- ============================================================
-- Sproutbien — Leave types and balances
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Policy:
--   • Types: Casual 12/yr, Sick 12/yr, Earned 12/yr (paid, 1 day a month each) + Loss of Pay (unpaid).
--     Quotas are editable by admins (leave_types table).
--   • Leave year: 1 April – 31 March. The first tracked year is Apr 2026 – Mar 2027.
--   • Accrual: every paid type is credited monthly (quota / 12) on the 1st,
--     from the joining month if the employee joined during the year.
--   • Carry forward at year end: Earned up to 24 days; Casual and Sick lapse.
--   • Sundays and public holidays inside a leave don't count; a half day is 0.5.
--   • On approval, days beyond the available balance become Loss of Pay.
--   • Admins can adjust balances (+/-) with a reason.
--   • Paid leave now counts as a paid day in payroll (attendance_records.paid_leave).
-- ============================================================

-- ── Leave types ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_types (
  code              text    PRIMARY KEY,
  name              text    NOT NULL,
  is_paid           boolean NOT NULL,
  yearly_quota      numeric(5, 2) NOT NULL DEFAULT 0 CHECK (yearly_quota >= 0),
  carry_forward_cap numeric(5, 2) NOT NULL DEFAULT 0 CHECK (carry_forward_cap >= 0),
  sort_order        integer NOT NULL DEFAULT 0
);

INSERT INTO leave_types (code, name, is_paid, yearly_quota, carry_forward_cap, sort_order) VALUES
  ('casual', 'Casual Leave', true,  12, 0,  1),
  ('sick',   'Sick Leave',   true,  12, 0,  2),
  ('earned', 'Earned Leave', true,  12, 24, 3),
  ('lop',    'Loss of Pay',  false,  0, 0,  4)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_types: everyone reads"
  ON leave_types FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "leave_types: admin update"
  ON leave_types FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- ── Joining date (accrual starts from the joining month) ────
-- NULL = joined before the current leave year (full-year accrual).

ALTER TABLE employees ADD COLUMN IF NOT EXISTS joining_date date;

-- ── Leave requests: type, working days, paid / LOP split ────

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS leave_type text NOT NULL DEFAULT 'casual' REFERENCES leave_types(code),
  ADD COLUMN IF NOT EXISTS days       numeric(5, 1),   -- working days requested (set on insert)
  ADD COLUMN IF NOT EXISTS paid_days  numeric(5, 1),   -- set on approval
  ADD COLUMN IF NOT EXISTS lop_days   numeric(5, 1);   -- set on approval

-- How much of each attendance day is covered by paid leave (0, 0.5 or 1)
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS paid_leave numeric(2, 1) NOT NULL DEFAULT 0;

-- ── Manual balance adjustments ──────────────────────────────

CREATE TABLE IF NOT EXISTS leave_adjustments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type  text        NOT NULL REFERENCES leave_types(code),
  leave_year  integer     NOT NULL,           -- 2026 = Apr 2026 – Mar 2027
  days        numeric(5, 1) NOT NULL CHECK (days <> 0),
  reason      text        NOT NULL CHECK (length(trim(reason)) > 0),
  created_by  uuid        REFERENCES employees(id) DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leave_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_adjustments: own or admin"
  ON leave_adjustments FOR SELECT USING (employee_id = auth.uid() OR is_admin());
CREATE POLICY "leave_adjustments: admin insert"
  ON leave_adjustments FOR INSERT WITH CHECK (is_admin());

-- ── Helpers ─────────────────────────────────────────────────

-- Leave year a date falls in: Apr 2026 – Mar 2027 → 2026
CREATE OR REPLACE FUNCTION leave_year_of(d date)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN extract(month FROM d) >= 4 THEN extract(year FROM d)::integer
              ELSE extract(year FROM d)::integer - 1 END
$$;

-- Working days in a leave: Sundays and public holidays don't count; a half day is 0.5
CREATE OR REPLACE FUNCTION leave_working_days(p_start date, p_end date, p_duration text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_duration = 'half' THEN 0.5 ELSE 1 END * count(*)
  FROM generate_series(p_start, p_end, interval '1 day') AS g(d)
  WHERE extract(dow FROM g.d) <> 0
    AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.date = g.d::date)
$$;

-- Months credited in leave year y, up to and including the month of p_through
CREATE OR REPLACE FUNCTION leave_months_credited(p_employee uuid, y integer, p_through date)
RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_first date := make_date(y, 4, 1);
  v_last  date := least(date_trunc('month', p_through)::date, make_date(y + 1, 3, 1));
  v_join  date;
BEGIN
  SELECT date_trunc('month', joining_date)::date INTO v_join FROM employees WHERE id = p_employee;
  IF v_join IS NOT NULL AND v_join > v_first THEN v_first := v_join; END IF;
  IF v_last < v_first THEN RETURN 0; END IF;
  RETURN (extract(year FROM age(v_last, v_first)) * 12 + extract(month FROM age(v_last, v_first)))::integer + 1;
END;
$$;

-- Closing balance of a paid type at the end of leave year y (before carry-forward cap)
CREATE OR REPLACE FUNCTION leave_closing_balance(p_employee uuid, p_type text, y integer)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  t leave_types;
BEGIN
  SELECT * INTO t FROM leave_types WHERE code = p_type;
  RETURN leave_carried_in(p_employee, p_type, y)
    + t.yearly_quota / 12 * leave_months_credited(p_employee, y, make_date(y + 1, 3, 1))
    + COALESCE((SELECT sum(days) FROM leave_adjustments
                WHERE employee_id = p_employee AND leave_type = p_type AND leave_year = y), 0)
    - COALESCE((SELECT sum(paid_days) FROM leave_requests
                WHERE employee_id = p_employee AND leave_type = p_type AND status = 'approved'
                  AND leave_year_of(start_date) = y), 0);
END;
$$;

-- Carried into year y from y-1 (capped). 2026 is the first tracked year.
CREATE OR REPLACE FUNCTION leave_carried_in(p_employee uuid, p_type text, y integer)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_cap numeric;
BEGIN
  SELECT carry_forward_cap INTO v_cap FROM leave_types WHERE code = p_type;
  IF y <= 2026 OR COALESCE(v_cap, 0) = 0 THEN RETURN 0; END IF;
  RETURN least(v_cap, greatest(0, leave_closing_balance(p_employee, p_type, y - 1)));
END;
$$;

-- ── Balances (employee sees own; admin sees anyone) ─────────
-- As of p_as_of: credits up to that month, leave taken in that leave year.

CREATE OR REPLACE FUNCTION leave_balances(p_employee uuid, p_as_of date DEFAULT NULL)
RETURNS TABLE (
  leave_type   text,
  name         text,
  is_paid      boolean,
  yearly_quota numeric,
  carried      numeric,
  accrued      numeric,
  adjusted     numeric,
  used         numeric,
  pending      numeric,
  available    numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of date := COALESCE(p_as_of, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  y       integer := leave_year_of(v_as_of);
BEGIN
  -- auth.uid() is NULL only for trusted server-side callers (SQL editor, triggers, cron)
  IF auth.uid() IS NOT NULL AND p_employee <> auth.uid() AND NOT is_admin() THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      t.code, t.name, t.is_paid, t.yearly_quota, t.sort_order,
      CASE WHEN t.is_paid THEN leave_carried_in(p_employee, t.code, y) ELSE 0 END AS carried,
      CASE WHEN t.is_paid THEN round(t.yearly_quota / 12 * leave_months_credited(p_employee, y, v_as_of), 2) ELSE 0 END AS accrued,
      COALESCE((SELECT sum(a.days) FROM leave_adjustments a
                WHERE a.employee_id = p_employee AND a.leave_type = t.code AND a.leave_year = y), 0) AS adjusted,
      CASE WHEN t.is_paid
        THEN COALESCE((SELECT sum(r.paid_days) FROM leave_requests r
                       WHERE r.employee_id = p_employee AND r.leave_type = t.code AND r.status = 'approved'
                         AND leave_year_of(r.start_date) = y), 0)
        -- Loss of Pay row: every unpaid day, whichever type it was requested as
        ELSE COALESCE((SELECT sum(r.lop_days) FROM leave_requests r
                       WHERE r.employee_id = p_employee AND r.status = 'approved'
                         AND leave_year_of(r.start_date) = y), 0)
      END AS used,
      COALESCE((SELECT sum(r.days) FROM leave_requests r
                WHERE r.employee_id = p_employee AND r.leave_type = t.code AND r.status = 'pending'
                  AND leave_year_of(r.start_date) = y), 0) AS pending
    FROM leave_types t
  )
  SELECT b.code, b.name, b.is_paid, b.yearly_quota, b.carried, b.accrued, b.adjusted, b.used, b.pending,
         CASE WHEN b.is_paid THEN b.carried + b.accrued + b.adjusted - b.used END
  FROM base b
  ORDER BY b.sort_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION leave_balances(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION leave_balances(uuid, date) TO authenticated;

-- ── Working days are computed on insert ─────────────────────

CREATE OR REPLACE FUNCTION set_leave_request_days()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.days      := leave_working_days(NEW.start_date, NEW.end_date, NEW.duration);
  NEW.paid_days := NULL;
  NEW.lop_days  := NULL;
  IF NEW.days = 0 THEN
    RAISE EXCEPTION 'The selected dates are all Sundays or public holidays — no leave is needed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_request_days ON leave_requests;
CREATE TRIGGER on_leave_request_days
  BEFORE INSERT ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION set_leave_request_days();

-- ── Put an approved leave on the attendance sheet ───────────
-- Working days only; paid days fill the earliest dates, the rest is LOP.

CREATE OR REPLACE FUNCTION apply_leave_to_attendance(
  p_employee uuid, p_start date, p_end date, p_duration text, p_session text, p_paid numeric
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  d         date;
  v_portion numeric := CASE WHEN p_duration = 'half' THEN 0.5 ELSE 1 END;
  v_left    numeric := COALESCE(p_paid, 0);
  v_paid    numeric;
BEGIN
  FOR d IN
    SELECT g.d::date FROM generate_series(p_start, p_end, interval '1 day') AS g(d)
    WHERE extract(dow FROM g.d) <> 0
      AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.date = g.d::date)
    ORDER BY 1
  LOOP
    v_paid := least(v_portion, v_left);
    v_left := v_left - v_paid;

    IF p_duration = 'half' THEN
      -- Keep an existing check-in's present/late status; the other half is leave
      INSERT INTO attendance_records (employee_id, date, status, half_day_session, paid_leave)
      VALUES (p_employee, d, 'on_leave', p_session, v_paid)
      ON CONFLICT (employee_id, date) DO UPDATE SET
        half_day_session = EXCLUDED.half_day_session,
        paid_leave       = EXCLUDED.paid_leave,
        status = CASE WHEN attendance_records.check_in_time IS NULL
                      THEN 'on_leave' ELSE attendance_records.status END;
    ELSE
      -- A day they actually checked in keeps its status
      INSERT INTO attendance_records (employee_id, date, status, paid_leave)
      VALUES (p_employee, d, 'on_leave', v_paid)
      ON CONFLICT (employee_id, date) DO UPDATE SET
        paid_leave = EXCLUDED.paid_leave,
        status = CASE WHEN attendance_records.check_in_time IS NULL
                      THEN 'on_leave' ELSE attendance_records.status END,
        half_day_session = CASE WHEN attendance_records.check_in_time IS NULL
                                THEN NULL ELSE attendance_records.half_day_session END;
    END IF;
  END LOOP;
END;
$$;

-- ── Approval: split into paid / LOP, then mark attendance ───

CREATE OR REPLACE FUNCTION handle_leave_approval()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid_type boolean;
  v_available numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    NEW.days := COALESCE(NEW.days, leave_working_days(NEW.start_date, NEW.end_date, NEW.duration));
    SELECT is_paid INTO v_paid_type FROM leave_types WHERE code = NEW.leave_type;

    IF v_paid_type THEN
      -- Balance as of the leave's start (this request isn't counted as used yet)
      SELECT b.available INTO v_available
      FROM leave_balances(NEW.employee_id, NEW.start_date) b
      WHERE b.leave_type = NEW.leave_type;
      NEW.paid_days := least(NEW.days, greatest(0, floor(COALESCE(v_available, 0) * 2) / 2));
    ELSE
      NEW.paid_days := 0;
    END IF;
    NEW.lop_days := NEW.days - NEW.paid_days;

    PERFORM apply_leave_to_attendance(NEW.employee_id, NEW.start_date, NEW.end_date,
                                      NEW.duration, NEW.half_day_session, NEW.paid_days);

    IF NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Cancelling also clears paid leave from attendance ───────

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
  IF now() >= leave_starts_at(r.start_date, r.half_day_session) - interval '10 minutes' THEN
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

-- ── Back-fill existing requests ─────────────────────────────
-- Existing leave is Casual (column default). Approved leave is split against
-- the Casual balance in date order, and its attendance days are updated.

UPDATE leave_requests SET days = leave_working_days(start_date, end_date, duration) WHERE days IS NULL;

-- Old approvals also marked Sundays / holidays as leave; new ones don't
DELETE FROM attendance_records a
WHERE a.status = 'on_leave' AND a.check_in_time IS NULL
  AND (extract(dow FROM a.date) = 0 OR EXISTS (SELECT 1 FROM public_holidays h WHERE h.date = a.date));

DO $$
DECLARE
  r           leave_requests;
  v_available numeric;
  v_paid      numeric;
BEGIN
  FOR r IN SELECT * FROM leave_requests WHERE status = 'approved' AND paid_days IS NULL ORDER BY start_date, requested_at LOOP
    SELECT b.available INTO v_available
    FROM leave_balances(r.employee_id, r.start_date) b
    WHERE b.leave_type = r.leave_type;
    v_paid := least(r.days, greatest(0, floor(COALESCE(v_available, 0) * 2) / 2));
    UPDATE leave_requests SET paid_days = v_paid, lop_days = r.days - v_paid WHERE id = r.id;
    -- Only touch attendance days still marked as leave
    PERFORM apply_leave_to_attendance(r.employee_id, r.start_date, r.end_date, r.duration, r.half_day_session, v_paid);
  END LOOP;
END;
$$;
