-- ============================================================
-- Sproutbien — Choice holidays: the admin sets when choosing opens
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • holiday_choices.opens_on: the first day employees can choose (NULL =
--     straight away, as before; existing choice holidays keep that).
--     It must be on or before the last day to choose.
--   • Before that day employees don't see the choice at all (no "Choose your
--     holiday" card) and can't choose; the default date(s) still apply.
--     Admins can still set anyone's dates.
--   • Leave on a choice date before choosing opens explains when it opens.
-- ============================================================

ALTER TABLE holiday_choices ADD COLUMN IF NOT EXISTS opens_on date;
ALTER TABLE holiday_choices DROP CONSTRAINT IF EXISTS holiday_choices_opens_before_deadline;
ALTER TABLE holiday_choices ADD CONSTRAINT holiday_choices_opens_before_deadline CHECK (opens_on IS NULL OR opens_on <= choose_by);

-- ── Employee: their choices (only once choosing has opened) ─
CREATE OR REPLACE FUNCTION my_holiday_choices()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'first_date'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', c.id, 'name', c.name, 'pick_count', c.pick_count, 'choose_by', c.choose_by, 'opens_on', c.opens_on,
      'first_date', min(d.date),
      'open', (now() AT TIME ZONE 'Asia/Kolkata')::date <= c.choose_by,
      'chosen', (SELECT count(*) FROM holiday_picks p WHERE p.choice_id = c.id AND p.employee_id = auth.uid()) = c.pick_count,
      'my_dates', COALESCE(jsonb_agg(d.date ORDER BY d.date) FILTER (WHERE choice_holiday_on(auth.uid(), d.date)), '[]'::jsonb),
      'dates', jsonb_agg(jsonb_build_object(
                 'date', d.date, 'is_default', d.is_default, 'max_people', d.max_people,
                 'taken', (SELECT count(*) FROM holiday_picks p
                           WHERE p.choice_id = c.id AND p.date = d.date AND p.employee_id <> auth.uid()))
               ORDER BY d.date)) AS x
    FROM holiday_choices c
    JOIN holiday_choice_dates d ON d.choice_id = c.id
    WHERE auth.uid() IS NOT NULL
      AND (c.opens_on IS NULL OR c.opens_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date)   -- not shown before the window opens
    GROUP BY c.id
    HAVING max(d.date) >= (now() AT TIME ZONE 'Asia/Kolkata')::date
  ) s
$$;

-- ── Choose (employee) or set (admin) someone's dates ────────
CREATE OR REPLACE FUNCTION set_holiday_picks(p_choice uuid, p_dates date[], p_employee uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp   uuid    := COALESCE(p_employee, auth.uid());
  v_admin boolean := is_admin();
  v_today date    := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_dates date[]  := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_dates, '{}')) AS x ORDER BY 1);
  c       holiday_choices;
  v_date  date;
  v_max   integer;
BEGIN
  IF auth.uid() IS NULL OR (v_emp <> auth.uid() AND NOT v_admin) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- Locks: the choice (per-date limits) and the employee's leave (no leave slipping in meanwhile)
  SELECT * INTO c FROM holiday_choices WHERE id = p_choice FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Holiday not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('leave:' || v_emp::text));

  IF NOT v_admin AND c.opens_on IS NOT NULL AND v_today < c.opens_on THEN
    RAISE EXCEPTION 'Choosing your % holiday opens on %.', c.name, to_char(c.opens_on, 'FMDD Mon');
  END IF;
  IF NOT v_admin AND v_today > c.choose_by THEN
    RAISE EXCEPTION 'The last day to choose your % holiday was %. Ask your admin to change it.',
      c.name, to_char(c.choose_by, 'FMDD Mon');
  END IF;
  IF cardinality(v_dates) NOT IN (0, c.pick_count) THEN
    RAISE EXCEPTION 'Choose % day% for %.', c.pick_count, CASE WHEN c.pick_count = 1 THEN '' ELSE 's' END, c.name;
  END IF;

  SELECT x INTO v_date FROM unnest(v_dates) AS x
  WHERE NOT EXISTS (SELECT 1 FROM holiday_choice_dates d WHERE d.choice_id = c.id AND d.date = x)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% isn''t one of the % dates.', to_char(v_date, 'FMDD Mon'), c.name;
  END IF;

  -- Leave days were counted with today's holidays; don't move a holiday under existing leave
  SELECT d.date INTO v_date
  FROM holiday_choice_dates d
  WHERE d.choice_id = c.id
    AND EXISTS (SELECT 1 FROM leave_requests l
                WHERE l.employee_id = v_emp AND l.status IN ('pending', 'approved')
                  AND d.date BETWEEN l.start_date AND l.end_date)
  ORDER BY d.date LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'There''s pending or approved leave on %. Cancel that leave first, then change the % holiday.',
      to_char(v_date, 'FMDD Mon'), c.name;
  END IF;

  IF NOT v_admin THEN
    SELECT d.date, d.max_people INTO v_date, v_max
    FROM holiday_choice_dates d
    WHERE d.choice_id = c.id AND d.date = ANY (v_dates) AND d.max_people IS NOT NULL
      AND (SELECT count(*) FROM holiday_picks p
           WHERE p.choice_id = c.id AND p.date = d.date AND p.employee_id <> v_emp) >= d.max_people
    ORDER BY d.date LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION '% is full (% people already chose it). Choose another day.', to_char(v_date, 'FMDD Mon'), v_max;
    END IF;
  END IF;

  DELETE FROM holiday_picks WHERE choice_id = c.id AND employee_id = v_emp;
  INSERT INTO holiday_picks (choice_id, employee_id, date, picked_by)
  SELECT c.id, v_emp, x, auth.uid() FROM unnest(v_dates) AS x;
END;
$$;

-- ── Admin: add / edit a choice holiday, now with opens_on ───
DROP FUNCTION IF EXISTS save_holiday_choice(uuid, text, integer, date, jsonb);
CREATE OR REPLACE FUNCTION save_holiday_choice(
  p_id uuid, p_name text, p_pick_count integer, p_choose_by date, p_dates jsonb, p_opens_on date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_id      uuid := p_id;
  v_n       integer;
  v_first   date;
  v_bad     record;
  v_old     holiday_choices;
  v_clear   boolean := false;
  v_from    date;
  v_to      date;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _choice_dates (date date, is_default boolean, max_people integer) ON COMMIT DROP;
  DELETE FROM _choice_dates WHERE true;   -- Supabase refuses a DELETE without WHERE
  INSERT INTO _choice_dates
  SELECT (x->>'date')::date, COALESCE((x->>'is_default')::boolean, false), nullif(x->>'max_people', '')::integer
  FROM jsonb_array_elements(COALESCE(p_dates, '[]')) AS x;

  SELECT count(*), min(date) INTO v_n, v_first FROM _choice_dates;

  IF COALESCE(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Give the holiday a name.'; END IF;
  IF v_n < 2 THEN RAISE EXCEPTION 'Add at least two dates to choose from.'; END IF;
  IF (SELECT count(DISTINCT date) FROM _choice_dates) <> v_n THEN RAISE EXCEPTION 'A date is listed twice.'; END IF;
  IF p_pick_count IS NULL OR p_pick_count < 1 OR p_pick_count >= v_n THEN
    RAISE EXCEPTION 'Days to take must be at least 1 and fewer than the number of dates.';
  END IF;
  IF (SELECT count(DISTINCT date_trunc('month', date)) FROM _choice_dates) > 1 THEN
    RAISE EXCEPTION 'All the dates must be in the same month (payroll counts holidays per month).';
  END IF;
  IF (SELECT count(*) FROM _choice_dates WHERE is_default) <> p_pick_count THEN
    RAISE EXCEPTION 'Mark % date% as the default for anyone who doesn''t choose.',
      p_pick_count, CASE WHEN p_pick_count = 1 THEN '' ELSE 's' END;
  END IF;
  IF EXISTS (SELECT 1 FROM _choice_dates WHERE max_people IS NOT NULL AND max_people < 1) THEN
    RAISE EXCEPTION 'The limit per date must be 1 or more (or left empty).';
  END IF;
  IF p_choose_by IS NULL OR p_choose_by >= v_first THEN
    RAISE EXCEPTION 'The last day to choose must be before the first date.';
  END IF;
  IF p_opens_on IS NOT NULL AND p_opens_on > p_choose_by THEN
    RAISE EXCEPTION 'Choosing must open on or before the last day to choose.';
  END IF;

  SELECT date INTO v_bad FROM _choice_dates WHERE extract(dow FROM date) = 0 LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION '% is a Sunday.', to_char(v_bad.date, 'FMDD Mon'); END IF;
  SELECT t.date, h.name INTO v_bad FROM _choice_dates t JOIN public_holidays h ON h.date = t.date LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION '% is already a public holiday (%).', to_char(v_bad.date, 'FMDD Mon'), v_bad.name; END IF;
  SELECT t.date, c.name INTO v_bad
  FROM _choice_dates t JOIN holiday_choice_dates d ON d.date = t.date JOIN holiday_choices c ON c.id = d.choice_id
  WHERE c.id IS DISTINCT FROM p_id LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION '% is already a date of %.', to_char(v_bad.date, 'FMDD Mon'), v_bad.name; END IF;

  IF p_id IS NULL THEN
    INSERT INTO holiday_choices (name, pick_count, choose_by, opens_on)
    VALUES (trim(p_name), p_pick_count, p_choose_by, p_opens_on) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_old FROM holiday_choices WHERE id = p_id FOR UPDATE;
    IF v_old.id IS NULL THEN RAISE EXCEPTION 'Holiday not found'; END IF;
    SELECT min(date), max(date) INTO v_from, v_to FROM holiday_choice_dates WHERE choice_id = p_id;
    IF (SELECT min(date) FROM holiday_choice_dates WHERE choice_id = p_id) <= v_today THEN
      RAISE EXCEPTION '% has already started and can''t be changed. You can still change people''s dates.', v_old.name;
    END IF;
    -- Fewer/more days to take, or a date taken away: everyone chooses again
    v_clear := v_old.pick_count <> p_pick_count
      OR EXISTS (SELECT 1 FROM holiday_choice_dates d WHERE d.choice_id = p_id
                 AND NOT EXISTS (SELECT 1 FROM _choice_dates t WHERE t.date = d.date));
    IF v_clear THEN DELETE FROM holiday_picks WHERE choice_id = p_id; END IF;
    UPDATE holiday_choices SET name = trim(p_name), pick_count = p_pick_count, choose_by = p_choose_by, opens_on = p_opens_on WHERE id = p_id;
    DELETE FROM holiday_choice_dates d WHERE d.choice_id = p_id
      AND NOT EXISTS (SELECT 1 FROM _choice_dates t WHERE t.date = d.date);
  END IF;

  INSERT INTO holiday_choice_dates (choice_id, date, is_default, max_people)
  SELECT v_id, date, is_default, max_people FROM _choice_dates
  ON CONFLICT (choice_id, date) DO UPDATE SET is_default = EXCLUDED.is_default, max_people = EXCLUDED.max_people;

  -- Existing leave on the old and new dates
  PERFORM recount_leave_between(least(v_first, COALESCE(v_from, v_first)),
                                greatest((SELECT max(date) FROM _choice_dates), COALESCE(v_to, v_first)));
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION save_holiday_choice(uuid, text, integer, date, jsonb, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION save_holiday_choice(uuid, text, integer, date, jsonb, date) TO authenticated;

-- ── Leave on a choice date needs the choice made first ──────
CREATE OR REPLACE FUNCTION check_leave_choice_holiday()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('leave:' || NEW.employee_id::text));
  SELECT d.date, c.name, c.opens_on INTO v
  FROM holiday_choice_dates d
  JOIN holiday_choices c ON c.id = d.choice_id
  WHERE d.date BETWEEN NEW.start_date AND NEW.end_date
    AND (now() AT TIME ZONE 'Asia/Kolkata')::date <= c.choose_by
    AND (SELECT count(*) FROM holiday_picks p WHERE p.choice_id = c.id AND p.employee_id = NEW.employee_id) <> c.pick_count
  ORDER BY d.date LIMIT 1;
  IF FOUND AND v.opens_on IS NOT NULL AND (now() AT TIME ZONE 'Asia/Kolkata')::date < v.opens_on THEN
    RAISE EXCEPTION '% is one of the % holiday dates. Choosing opens on %; request leave for that day after you''ve chosen.',
      to_char(v.date, 'FMDD Mon'), v.name, to_char(v.opens_on, 'FMDD Mon');
  END IF;
  IF FOUND THEN
    RAISE EXCEPTION '% is one of the % holiday dates. Choose your % holiday first (on your Dashboard or Leaves page), then request leave.',
      to_char(v.date, 'FMDD Mon'), v.name, v.name;
  END IF;
  RETURN NEW;
END;
$$;
