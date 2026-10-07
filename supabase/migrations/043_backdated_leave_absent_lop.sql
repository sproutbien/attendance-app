-- ============================================================
-- Sproutbien — Leave for past days; absent days count as Loss of Pay
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Employees can request leave starting up to 7 days back (any type),
--     e.g. Sick leave for yesterday. The admin approves it as usual, and the
--     day turns from Absent into leave (paid if the balance covers it).
--     A past day they checked in on can't be covered by full-day leave (a
--     half day is fine). Leave that also covers today keeps today's rules.
--   • The Loss of Pay balance ("taken") now also counts past working days
--     with no check-in and no approved leave (Absent), since those are
--     unpaid in payroll anyway. Requesting leave for such a day moves it
--     from Loss of Pay to the leave type once approved.
-- ============================================================

-- How far back leave can start. Mirrors LEAVE_BACKDATE_DAYS in src/lib/leave.ts.
CREATE OR REPLACE FUNCTION leave_backdate_days()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 7 $$;

-- First day attendance is tracked; earlier days are never Absent. Mirrors TRACKING_START in src/lib/calendar.ts.
CREATE OR REPLACE FUNCTION attendance_tracking_start()
RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT date '2026-10-01' $$;

-- ── Leave timing: up to 7 days back ─────────────────────────
-- Today's rules are unchanged (see migration 020):
--                        not checked in            already checked in
--   full day             until start + 1 hour      not allowed
--   morning half day     any time                  not allowed
--   afternoon half day   any time                  until split_time
-- Mirrors sameDayLeaveBlock() in src/lib/halfDay.ts and earliestLeaveDate() in src/lib/leave.ts.
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
  v_worked     date;
  s            shifts;
  v_full_until time;
BEGIN
  IF NEW.start_date < v_today - leave_backdate_days() THEN
    RAISE EXCEPTION 'Leave can only be requested for the last % days (from % onwards)',
      leave_backdate_days(), to_char(v_today - leave_backdate_days(), 'FMDD Mon');
  END IF;

  -- A past day they checked in on was worked: full-day leave can't cover it
  IF NEW.start_date < v_today AND NEW.duration = 'full' THEN
    SELECT a.date INTO v_worked
    FROM attendance_records a
    WHERE a.employee_id = NEW.employee_id
      AND a.date BETWEEN NEW.start_date AND least(NEW.end_date, v_today - 1)
      AND a.check_in_time IS NOT NULL
    ORDER BY a.date LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'You checked in on %, so full-day leave can''t cover that day. Leave it out, or request a half day for it',
        to_char(v_worked, 'FMDD Mon');
    END IF;
  END IF;

  -- Only leave that covers today has today's limits
  IF NEW.start_date > v_today OR NEW.end_date < v_today THEN
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

-- ── Absent days ─────────────────────────────────────────────
-- Unpaid part of past working days without a check-in or approved leave,
-- between two dates (today never counts). Same day rules as the Reports page
-- (useMonthlyReport): a half-day leave covers half; a check-in covers the rest.
CREATE OR REPLACE FUNCTION absent_days(p_employee uuid, p_from date, p_to date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(greatest(0,
           1 - CASE WHEN a.status IN ('present', 'late')
                    THEN CASE WHEN a.half_day_session IS NOT NULL THEN 0.5 ELSE 1 END
                    ELSE 0 END
             - CASE WHEN a.half_day_session IS NOT NULL THEN 0.5
                    WHEN a.status = 'on_leave' THEN 1
                    ELSE 0 END)), 0)
  FROM employees e
  CROSS JOIN LATERAL generate_series(
    greatest(p_from, attendance_tracking_start(), COALESCE(e.joining_date, p_from)),
    least(p_to, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, COALESCE(e.last_working_day, p_to)),
    interval '1 day') AS g(d)
  LEFT JOIN attendance_records a ON a.employee_id = e.id AND a.date = g.d::date
  WHERE e.id = p_employee
    AND extract(dow FROM g.d) <> 0
    AND NOT is_holiday_for(e.id, g.d::date)
$$;

-- ── Balances: Loss of Pay includes absent days ──────────────
-- Same as migration 022, except the Loss of Pay row's "used" adds absent_days().
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
        -- Loss of Pay row: every unpaid day, whichever type it was requested as, plus absent days
        ELSE COALESCE((SELECT sum(r.lop_days) FROM leave_requests r
                       WHERE r.employee_id = p_employee AND r.status = 'approved'
                         AND leave_year_of(r.start_date) = y), 0)
             + absent_days(p_employee, make_date(y, 4, 1), least(v_as_of, make_date(y + 1, 3, 31)))
      END AS used,
      CASE WHEN t.is_paid
        THEN COALESCE((SELECT sum(COALESCE(r.planned_paid_days, r.days)) FROM leave_requests r
                       WHERE r.employee_id = p_employee AND r.leave_type = t.code AND r.status = 'pending'
                         AND leave_year_of(r.start_date) = y), 0)
        ELSE COALESCE((SELECT sum(CASE WHEN r.leave_type = t.code THEN r.days ELSE r.days - r.planned_paid_days END)
                       FROM leave_requests r
                       WHERE r.employee_id = p_employee AND r.status = 'pending'
                         AND (r.leave_type = t.code OR r.planned_paid_days IS NOT NULL)
                         AND leave_year_of(r.start_date) = y), 0)
      END AS pending
    FROM leave_types t
  )
  SELECT b.code, b.name, b.is_paid, b.yearly_quota, b.carried, b.accrued, b.adjusted, b.used, b.pending,
         CASE WHEN b.is_paid THEN b.carried + b.accrued + b.adjusted - b.used END
  FROM base b
  ORDER BY b.sort_order;
END;
$$;

-- Only through leave_balances(), which checks who's asking
REVOKE EXECUTE ON FUNCTION absent_days(uuid, date, date) FROM PUBLIC, anon, authenticated;
