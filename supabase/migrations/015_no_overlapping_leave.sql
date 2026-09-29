-- ============================================================
-- Sproutbien — No leave on days that already have leave
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- A new request can't overlap a pending or approved request of the same
-- employee. Cancelled and rejected requests free their days again.
-- Exception: the other half of a half day (morning + afternoon) is allowed.
-- ============================================================

CREATE OR REPLACE FUNCTION check_leave_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clash leave_requests;
BEGIN
  -- Serialise requests per employee so two submissions at once can't both slip through
  PERFORM pg_advisory_xact_lock(hashtext('leave:' || NEW.employee_id::text));

  SELECT * INTO clash
  FROM leave_requests r
  WHERE r.employee_id = NEW.employee_id
    AND r.status IN ('pending', 'approved')
    AND r.start_date <= NEW.end_date
    AND r.end_date   >= NEW.start_date
    AND NOT (r.duration = 'half' AND NEW.duration = 'half'
             AND r.half_day_session IS DISTINCT FROM NEW.half_day_session)
  ORDER BY r.start_date
  LIMIT 1;

  IF clash.id IS NOT NULL THEN
    RAISE EXCEPTION 'You already have % leave for %. Cancel it first if you want to change it.',
      clash.status,
      CASE WHEN clash.start_date = clash.end_date
           THEN to_char(clash.start_date, 'DD Mon YYYY')
             || CASE WHEN clash.duration = 'half' THEN ' (' || clash.half_day_session || ' half day)' ELSE '' END
           ELSE to_char(clash.start_date, 'DD Mon') || ' – ' || to_char(clash.end_date, 'DD Mon YYYY')
      END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_overlap ON leave_requests;
CREATE TRIGGER on_leave_overlap
  BEFORE INSERT ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION check_leave_overlap();

-- Overlaps that already exist (e.g. from testing) are listed by this query;
-- cancel or reject the duplicates:
--
-- SELECT e.full_name, a.start_date, a.end_date, a.status, b.start_date, b.end_date, b.status
-- FROM leave_requests a
-- JOIN leave_requests b ON a.employee_id = b.employee_id AND a.id < b.id
--   AND a.start_date <= b.end_date AND a.end_date >= b.start_date
--   AND NOT (a.duration = 'half' AND b.duration = 'half' AND a.half_day_session IS DISTINCT FROM b.half_day_session)
-- JOIN employees e ON e.id = a.employee_id
-- WHERE a.status IN ('pending', 'approved') AND b.status IN ('pending', 'approved');
