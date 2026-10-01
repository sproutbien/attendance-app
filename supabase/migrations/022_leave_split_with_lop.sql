-- ============================================================
-- Sproutbien — Use what's left of a paid leave type, rest as Loss of Pay
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Before: a Sick request for 7 days with 1 day left was refused outright.
-- Now the employee can tick "use 1 Sick day + 6 days Loss of Pay":
--   • split_with_lop = their consent; without it the old refusal still applies.
--   • planned_paid_days = the paid part worked out at request time (server-set).
--   • Pending balances count only the planned paid part against the type,
--     and the rest as pending Loss of Pay.
--   • Approval is unchanged: it already pays what the balance covers and
--     records the remainder as lop_days.
-- ============================================================

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS split_with_lop    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS planned_paid_days numeric(5, 1);

CREATE OR REPLACE FUNCTION check_leave_balance()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type  leave_types;
  v_bal   record;
  v_days  numeric := leave_working_days(NEW.start_date, NEW.end_date, NEW.duration);
  v_free  numeric;
  v_paid  numeric;
BEGIN
  NEW.planned_paid_days := NULL;   -- only ever set here

  SELECT * INTO v_type FROM leave_types WHERE code = NEW.leave_type;
  IF NOT COALESCE(v_type.is_paid, false) THEN
    NEW.split_with_lop := false;
    RETURN NEW;
  END IF;

  -- Same per-employee lock as the overlap check, so two requests at once can't both fit
  PERFORM pg_advisory_xact_lock(hashtext('leave:' || NEW.employee_id::text));

  SELECT b.available, b.pending INTO v_bal
  FROM leave_balances(NEW.employee_id, leave_bookable_as_of(NEW.start_date)) b
  WHERE b.leave_type = NEW.leave_type;

  v_free := greatest(0, COALESCE(v_bal.available, 0) - COALESCE(v_bal.pending, 0));
  v_paid := floor(v_free * 2) / 2;   -- leave is taken in half days

  IF v_days > v_free THEN
    IF NEW.split_with_lop AND v_paid > 0 THEN
      NEW.planned_paid_days := v_paid;
      RETURN NEW;
    END IF;
    IF v_paid = 0 THEN
      RAISE EXCEPTION 'You have no % left%. Choose another leave type or Loss of Pay.',
        v_type.name,
        CASE WHEN COALESCE(v_bal.pending, 0) > 0
             THEN ' (' || trim_scale(v_bal.pending) || ' day(s) are waiting for approval)' ELSE '' END;
    END IF;
    RAISE EXCEPTION 'Not enough %: this request needs % day(s) but only % % available%. Pick fewer days, choose Loss of Pay, or take the rest as Loss of Pay.',
      v_type.name, trim_scale(v_days), trim_scale(v_free),
      CASE WHEN v_free = 1 THEN 'is' ELSE 'are' END,
      CASE WHEN COALESCE(v_bal.pending, 0) > 0
           THEN ' (after ' || trim_scale(v_bal.pending) || ' day(s) waiting for approval)' ELSE '' END;
  END IF;

  NEW.split_with_lop := false;   -- it all fits; nothing to split
  RETURN NEW;
END;
$$;

-- Same as migration 014, except "pending" counts a split request's planned
-- paid part against its type and the rest against Loss of Pay
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
