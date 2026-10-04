-- ============================================================
-- Sproutbien — Choice holidays (e.g. "Onam: take 1 of 27 or 28 Aug")
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • An admin offers a holiday as a choice: its dates (all in one month),
--     how many to take, a deadline to choose by, the default date(s), and an
--     optional limit on how many people can be off on each date.
--   • Employees choose their date(s) until the deadline, and can change them
--     until then. Admins can set or change anyone's dates at any time, and
--     aren't held to the per-date limits.
--   • Until someone chooses, the default date(s) are their holiday; anyone who
--     hasn't chosen by the deadline keeps the default.
--   • The chosen date is a holiday for that employee only: it isn't counted in
--     leave, isn't Absent, and shows as a holiday on their calendar. The other
--     date is a normal working day for them.
--   • Leave can't be requested on a choice date before choosing (until the
--     deadline), and choices can't change while there's pending or approved
--     leave on any of the dates.
--   • Leave that already exists is recounted automatically when holidays
--     change under it: adding / moving / removing a public holiday, or adding /
--     editing / deleting a choice holiday. Fewer days: Loss of Pay goes first,
--     then paid days return to the balance. More days: paid if the balance
--     (and monthly limit) allows, otherwise Loss of Pay. Leave left with no
--     working days at all is cancelled quietly.
--   • A choice can be edited or deleted until its first date. Editing the
--     number of days or removing a date clears everyone's choices.
--   • "Is this a holiday for this employee?" is answered by is_holiday_for();
--     leave counting and the monthly leave limits now use it.
-- ============================================================

CREATE TABLE IF NOT EXISTS holiday_choices (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (length(trim(name)) > 0),
  pick_count integer     NOT NULL CHECK (pick_count >= 1),
  choose_by  date        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holiday_choice_dates (
  choice_id  uuid    NOT NULL REFERENCES holiday_choices(id) ON DELETE CASCADE,
  date       date    NOT NULL UNIQUE,              -- a date belongs to one choice at most
  is_default boolean NOT NULL DEFAULT false,
  max_people integer CHECK (max_people >= 1),      -- NULL = no limit
  PRIMARY KEY (choice_id, date)
);

CREATE TABLE IF NOT EXISTS holiday_picks (
  choice_id   uuid        NOT NULL,
  employee_id uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  picked_by   uuid        REFERENCES employees(id) ON DELETE SET NULL,
  picked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (choice_id, employee_id, date),
  FOREIGN KEY (choice_id, date) REFERENCES holiday_choice_dates(choice_id, date) ON DELETE CASCADE
);

-- Everyone reads the choices; picks are own or admin. All writes go through the functions below.
ALTER TABLE holiday_choices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_choice_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_picks        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holiday_choices: everyone reads"
  ON holiday_choices FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "holiday_choice_dates: everyone reads"
  ON holiday_choice_dates FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "holiday_picks: own or admin"
  ON holiday_picks FOR SELECT USING (employee_id = auth.uid() OR is_admin());

-- ── Is a date a holiday for this employee? ──────────────────

-- Their choice: their own complete set of dates, else the defaults
CREATE OR REPLACE FUNCTION choice_holiday_on(p_employee uuid, p_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM holiday_choice_dates d
    JOIN holiday_choices c ON c.id = d.choice_id
    WHERE d.date = p_date
      AND CASE
            WHEN (SELECT count(*) FROM holiday_picks p WHERE p.choice_id = c.id AND p.employee_id = p_employee) = c.pick_count
              THEN EXISTS (SELECT 1 FROM holiday_picks p
                           WHERE p.choice_id = c.id AND p.employee_id = p_employee AND p.date = p_date)
            ELSE d.is_default
          END)
$$;

REVOKE EXECUTE ON FUNCTION choice_holiday_on(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION choice_holiday_on(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION is_holiday_for(p_employee uuid, p_date date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public_holidays h WHERE h.date = p_date)
      OR choice_holiday_on(p_employee, p_date)
$$;

-- Working days in an employee's leave: Sundays and their holidays don't count; a half day is 0.5.
-- (The older leave_working_days(start, end, duration) only knows company-wide holidays.)
CREATE OR REPLACE FUNCTION leave_working_days(p_employee uuid, p_start date, p_end date, p_duration text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_duration = 'half' THEN 0.5 ELSE 1 END * count(*)
  FROM generate_series(p_start, p_end, interval '1 day') AS g(d)
  WHERE extract(dow FROM g.d) <> 0
    AND NOT is_holiday_for(p_employee, g.d::date)
$$;

-- Choice holidays per employee between two dates (admin: everyone; employee: their own)
CREATE OR REPLACE FUNCTION choice_holidays_between(p_from date, p_to date)
RETURNS TABLE (employee_id uuid, date date, name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, d.date, c.name
  FROM holiday_choice_dates d
  JOIN holiday_choices c ON c.id = d.choice_id
  CROSS JOIN employees e
  WHERE d.date BETWEEN p_from AND p_to
    AND (e.id = auth.uid() OR is_admin())
    AND choice_holiday_on(e.id, d.date)
  ORDER BY d.date
$$;

REVOKE EXECUTE ON FUNCTION choice_holidays_between(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION choice_holidays_between(date, date) TO authenticated;

-- ── Employee: their choices still to come ───────────────────
-- [{ id, name, pick_count, choose_by, open, my_dates, chosen, dates: [{ date, is_default, max_people, taken }] }]
-- my_dates = their holiday date(s) now (chosen, else the defaults); taken = others who chose it.

CREATE OR REPLACE FUNCTION my_holiday_choices()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'first_date'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', c.id, 'name', c.name, 'pick_count', c.pick_count, 'choose_by', c.choose_by,
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
    GROUP BY c.id
    HAVING max(d.date) >= (now() AT TIME ZONE 'Asia/Kolkata')::date
  ) s
$$;

REVOKE EXECUTE ON FUNCTION my_holiday_choices() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION my_holiday_choices() TO authenticated;

-- ── Choose (employee) or set (admin) someone's dates ────────
-- p_dates empty = clear (back to the defaults).

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

REVOKE EXECUTE ON FUNCTION set_holiday_picks(uuid, date[], uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_holiday_picks(uuid, date[], uuid) TO authenticated;

-- ── Admin: add / edit / delete a choice holiday ─────────────
-- p_dates: [{ "date": "2026-08-27", "is_default": false, "max_people": 5 }, …]

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
  DELETE FROM _choice_dates;
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

CREATE OR REPLACE FUNCTION delete_holiday_choice(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c      holiday_choices;
  v_from date;
  v_to   date;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO c FROM holiday_choices WHERE id = p_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN; END IF;
  SELECT min(date), max(date) INTO v_from, v_to FROM holiday_choice_dates WHERE choice_id = p_id;
  IF v_from <= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION '% has already started and can''t be deleted.', c.name;
  END IF;
  DELETE FROM holiday_choices WHERE id = p_id;
  PERFORM recount_leave_between(v_from, v_to);
END;
$$;

REVOKE EXECUTE ON FUNCTION save_holiday_choice(uuid, text, integer, date, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION save_holiday_choice(uuid, text, integer, date, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION delete_holiday_choice(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION delete_holiday_choice(uuid) TO authenticated;

-- A public holiday can't land on a choice date
CREATE OR REPLACE FUNCTION check_public_holiday_not_choice()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_name text;
BEGIN
  SELECT c.name INTO v_name FROM holiday_choice_dates d JOIN holiday_choices c ON c.id = d.choice_id WHERE d.date = NEW.date;
  IF FOUND THEN
    RAISE EXCEPTION '% is one of the % dates. Remove it from that holiday first.', to_char(NEW.date, 'FMDD Mon'), v_name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS public_holidays_not_choice ON public_holidays;
CREATE TRIGGER public_holidays_not_choice
  BEFORE INSERT OR UPDATE OF date ON public_holidays
  FOR EACH ROW EXECUTE FUNCTION check_public_holiday_not_choice();

-- ── Leave on a choice date needs the choice made first ──────
-- Until the deadline; after it, the defaults apply to anyone who didn't choose.

CREATE OR REPLACE FUNCTION check_leave_choice_holiday()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('leave:' || NEW.employee_id::text));
  SELECT d.date, c.name INTO v
  FROM holiday_choice_dates d
  JOIN holiday_choices c ON c.id = d.choice_id
  WHERE d.date BETWEEN NEW.start_date AND NEW.end_date
    AND (now() AT TIME ZONE 'Asia/Kolkata')::date <= c.choose_by
    AND (SELECT count(*) FROM holiday_picks p WHERE p.choice_id = c.id AND p.employee_id = NEW.employee_id) <> c.pick_count
  ORDER BY d.date LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% is one of the % holiday dates. Choose your % holiday first (on your Dashboard or Leaves page), then request leave.',
      to_char(v.date, 'FMDD Mon'), v.name, v.name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_choice_holiday ON leave_requests;
CREATE TRIGGER on_leave_choice_holiday
  BEFORE INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION check_leave_choice_holiday();

-- ============================================================
-- Leave counting with each employee's own holidays.
-- The functions below are the latest versions (migrations 014 and 026)
-- with only the holiday check changed to is_holiday_for().
-- ============================================================

CREATE OR REPLACE FUNCTION set_leave_request_days()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.days      := leave_working_days(NEW.employee_id, NEW.start_date, NEW.end_date, NEW.duration);
  NEW.paid_days := NULL;
  NEW.lop_days  := NULL;
  IF NEW.days = 0 THEN
    RAISE EXCEPTION 'The selected dates are all Sundays or holidays — no leave is needed';
  END IF;
  RETURN NEW;
END;
$$;

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
      AND NOT is_holiday_for(p_employee, g.d::date)
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

DROP FUNCTION IF EXISTS leave_paid_in_month(date, date, text, numeric, date);

CREATE OR REPLACE FUNCTION leave_paid_in_month(p_employee uuid, p_start date, p_end date, p_duration text, p_paid numeric, p_month date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH w AS (
    SELECT g.d::date AS d, row_number() OVER (ORDER BY g.d) AS n,
           CASE WHEN p_duration = 'half' THEN 0.5 ELSE 1 END AS portion
    FROM generate_series(p_start, p_end, interval '1 day') AS g(d)
    WHERE extract(dow FROM g.d) <> 0
      AND NOT is_holiday_for(p_employee, g.d::date)
  )
  SELECT COALESCE(sum(least(portion, greatest(0, COALESCE(p_paid, 0) - (n - 1) * portion))), 0)
  FROM w
  WHERE date_trunc('month', d)::date = p_month
$$;

CREATE OR REPLACE FUNCTION leave_month_capped_used(p_employee uuid, p_month date, p_exclude uuid, p_with_pending boolean)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(leave_paid_in_month(r.employee_id, r.start_date, r.end_date, r.duration,
           CASE WHEN r.status = 'approved' THEN COALESCE(r.paid_days, r.days)
                ELSE COALESCE(r.planned_paid_days, r.days) END,
           p_month)), 0)
  FROM leave_requests r
  WHERE r.employee_id = p_employee
    AND leave_type_month_capped(r.leave_type)
    AND (r.status = 'approved' OR (p_with_pending AND r.status = 'pending'))
    AND r.id IS DISTINCT FROM p_exclude
    AND r.start_date < (p_month + interval '1 month')::date
    AND r.end_date >= p_month
$$;

CREATE OR REPLACE FUNCTION leave_cap_paid(
  p_employee uuid, p_type text, p_start date, p_end date, p_duration text,
  p_exclude uuid, p_with_pending boolean
)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_portion numeric := CASE WHEN p_duration = 'half' THEN 0.5 ELSE 1 END;
  v_paid    numeric := 0;
  v_month   date;
  v_max     numeric;
  v_left    numeric;   -- NULL = no limit this month
  v_take    numeric;
  d         date;
BEGIN
  IF NOT leave_type_month_capped(p_type) THEN
    RETURN leave_working_days(p_employee, p_start, p_end, p_duration);
  END IF;

  FOR d IN
    SELECT g.d::date FROM generate_series(p_start, p_end, interval '1 day') AS g(d)
    WHERE extract(dow FROM g.d) <> 0
      AND NOT is_holiday_for(p_employee, g.d::date)
    ORDER BY 1
  LOOP
    IF v_month IS DISTINCT FROM date_trunc('month', d)::date THEN
      v_month := date_trunc('month', d)::date;
      SELECT c.max_days INTO v_max FROM leave_month_caps c WHERE c.month = v_month;
      v_left := CASE WHEN v_max IS NULL THEN NULL
                     ELSE greatest(0, v_max - leave_month_capped_used(p_employee, v_month, p_exclude, p_with_pending)) END;
    END IF;

    IF v_left IS NULL THEN
      v_paid := v_paid + v_portion;
    ELSE
      v_take := least(v_portion, v_left);
      v_paid := v_paid + v_take;
      v_left := v_left - v_take;
      IF v_take < v_portion THEN RETURN v_paid; END IF;
    END IF;
  END LOOP;
  RETURN v_paid;
END;
$$;

CREATE OR REPLACE FUNCTION leave_paid_on_approval(r leave_requests)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_days      numeric := COALESCE(r.days, leave_working_days(r.employee_id, r.start_date, r.end_date, r.duration));
  v_available numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM leave_types WHERE code = r.leave_type AND is_paid) THEN
    RETURN 0;
  END IF;
  SELECT b.available INTO v_available
  FROM leave_balances(r.employee_id, r.start_date) b
  WHERE b.leave_type = r.leave_type;
  RETURN least(v_days,
               greatest(0, floor(COALESCE(v_available, 0) * 2) / 2),
               leave_cap_paid(r.employee_id, r.leave_type, r.start_date, r.end_date, r.duration, r.id, false));
END;
$$;

CREATE OR REPLACE FUNCTION check_leave_balance()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type   leave_types;
  v_bal    record;
  v_days   numeric := leave_working_days(NEW.employee_id, NEW.start_date, NEW.end_date, NEW.duration);
  v_free   numeric;
  v_paid   numeric;   -- what the balance covers
  v_cap    numeric;   -- what the monthly limits allow
  v_target numeric;   -- paid days wanted after the limits
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

  v_free   := greatest(0, COALESCE(v_bal.available, 0) - COALESCE(v_bal.pending, 0));
  v_paid   := floor(v_free * 2) / 2;   -- leave is taken in half days
  v_cap    := leave_cap_paid(NEW.employee_id, NEW.leave_type, NEW.start_date, NEW.end_date, NEW.duration, NULL, true);
  v_target := least(v_days, v_cap);

  -- Balance short of what the limits allow: their consent is needed, as before
  IF v_paid < v_target THEN
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
      v_type.name, trim_scale(v_target), trim_scale(v_free),
      CASE WHEN v_free = 1 THEN 'is' ELSE 'are' END,
      CASE WHEN COALESCE(v_bal.pending, 0) > 0
           THEN ' (after ' || trim_scale(v_bal.pending) || ' day(s) waiting for approval)' ELSE '' END;
  END IF;

  -- Over a monthly limit: the rest is Loss of Pay automatically
  IF v_target < v_days THEN
    NEW.planned_paid_days := v_target;
    NEW.split_with_lop := true;
    RETURN NEW;
  END IF;

  NEW.split_with_lop := false;   -- it all fits; nothing to split
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION handle_leave_approval()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    NEW.days      := COALESCE(NEW.days, leave_working_days(NEW.employee_id, NEW.start_date, NEW.end_date, NEW.duration));
    NEW.paid_days := leave_paid_on_approval(NEW);
    NEW.lop_days  := NEW.days - NEW.paid_days;

    PERFORM apply_leave_to_attendance(NEW.employee_id, NEW.start_date, NEW.end_date,
                                      NEW.duration, NEW.half_day_session, NEW.paid_days);

    IF NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_leave_today(p_id uuid, p_mode text DEFAULT 'onward')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          leave_requests;
  v_today    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_cut_end  date;            -- last cancelled day
  v_before   numeric := 0;    -- working days kept before today
  v_after    numeric := 0;    -- working days kept after the cancelled part
  v_cut      numeric;
  v_paid     numeric;         -- paid days (approved) or planned paid days (pending) to share out
  v_paid_b   numeric := 0;
  v_paid_a   numeric := 0;
BEGIN
  IF p_mode NOT IN ('today', 'onward') THEN
    RAISE EXCEPTION 'Unknown cancel option';
  END IF;

  SELECT * INTO r FROM leave_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR r.employee_id <> auth.uid() THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;
  IF r.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Only pending or approved leave can be cancelled';
  END IF;
  IF r.duration <> 'full' OR v_today NOT BETWEEN r.start_date AND r.end_date THEN
    RAISE EXCEPTION 'This leave doesn''t cover today';
  END IF;
  IF EXISTS (SELECT 1 FROM attendance_records
             WHERE employee_id = r.employee_id AND date = v_today AND check_in_time IS NOT NULL) THEN
    RAISE EXCEPTION 'You''ve already checked in today';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('leave:' || r.employee_id::text));

  v_cut_end := CASE WHEN p_mode = 'today' THEN v_today ELSE r.end_date END;
  IF r.start_date < v_today THEN
    v_before := leave_working_days(r.employee_id, r.start_date, v_today - 1, 'full');
  END IF;
  IF v_cut_end < r.end_date THEN
    v_after := leave_working_days(r.employee_id, v_cut_end + 1, r.end_date, 'full');
  END IF;
  v_cut := leave_working_days(r.employee_id, v_today, v_cut_end, 'full');

  -- Paid days stay on the earliest remaining dates
  v_paid := CASE WHEN r.status = 'approved' THEN r.paid_days ELSE r.planned_paid_days END;
  IF v_paid IS NOT NULL THEN
    v_paid_b := least(v_paid, v_before);
  END IF;

  -- Take today's (and maybe later) days off the attendance sheet
  IF r.status = 'approved' THEN
    DELETE FROM attendance_records
    WHERE employee_id = r.employee_id
      AND date BETWEEN v_today AND v_cut_end
      AND check_in_time IS NULL AND status = 'on_leave';
  END IF;

  -- Kept days become their own requests (same status, reason, voice note, review)
  PERFORM set_config('sb.leave_split', 'on', true);
  PERFORM set_config('sb.leave_split_from', p_id::text, true);   -- documents follow the kept days
  IF v_before > 0 THEN
    INSERT INTO leave_requests (
      employee_id, start_date, end_date, duration, half_day_session, leave_type, reason,
      voice_note_path, voice_note_seconds, split_with_lop, planned_paid_days,
      status, requested_at, reviewed_by, reviewed_at, days, paid_days, lop_days)
    VALUES (
      r.employee_id, r.start_date, v_today - 1, 'full', NULL, r.leave_type, r.reason,
      r.voice_note_path, r.voice_note_seconds, r.split_with_lop,
      CASE WHEN r.status = 'pending' AND v_paid IS NOT NULL THEN v_paid_b END,
      r.status, r.requested_at, r.reviewed_by, r.reviewed_at, v_before,
      CASE WHEN r.status = 'approved' THEN v_paid_b END,
      CASE WHEN r.status = 'approved' THEN v_before - v_paid_b END);
  END IF;
  IF v_after > 0 THEN
    -- Worked out after the earlier part is saved, so its days count towards the limits
    IF v_paid IS NOT NULL THEN
      v_paid_a := least(v_paid - v_paid_b, v_after,
                        leave_cap_paid(r.employee_id, r.leave_type, v_cut_end + 1, r.end_date, 'full',
                                       p_id, r.status = 'pending'));
    END IF;
    INSERT INTO leave_requests (
      employee_id, start_date, end_date, duration, half_day_session, leave_type, reason,
      voice_note_path, voice_note_seconds, split_with_lop, planned_paid_days,
      status, requested_at, reviewed_by, reviewed_at, days, paid_days, lop_days)
    VALUES (
      r.employee_id, v_cut_end + 1, r.end_date, 'full', NULL, r.leave_type, r.reason,
      r.voice_note_path, r.voice_note_seconds, r.split_with_lop,
      CASE WHEN r.status = 'pending' AND v_paid IS NOT NULL THEN v_paid_a END,
      r.status, r.requested_at, r.reviewed_by, r.reviewed_at, v_after,
      CASE WHEN r.status = 'approved' THEN v_paid_a END,
      CASE WHEN r.status = 'approved' THEN v_after - v_paid_a END);
    -- A freed paid day may now cover a day that was Loss of Pay
    IF r.status = 'approved' THEN
      PERFORM apply_leave_to_attendance(r.employee_id, v_cut_end + 1, r.end_date, 'full', NULL, v_paid_a);
    END IF;
  END IF;
  PERFORM set_config('sb.leave_split', 'off', true);

  -- The original request becomes the cancelled part (admin is notified as usual)
  UPDATE leave_requests SET
    start_date               = v_today,
    end_date                 = v_cut_end,
    days                     = v_cut,
    paid_days                = CASE WHEN r.status = 'approved' THEN greatest(0, least(v_cut, v_paid - v_paid_b - v_paid_a)) END,
    lop_days                 = CASE WHEN r.status = 'approved' THEN v_cut - greatest(0, least(v_cut, v_paid - v_paid_b - v_paid_a)) END,
    planned_paid_days        = NULL,
    status                   = 'cancelled',
    cancelled_at             = now(),
    cancelled_after_approval = (r.status = 'approved')
  WHERE id = p_id;
END;
$$;

-- ============================================================
-- Recount existing leave when holidays change under it
-- ============================================================

-- One pending or approved leave, with today's holidays for that employee.
CREATE OR REPLACE FUNCTION recount_leave(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       leave_requests;
  v_days  numeric;
  v_paid  numeric := 0;
  v_avail numeric;
BEGIN
  SELECT * INTO r FROM leave_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR r.status NOT IN ('pending', 'approved') THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('leave:' || r.employee_id::text));

  v_days := leave_working_days(r.employee_id, r.start_date, r.end_date, r.duration);
  IF v_days = r.days THEN RETURN; END IF;

  -- Take what approval put on the attendance sheet off again (as cancelling does)
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

  -- Every day is now a holiday: no leave needed. Cancelled quietly — no WhatsApp
  -- (the split setting skips that trigger) and no "cancelled" alert for the admin.
  IF v_days = 0 THEN
    PERFORM set_config('sb.leave_split', 'on', true);
    UPDATE leave_requests SET
      status                   = 'cancelled',
      cancelled_at             = now(),
      cancel_seen_at           = now(),
      cancelled_after_approval = (r.status = 'approved'),
      days                     = 0,
      paid_days                = CASE WHEN r.status = 'approved' THEN 0 END,
      lop_days                 = CASE WHEN r.status = 'approved' THEN 0 END,
      planned_paid_days        = NULL
    WHERE id = p_id;
    PERFORM set_config('sb.leave_split', 'off', true);
    RETURN;
  END IF;

  -- Pending: only the day count and the planned paid part (approval settles the rest)
  IF r.status = 'pending' THEN
    UPDATE leave_requests SET
      days              = v_days,
      planned_paid_days = CASE WHEN r.planned_paid_days < v_days THEN r.planned_paid_days END,
      split_with_lop    = COALESCE(r.planned_paid_days < v_days, false)
    WHERE id = p_id;
    RETURN;
  END IF;

  -- Approved. Fewer days: keep the paid days (so Loss of Pay goes first), never more than
  -- the days left. More days: the extra is paid if the balance allows. Monthly limits apply.
  IF EXISTS (SELECT 1 FROM leave_types WHERE code = r.leave_type AND is_paid) THEN
    v_paid := COALESCE(r.paid_days, 0);
    IF v_days > r.days THEN
      SELECT b.available INTO v_avail
      FROM leave_balances(r.employee_id, r.start_date) b
      WHERE b.leave_type = r.leave_type;
      v_paid := v_paid + greatest(0, floor(COALESCE(v_avail, 0) * 2) / 2);
    END IF;
    v_paid := least(v_days, v_paid,
                    leave_cap_paid(r.employee_id, r.leave_type, r.start_date, r.end_date, r.duration, r.id, false));
  END IF;

  UPDATE leave_requests SET days = v_days, paid_days = v_paid, lop_days = v_days - v_paid WHERE id = p_id;
  PERFORM apply_leave_to_attendance(r.employee_id, r.start_date, r.end_date, r.duration, r.half_day_session, v_paid);
END;
$$;

-- Every pending / approved leave touching these dates (one employee, or everyone)
CREATE OR REPLACE FUNCTION recount_leave_between(p_from date, p_to date, p_employee uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM leave_requests
    WHERE status IN ('pending', 'approved')
      AND start_date <= p_to AND end_date >= p_from
      AND (p_employee IS NULL OR employee_id = p_employee)
    ORDER BY start_date, requested_at
  LOOP
    PERFORM recount_leave(v_id);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION recount_leave(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION recount_leave_between(date, date, uuid) FROM PUBLIC, anon, authenticated;

-- Public holiday added, moved or removed
CREATE OR REPLACE FUNCTION recount_leave_for_public_holiday()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM recount_leave_between(NEW.date, NEW.date); END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM recount_leave_between(OLD.date, OLD.date); END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS public_holidays_recount_leave ON public_holidays;
CREATE TRIGGER public_holidays_recount_leave
  AFTER INSERT OR UPDATE OF date OR DELETE ON public_holidays
  FOR EACH ROW EXECUTE FUNCTION recount_leave_for_public_holiday();

-- ── Admin: who has leave on these dates (warning before changing holidays) ──

CREATE OR REPLACE FUNCTION leave_on_dates(p_dates date[])
RETURNS TABLE (employee_id uuid, full_name text, start_date date, end_date date, status text, leave_type text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.employee_id, e.full_name, l.start_date, l.end_date, l.status, l.leave_type
  FROM leave_requests l
  JOIN employees e ON e.id = l.employee_id
  WHERE is_admin()
    AND l.status IN ('pending', 'approved')
    AND EXISTS (SELECT 1 FROM unnest(p_dates) AS d WHERE d BETWEEN l.start_date AND l.end_date)
  ORDER BY l.start_date, e.full_name
$$;

REVOKE EXECUTE ON FUNCTION leave_on_dates(date[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION leave_on_dates(date[]) TO authenticated;
