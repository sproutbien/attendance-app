-- ============================================================
-- Sproutbien — Paid leave can't exceed the credited balance
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- A Casual / Sick / Earned request is refused when it needs more days than
-- are free right now: credited so far (+ carried, + adjustments), minus
-- approved and pending leave of that type in the same leave year.
-- Future months' credit can't be booked ahead, so the balance never goes negative.
-- Loss of Pay is unpaid and always allowed.
-- ============================================================

-- The date whose balance a request in leave year of p_start is checked against:
-- today for this leave year, 1 April for a later one, 31 March for an earlier one.
CREATE OR REPLACE FUNCTION leave_bookable_as_of(p_start date)
RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_today date    := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  y       integer := leave_year_of(p_start);
BEGIN
  IF y = leave_year_of(v_today) THEN RETURN v_today; END IF;
  IF y > leave_year_of(v_today) THEN RETURN make_date(y, 4, 1); END IF;
  RETURN make_date(y + 1, 3, 31);
END;
$$;

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
BEGIN
  SELECT * INTO v_type FROM leave_types WHERE code = NEW.leave_type;
  IF NOT COALESCE(v_type.is_paid, false) THEN RETURN NEW; END IF;

  -- Same per-employee lock as the overlap check, so two requests at once can't both fit
  PERFORM pg_advisory_xact_lock(hashtext('leave:' || NEW.employee_id::text));

  SELECT b.available, b.pending INTO v_bal
  FROM leave_balances(NEW.employee_id, leave_bookable_as_of(NEW.start_date)) b
  WHERE b.leave_type = NEW.leave_type;

  v_free := greatest(0, COALESCE(v_bal.available, 0) - COALESCE(v_bal.pending, 0));

  IF v_days > v_free THEN
    IF v_free = 0 THEN
      RAISE EXCEPTION 'You have no % left%. Choose another leave type or Loss of Pay.',
        v_type.name,
        CASE WHEN COALESCE(v_bal.pending, 0) > 0
             THEN ' (' || trim_scale(v_bal.pending) || ' day(s) are waiting for approval)' ELSE '' END;
    END IF;
    RAISE EXCEPTION 'Not enough %: this request needs % day(s) but only % % available%. Pick fewer days or choose Loss of Pay.',
      v_type.name, trim_scale(v_days), trim_scale(v_free),
      CASE WHEN v_free = 1 THEN 'is' ELSE 'are' END,
      CASE WHEN COALESCE(v_bal.pending, 0) > 0
           THEN ' (after ' || trim_scale(v_bal.pending) || ' day(s) waiting for approval)' ELSE '' END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_balance ON leave_requests;
CREATE TRIGGER on_leave_balance
  BEFORE INSERT ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION check_leave_balance();

-- Balances already below zero (from leave booked before this check) are listed by:
--
-- SELECT e.full_name, b.name, b.available
-- FROM employees e, leave_balances(e.id) b
-- WHERE b.is_paid AND b.available < 0;
