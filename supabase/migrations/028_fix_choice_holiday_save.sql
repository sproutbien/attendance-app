-- ============================================================
-- Sproutbien — Fix: saving a choice holiday failed
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Supabase refuses DELETE statements without a WHERE clause when they come
-- from the app, so save_holiday_choice() (migration 027) failed with
-- "DELETE requires a WHERE clause". Same function, with that line fixed.
-- ============================================================

CREATE OR REPLACE FUNCTION save_holiday_choice(
  p_id uuid, p_name text, p_pick_count integer, p_choose_by date, p_dates jsonb
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

  SELECT date INTO v_bad FROM _choice_dates WHERE extract(dow FROM date) = 0 LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION '% is a Sunday.', to_char(v_bad.date, 'FMDD Mon'); END IF;
  SELECT t.date, h.name INTO v_bad FROM _choice_dates t JOIN public_holidays h ON h.date = t.date LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION '% is already a public holiday (%).', to_char(v_bad.date, 'FMDD Mon'), v_bad.name; END IF;
  SELECT t.date, c.name INTO v_bad
  FROM _choice_dates t JOIN holiday_choice_dates d ON d.date = t.date JOIN holiday_choices c ON c.id = d.choice_id
  WHERE c.id IS DISTINCT FROM p_id LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION '% is already a date of %.', to_char(v_bad.date, 'FMDD Mon'), v_bad.name; END IF;

  IF p_id IS NULL THEN
    INSERT INTO holiday_choices (name, pick_count, choose_by)
    VALUES (trim(p_name), p_pick_count, p_choose_by) RETURNING id INTO v_id;
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
    UPDATE holiday_choices SET name = trim(p_name), pick_count = p_pick_count, choose_by = p_choose_by WHERE id = p_id;
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
