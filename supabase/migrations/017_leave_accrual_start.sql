-- ============================================================
-- Sproutbien — Leave credit starts October 2026
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- The system was reset on 30 Sep 2026. Paid leave is credited from
-- October 2026 (1 day per type on 1 Oct), not from April, so everyone
-- starts at 0. Later joiners still start from their joining month.
-- ============================================================

CREATE OR REPLACE FUNCTION leave_months_credited(p_employee uuid, y integer, p_through date)
RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_first date := greatest(make_date(y, 4, 1), date '2026-10-01');   -- nothing credited before tracking started
  v_last  date := least(date_trunc('month', p_through)::date, make_date(y + 1, 3, 1));
  v_join  date;
BEGIN
  SELECT date_trunc('month', joining_date)::date INTO v_join FROM employees WHERE id = p_employee;
  IF v_join IS NOT NULL AND v_join > v_first THEN v_first := v_join; END IF;
  IF v_last < v_first THEN RETURN 0; END IF;
  RETURN (extract(year FROM age(v_last, v_first)) * 12 + extract(month FROM age(v_last, v_first)))::integer + 1;
END;
$$;

-- Check (as of today = 30 Sep 2026 this should be 0 for everyone; from 1 Oct, 1):
-- SELECT e.full_name, b.name, b.accrued, b.available
-- FROM employees e, leave_balances(e.id) b WHERE b.is_paid ORDER BY 1, 2;
