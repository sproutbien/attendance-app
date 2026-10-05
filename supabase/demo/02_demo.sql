-- ============================================================
-- Sproutbien DEMO project — step 2 of 2: demo data + nightly reset
-- Run AFTER 01_schema.sql, in the DEMO project's SQL Editor only.
-- NEVER run this on production: demo_reset() deletes every user and record.
--
--   • Company: Sproutbien Technologies, Trivandrum — 13 people, INR salaries,
--     IST shifts, Kerala holidays.
--   • History: from the 1st of the month 5 months ago up to yesterday, so all
--     6-month charts are full. Dates are relative to "today", so the demo
--     never looks stale. The app's demo build uses VITE_DEMO_HISTORY_MONTHS=5
--     so its tracking start matches.
--   • Today: everyone except the demo employee checks in / takes a break /
--     checks out on their own as the day goes on (demo_tick, every 5 min).
--     The demo employee's today is left blank so visitors can check in.
--   • Every night at 2:45 AM IST everything is wiped and re-seeded.
--     contact_messages (the landing page form) is never touched.
--   • The two login accounts can't be deleted, deactivated, demoted or have
--     their password / email changed.
--
-- Logins (password Demo@2026):
--   admin@demo.sproutbien.com     — Anitha Menon, HR Manager (admin)
--   employee@demo.sproutbien.com  — Arjun Nair, Software Engineer
--
-- Optional sample files (seeded only if they exist — upload in Storage, then
-- run SELECT demo_reset();):
--   leave-documents   / d0000000-0000-4000-8000-000000000002/demo/medical-certificate.pdf
--   leave-documents   / d0000000-0000-4000-8000-000000000005/demo/dental-appointment.pdf
--   leave-voice-notes / d0000000-0000-4000-8000-000000000002/demo-voice-note.webm
-- ============================================================

-- ── Leave is credited from April (undo migration 017's Oct-2026 start) ──
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

-- ── Landing page contact form (write-only for visitors) ─────
CREATE TABLE IF NOT EXISTS contact_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  email      text        NOT NULL CHECK (length(email) <= 200 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone      text        CHECK (length(phone) <= 30),
  company    text        CHECK (length(company) <= 150),
  team_size  text        CHECK (length(team_size) <= 30),
  plan       text        CHECK (length(plan) <= 50),
  message    text        NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_messages: anyone can send" ON contact_messages;
CREATE POLICY "contact_messages: anyone can send"
  ON contact_messages FOR INSERT TO anon, authenticated WITH CHECK (true);
-- No SELECT policy: read messages in Table Editor → contact_messages.
GRANT INSERT ON contact_messages TO anon, authenticated;

-- ── Helpers ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION demo_id(n integer)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

CREATE OR REPLACE FUNCTION demo_today()
RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

CREATE OR REPLACE FUNCTION demo_ts(d date, t time)
RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT (d + t) AT TIME ZONE 'Asia/Kolkata' $$;

CREATE OR REPLACE FUNCTION demo_is_working(d date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT extract(dow FROM d) <> 0 AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.date = d)
$$;

-- Today + p_off, moved off Sundays / holidays (away from today)
CREATE OR REPLACE FUNCTION demo_day(p_off integer)
RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE
  d    date    := demo_today() + p_off;
  step integer := CASE WHEN p_off < 0 THEN -1 ELSE 1 END;
BEGIN
  WHILE NOT demo_is_working(d) LOOP d := d + step; END LOOP;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION demo_mins(lo integer, hi integer)
RETURNS interval LANGUAGE sql VOLATILE AS $$ SELECT make_interval(mins => lo + floor(random() * (hi - lo + 1))::integer) $$;

-- ── The people ──────────────────────────────────────────────
-- late_p / absent_p / nobreak_p / longday_p shape each person's history.
CREATE TABLE IF NOT EXISTS demo_people (
  n            integer PRIMARY KEY,
  email        text    NOT NULL,
  full_name    text    NOT NULL,
  role         text    NOT NULL,
  department   text    NOT NULL,
  designation  text    NOT NULL,
  emp_type     text    NOT NULL,
  location     text    NOT NULL,
  status       text    NOT NULL,
  salary       numeric NOT NULL,
  joined       date,              -- fixed joining date …
  joined_ago   integer,           -- … or this many days ago
  lwd_off      integer,           -- last working day, days from today
  manager      integer,
  ec_name      text,
  ec_relation  text,
  late_p       numeric NOT NULL,
  absent_p     numeric NOT NULL,
  nobreak_p    numeric NOT NULL,
  longday_p    numeric NOT NULL
);
ALTER TABLE demo_people ENABLE ROW LEVEL SECURITY;   -- no policies: hidden from the app

TRUNCATE demo_people;
INSERT INTO demo_people VALUES
  ( 1, 'admin@demo.sproutbien.com',        'Anitha Menon',    'admin',    'HR & Admin',       'HR Manager',                   'Full-time', 'Trivandrum — Technopark', 'active',        85000, '2019-06-03', NULL, NULL, NULL, 'Suresh Menon',  'Spouse', 0.04, 0.01, 0.01, 0),
  ( 2, 'employee@demo.sproutbien.com',     'Arjun Nair',      'employee', 'Engineering',      'Software Engineer',            'Full-time', 'Trivandrum — Technopark', 'active',        62000, '2023-07-10', NULL, NULL, 3,    'Radha Nair',    'Mother', 0.1, 0.015, 0.01, 0),
  ( 3, 'rahul.krishnan@demo.sproutbien.com','Rahul Krishnan', 'employee', 'Engineering',      'Engineering Lead',             'Full-time', 'Trivandrum — Technopark', 'active',       140000, '2020-01-06', NULL, NULL, 1,    'Deepa Rahul',   'Spouse', 0.05, 0.01, 0.02, 0.15),
  ( 4, 'fathima.rasheed@demo.sproutbien.com','Fathima Rasheed','employee','Design',           'Senior UI/UX Designer',        'Full-time', 'Kochi — Infopark',        'active',        78000, '2021-03-15', NULL, NULL, 1,    'Abdul Rasheed', 'Father', 0.06, 0.01, 0.01, 0),
  ( 5, 'vishnu.prasad@demo.sproutbien.com','Vishnu Prasad',   'employee', 'Engineering',      'Backend Developer',            'Full-time', 'Remote',                  'active',        70000, '2022-08-01', NULL, NULL, 3,    'Prasad K',      'Father', 0.08, 0.02, 0.65, 0),
  ( 6, 'sneha.pillai@demo.sproutbien.com', 'Sneha Pillai',    'employee', 'Marketing',        'Marketing Executive',          'Full-time', 'Trivandrum — Technopark', 'active',        45000, '2024-02-12', NULL, NULL, 1,    'Gopika Pillai', 'Sister', 0.32, 0.03, 0.01, 0),
  ( 7, 'abdul.salam@demo.sproutbien.com',  'Abdul Salam',     'employee', 'Sales',            'Business Development Manager', 'Full-time', 'Kochi — Infopark',        'active',        90000, '2021-11-22', NULL, NULL, 1,    'Shabna Salam',  'Spouse', 0.12, 0.02, 0.01, 0),
  ( 8, 'divya.mohan@demo.sproutbien.com',  'Divya Mohan',     'employee', 'Customer Support', 'Support Executive',            'Full-time', 'Trivandrum — Technopark', 'active',        32000, '2024-06-03', NULL, NULL, 1,    'Mohan Das',     'Father', 0.07, 0.02, 0.01, 0),
  ( 9, 'gokul.das@demo.sproutbien.com',    'Gokul Das',       'employee', 'Engineering',      'QA Engineer',                  'Full-time', 'Remote',                  'active',        55000, '2023-01-09', NULL, NULL, 3,    'Lekha Das',     'Mother', 0.1, 0.02, 0.15, 0.3),
  (10, 'meera.varghese@demo.sproutbien.com','Meera Varghese', 'employee', 'Finance',          'Accounts Executive',           'Full-time', 'Trivandrum — Technopark', 'active',        48000, '2022-04-18', NULL, NULL, 1,    'Jacob Varghese','Father', 0.03, 0.01, 0.01, 0),
  (11, 'nikhil.joseph@demo.sproutbien.com','Nikhil Joseph',   'employee', 'Engineering',      'Frontend Intern',              'Intern',    'Trivandrum — Technopark', 'probation',     15000, NULL,         75,   NULL, 3,    'Joseph Mathew', 'Father', 0.15, 0.03, 0.01, 0),
  (12, 'lakshmi.suresh@demo.sproutbien.com','Lakshmi Suresh', 'employee', 'Design',           'Graphic Designer',             'Full-time', 'Kochi — Infopark',        'on_notice',     42000, '2023-09-04', NULL, 20,   4,    'Suresh Kumar',  'Father', 0.09, 0.02, 0.01, 0),
  (13, 'thomas.kurian@demo.sproutbien.com','Thomas Kurian',   'employee', 'Sales',            'Sales Executive',              'Full-time', 'Kochi — Infopark',        'resigned',      38000, '2022-10-10', NULL, -50,  7,    'Annie Kurian',  'Spouse', 0.12, 0.03, 0.01, 0);

-- Today's plan for the auto check-ins
CREATE TABLE IF NOT EXISTS demo_today_plan (
  employee_id  uuid PRIMARY KEY,
  day          date NOT NULL,
  check_in_at  timestamptz NOT NULL,
  break_from   timestamptz,
  break_to     timestamptz,
  check_out_at timestamptz
);
ALTER TABLE demo_today_plan ENABLE ROW LEVEL SECURITY;

-- ── Protect the two login accounts ──────────────────────────
CREATE OR REPLACE FUNCTION demo_protect_accounts()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('sb.demo_reset', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.id IN (demo_id(1), demo_id(2)) THEN
      RAISE EXCEPTION 'The demo login accounts can''t be deleted. Try it on another employee';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.id IN (demo_id(1), demo_id(2)) AND (
       NEW.status     IS DISTINCT FROM OLD.status
    OR NEW.role       IS DISTINCT FROM OLD.role
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    OR NEW.email      IS DISTINCT FROM OLD.email) THEN
    RAISE EXCEPTION 'The demo login accounts keep their status, role and email. Try it on another employee';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS demo_protect_accounts ON employees;
CREATE TRIGGER demo_protect_accounts
  BEFORE UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION demo_protect_accounts();

-- Password, email and bans of the login accounts silently stay as they are
CREATE OR REPLACE FUNCTION public.demo_protect_logins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF OLD.id IN (public.demo_id(1), public.demo_id(2))
     AND current_setting('sb.demo_reset', true) IS DISTINCT FROM 'on' THEN
    NEW.encrypted_password := OLD.encrypted_password;
    NEW.email              := OLD.email;
    NEW.banned_until       := OLD.banned_until;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS demo_protect_logins ON auth.users;
CREATE TRIGGER demo_protect_logins
  BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.demo_protect_logins();

-- ── Seed helpers ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION demo_upsert_user(p_id uuid, p_email text, p_name text, p_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
BEGIN
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
    email_change, phone_change, phone_change_token, reauthentication_token)
  VALUES (
    p_id, '00000000-0000-0000-0000-000000000000', p_email, crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name),
    'authenticated', 'authenticated', now(), now(),
    '', '', '', '', '', '', '', '')
  ON CONFLICT (id) DO UPDATE SET
    email              = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    banned_until       = NULL,
    updated_at         = now();

  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (p_id, p_id, p_email,
          jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
          'email', now(), now(), now())
  ON CONFLICT DO NOTHING;
END;
$$;

-- One leave request. Past dates are allowed (the "new request" checks are
-- skipped the same way cancel_leave_today() skips them); approval goes through
-- the real trigger, so paid / LOP split and the attendance sheet are genuine.
CREATE OR REPLACE FUNCTION demo_leave(
  p_emp        integer,
  p_start      date,
  p_days       integer,          -- working days covered (1 for a half day)
  p_type       text,
  p_status     text,             -- approved / rejected / pending / cancelled
  p_reason     text,
  p_req_before integer DEFAULT 6, -- requested this many days before the start
  p_session    text    DEFAULT NULL,
  p_reviewer   integer DEFAULT 1
)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_end date := p_start;
  v_cnt integer := 1;
  v_dur text := CASE WHEN p_session IS NULL THEN 'full' ELSE 'half' END;
  v_req timestamptz := demo_ts(least(p_start - p_req_before, demo_today() - 1), time '10:20') + demo_mins(0, 300);
  v_id  uuid;
BEGIN
  WHILE v_cnt < p_days LOOP
    v_end := v_end + 1;
    IF demo_is_working(v_end) THEN v_cnt := v_cnt + 1; END IF;
  END LOOP;

  PERFORM set_config('sb.leave_split', 'on', true);
  PERFORM set_config('sb.leave_split_from', '00000000-0000-0000-0000-000000000000', true);

  INSERT INTO leave_requests (employee_id, start_date, end_date, duration, half_day_session,
                              leave_type, reason, status, requested_at, days)
  VALUES (demo_id(p_emp), p_start, v_end, v_dur, p_session, p_type, p_reason,
          CASE WHEN p_status = 'approved' THEN 'pending' ELSE p_status END,
          v_req, leave_working_days(p_start, v_end, v_dur))
  RETURNING id INTO v_id;

  IF p_status = 'approved' THEN
    UPDATE leave_requests SET status = 'approved', reviewed_by = demo_id(p_reviewer),
           reviewed_at = v_req + demo_mins(40, 400)
     WHERE id = v_id;
  ELSIF p_status = 'rejected' THEN
    UPDATE leave_requests SET reviewed_by = demo_id(p_reviewer), reviewed_at = v_req + demo_mins(40, 400)
     WHERE id = v_id;
  END IF;

  PERFORM set_config('sb.leave_split', 'off', true);
  RETURN v_id;
END;
$$;

-- Attach a sample file to a sick leave, if it has been uploaded to Storage
CREATE OR REPLACE FUNCTION demo_attach(p_leave uuid, p_path text, p_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  o storage.objects;
BEGIN
  SELECT * INTO o FROM storage.objects WHERE bucket_id = 'leave-documents' AND name = p_path;
  IF o.id IS NULL THEN RETURN; END IF;
  INSERT INTO leave_documents (leave_id, employee_id, path, file_name, mime_type, size_bytes, uploaded_at)
  SELECT p_leave, l.employee_id, p_path, p_name,
         COALESCE(o.metadata->>'mimetype', 'application/pdf'),
         greatest(1, COALESCE((o.metadata->>'size')::integer, 1)),
         l.requested_at
  FROM leave_requests l WHERE l.id = p_leave;
END;
$$;

-- A worked day: check-in / check-out / breaks drawn from the person's habits.
-- Status (present / late / automatic half day) is set by the real trigger.
CREATE OR REPLACE FUNCTION demo_work_day(p demo_people, d date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_emp  uuid := demo_id(p.n);
  s      shifts := shift_for(v_emp, d);
  rec    attendance_records;
  v_in   time;
  v_out  time;
  v_brk  integer;
  r      numeric := random();
BEGIN
  SELECT * INTO rec FROM attendance_records WHERE employee_id = v_emp AND date = d;
  IF rec.id IS NOT NULL AND rec.half_day_session IS NULL THEN RETURN; END IF;   -- full-day leave
  IF rec.id IS NULL AND random() < p.absent_p THEN RETURN; END IF;               -- absent

  IF rec.half_day_session = 'morning' THEN
    v_in := s.split_time - demo_mins(2, 18);
  ELSIF r < 0.012 THEN
    v_in := s.half_day_after + demo_mins(5, 45);                 -- very late: automatic morning half day
  ELSIF r < p.late_p THEN
    v_in := s.late_after + demo_mins(1, 38);                     -- late
  ELSE
    v_in := s.start_time - interval '22 minutes' + demo_mins(0, 31);   -- on time
  END IF;

  IF rec.half_day_session = 'afternoon' THEN
    v_out := s.split_time;
    v_brk := 0;
  ELSE
    v_out := s.end_time + demo_mins(-5, 45);
    IF random() < p.longday_p THEN v_out := v_out + demo_mins(135, 175); END IF;
    IF rec.half_day_session IS NOT NULL OR v_in > s.half_day_after THEN
      v_brk := CASE WHEN random() < 0.5 THEN 0 ELSE 60 * (8 + floor(random() * 10))::integer END;
    ELSIF random() < p.nobreak_p THEN
      v_brk := 0;
    ELSIF random() < 0.04 THEN
      v_brk := 60 * (12 + floor(random() * 14))::integer;        -- short break: topped up to the minimum
    ELSE
      v_brk := 60 * (s.min_break_minutes + 2 + floor(random() * 22))::integer;
    END IF;
  END IF;

  INSERT INTO attendance_records (employee_id, date, check_in_time, check_out_time, break_seconds)
  VALUES (v_emp, d, demo_ts(d, v_in), demo_ts(d, v_out), v_brk)
  ON CONFLICT (employee_id, date) DO UPDATE SET
    check_in_time  = EXCLUDED.check_in_time,
    check_out_time = EXCLUDED.check_out_time,
    break_seconds  = EXCLUDED.break_seconds;
END;
$$;

-- ── Today: people check in / break / check out as the clock passes ──
CREATE OR REPLACE FUNCTION demo_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p demo_today_plan;
BEGIN
  FOR p IN SELECT * FROM demo_today_plan WHERE day = demo_today() LOOP
    IF now() >= p.check_in_at THEN
      INSERT INTO attendance_records (employee_id, date, check_in_time)
      VALUES (p.employee_id, p.day, p.check_in_at)
      ON CONFLICT (employee_id, date) DO UPDATE SET check_in_time = EXCLUDED.check_in_time
        WHERE attendance_records.check_in_time IS NULL;
    END IF;

    IF p.break_from IS NOT NULL AND now() >= p.break_from AND now() < p.break_to THEN
      UPDATE attendance_records SET break_started_at = p.break_from
       WHERE employee_id = p.employee_id AND date = p.day AND check_in_time IS NOT NULL
         AND check_out_time IS NULL AND break_started_at IS NULL AND break_seconds = 0;
    ELSIF p.break_from IS NOT NULL AND now() >= p.break_to THEN
      UPDATE attendance_records SET
        break_seconds    = extract(epoch FROM p.break_to - p.break_from)::integer,
        break_started_at = NULL
       WHERE employee_id = p.employee_id AND date = p.day AND check_in_time IS NOT NULL
         AND check_out_time IS NULL AND break_seconds = 0;
    END IF;

    IF p.check_out_at IS NOT NULL AND now() >= p.check_out_at THEN
      UPDATE attendance_records SET check_out_time = p.check_out_at, break_started_at = NULL
       WHERE employee_id = p.employee_id AND date = p.day
         AND check_in_time IS NOT NULL AND check_out_time IS NULL;
    END IF;
  END LOOP;
END;
$$;

-- ── The seed ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION demo_seed()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
  v_today  date := demo_today();
  v_start  date := (date_trunc('month', demo_today()) - interval '5 months')::date;
  p        demo_people;
  d        date;
  m        date;
  s        shifts;
  v_gen    uuid;
  v_early  uuid;
  v_eve    uuid;
  v_id     uuid;
  v_in     time;
  v_out    time;
  v_bf     time;
  rec      attendance_records;
BEGIN
  PERFORM setseed(0.2026);

  -- Holidays (Kerala / national). 2 Oct is left out on purpose so the demo
  -- has a normal working day on Gandhi Jayanti; admins can add it.
  INSERT INTO public_holidays (date, name) VALUES
    ('2026-01-26', 'Republic Day'),
    ('2026-04-03', 'Good Friday'),
    ('2026-04-14', 'Vishu / Ambedkar Jayanti'),
    ('2026-05-01', 'May Day'),
    ('2026-08-15', 'Independence Day'),
    ('2026-08-25', 'First Onam'),
    ('2026-08-26', 'Thiruvonam'),
    ('2026-12-25', 'Christmas'),
    ('2027-01-26', 'Republic Day'),
    ('2027-03-26', 'Good Friday'),
    ('2027-04-14', 'Vishu / Ambedkar Jayanti'),
    ('2027-05-01', 'May Day'),
    ('2027-08-14', 'Thiruvonam'),
    ('2027-08-16', 'Independence Day (observed)'),
    ('2027-12-25', 'Christmas')
  ON CONFLICT DO NOTHING;

  -- Leave types back to the default policy
  INSERT INTO leave_types (code, name, is_paid, yearly_quota, carry_forward_cap, sort_order) VALUES
    ('casual', 'Casual Leave', true,  12, 0,  1),
    ('sick',   'Sick Leave',   true,  12, 0,  2),
    ('earned', 'Earned Leave', true,  12, 24, 3),
    ('lop',    'Loss of Pay',  false,  0, 0,  4)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_paid = EXCLUDED.is_paid,
    yearly_quota = EXCLUDED.yearly_quota, carry_forward_cap = EXCLUDED.carry_forward_cap,
    sort_order = EXCLUDED.sort_order;

  -- Lists
  INSERT INTO employee_options (kind, name) VALUES
    ('department', 'Engineering'), ('department', 'Design'), ('department', 'Marketing'),
    ('department', 'Sales'), ('department', 'Customer Support'), ('department', 'Finance'),
    ('department', 'HR & Admin'),
    ('work_location', 'Trivandrum — Technopark'), ('work_location', 'Kochi — Infopark'),
    ('work_location', 'Remote'),
    ('employment_type', 'Full-time'), ('employment_type', 'Part-time'),
    ('employment_type', 'Intern'), ('employment_type', 'Contract')
  ON CONFLICT DO NOTHING;

  -- Shifts
  INSERT INTO shifts (name, start_time, end_time, late_after, half_day_after, split_time, is_default, min_break_minutes)
  VALUES ('General', '09:30', '17:30', '09:40', '11:30', '13:30', true, 40) RETURNING id INTO v_gen;
  INSERT INTO shifts (name, start_time, end_time, late_after, half_day_after, split_time, is_default, min_break_minutes)
  VALUES ('Early (Support)', '08:00', '16:00', '08:10', '10:00', '12:00', false, 30) RETURNING id INTO v_early;
  INSERT INTO shifts (name, start_time, end_time, late_after, half_day_after, split_time, is_default, min_break_minutes)
  VALUES ('Evening (US clients)', '12:30', '20:30', '12:40', '14:30', '16:30', false, 40) RETURNING id INTO v_eve;

  -- People
  PERFORM setval('employee_code_seq', 1, false);
  FOR p IN SELECT * FROM demo_people ORDER BY n LOOP
    PERFORM demo_upsert_user(demo_id(p.n), p.email, p.full_name, 'Demo@2026');
    INSERT INTO employees (id, full_name, email, role, department, designation, status, monthly_salary,
                           phone, joining_date, employment_type, work_location, last_working_day,
                           emergency_contact_name, emergency_contact_relation, emergency_contact_phone, created_at)
    VALUES (demo_id(p.n), p.full_name, p.email, p.role, p.department, p.designation, p.status, p.salary,
            '9198470' || lpad((10000 + p.n * 137)::text, 5, '0'),
            COALESCE(p.joined, v_today - p.joined_ago), p.emp_type, p.location,
            CASE WHEN p.lwd_off IS NOT NULL THEN v_today + p.lwd_off END,
            p.ec_name, p.ec_relation, '9194470' || lpad((20000 + p.n * 211)::text, 5, '0'),
            demo_ts(COALESCE(p.joined, v_today - p.joined_ago), time '10:00') + make_interval(mins => p.n));
  END LOOP;
  FOR p IN SELECT * FROM demo_people WHERE manager IS NOT NULL LOOP
    UPDATE employees SET reporting_manager_id = demo_id(p.manager) WHERE id = demo_id(p.n);
  END LOOP;
  UPDATE auth.users SET banned_until = 'infinity' WHERE id = demo_id(13);   -- resigned: login blocked

  INSERT INTO employee_shifts (employee_id, effective_from, shift_id, created_by) VALUES
    (demo_id(8), v_start, v_early, demo_id(1)),
    (demo_id(9), v_today + 14, v_eve, demo_id(1));   -- scheduled move, shows "starts on"

  INSERT INTO employee_hr_notes (employee_id, notes, updated_by) VALUES
    (demo_id(11), 'Probation review due at 6 months. Mentor: Rahul Krishnan. Strong on React, needs to improve on estimates.', demo_id(1)),
    (demo_id(12), 'Resigned — joining a Bengaluru studio. Handover of brand assets to Fathima in progress.', demo_id(1)),
    (demo_id(6),  'Discussed punctuality in last 1:1. Flexible start agreed on client-shoot days.', demo_id(1));

  -- ── Leave (before attendance, so approved days are already on the sheet) ──
  -- Arjun (demo employee)
  PERFORM demo_leave(2, demo_day(-125), 2, 'casual', 'approved', 'Cousin''s wedding in Thrissur', 12);
  PERFORM demo_leave(2, demo_day(-62),  3, 'earned', 'rejected', 'Trip to Munnar with college friends', 4, NULL, 3);
  v_id := demo_leave(2, demo_day(-40),  1, 'sick',   'approved', 'Fever and body ache since last night. Will be reachable on phone.', 0);
  PERFORM demo_attach(v_id, demo_id(2)::text || '/demo/medical-certificate.pdf', 'Medical certificate.pdf');
  PERFORM demo_leave(2, demo_day(-18),  1, 'casual', 'approved', 'Bank visit for home loan documents', 5, 'afternoon');
  v_id := demo_leave(2, demo_day(12),   3, 'earned', 'pending',  'Family function at our native place in Kannur', 10);
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'leave-voice-notes'
             AND name = demo_id(2)::text || '/demo-voice-note.webm') THEN
    UPDATE leave_requests SET voice_note_path = demo_id(2)::text || '/demo-voice-note.webm', voice_note_seconds = 14
     WHERE id = v_id;
  END IF;

  -- Everyone else
  PERFORM demo_leave(1,  demo_day(-100), 3, 'earned', 'approved', 'Family trip to Wayanad', 20, NULL, 3);
  PERFORM demo_leave(3,  demo_day(-78),  5, 'earned', 'approved', 'Annual family vacation to Goa', 25);
  PERFORM demo_leave(3,  demo_day(5),    1, 'casual', 'pending',  'Daughter''s school annual day', 4);
  PERFORM demo_leave(4,  demo_day(-33),  2, 'sick',   'approved', 'Migraine — doctor advised two days of rest', 0);
  v_id := demo_leave(4,  demo_day(3),    1, 'casual', 'approved', 'Passport appointment at PSK Kochi', 8);
  UPDATE leave_requests SET status = 'cancelled', cancelled_at = now() - interval '3 hours',
         cancelled_after_approval = true
   WHERE id = v_id;                                                 -- admin sees the cancellation alert
  DELETE FROM attendance_records WHERE employee_id = demo_id(4) AND date = demo_day(3) AND check_in_time IS NULL;
  PERFORM demo_leave(5,  demo_day(-11),  1, 'casual', 'approved', 'Two-wheeler service and RTO work', 3);
  v_id := demo_leave(5,  demo_day(2),    2, 'sick',   'pending',  'Wisdom tooth extraction — dentist asked for two days off', 3);
  PERFORM demo_attach(v_id, demo_id(5)::text || '/demo/dental-appointment.pdf', 'Dental appointment slip.pdf');
  PERFORM demo_leave(6,  demo_day(-26),  2, 'lop',    'approved', 'Personal reasons', 2);
  PERFORM demo_leave(6,  demo_day(-8),   1, 'casual', 'approved', 'Doctor appointment in the morning', 2, 'morning');
  PERFORM demo_leave(6,  demo_day(7),    2, 'casual', 'pending',  'Attending a friend''s wedding in Kollam', 6);
  PERFORM demo_leave(7,  demo_day(-1),   3, 'earned', 'approved', 'Visiting family in Kozhikode', 15);   -- on leave today
  PERFORM demo_leave(8,  demo_day(-57),  3, 'sick',   'approved', 'Viral fever', 0);
  PERFORM demo_leave(8,  demo_day(0),    1, 'casual', 'approved', 'Son''s school PTA meeting', 4, 'afternoon');
  PERFORM demo_leave(9,  demo_day(-92),  1, 'casual', 'approved', 'House warming at a relative''s place', 5);
  PERFORM demo_leave(9,  demo_day(-15),  1, 'casual', 'approved', 'Electricity connection work at new flat', 2);
  PERFORM demo_leave(10, demo_day(-47),  4, 'earned', 'approved', 'Sister''s wedding', 30);
  PERFORM demo_leave(10, demo_day(9),    1, 'casual', 'rejected', 'Personal work', 3);
  PERFORM demo_leave(11, demo_day(4),    1, 'casual', 'pending',  'University exam', 7, NULL, 1);
  PERFORM demo_leave(12, demo_day(-21),  1, 'casual', 'approved', 'Relocation paperwork', 3, NULL, 4);
  PERFORM demo_leave(12, demo_day(10),   4, 'earned', 'rejected', 'Short break before joining the new company', 5);
  PERFORM demo_leave(13, demo_day(-70),  1, 'casual', 'approved', 'Personal work', 2, NULL, 7);

  -- ── Attendance history ──
  FOR p IN SELECT * FROM demo_people ORDER BY n LOOP
    d := greatest(v_start, COALESCE(p.joined, v_today - p.joined_ago));
    WHILE d < v_today LOOP
      IF demo_is_working(d) AND (p.lwd_off IS NULL OR d <= v_today + p.lwd_off) THEN
        PERFORM demo_work_day(p, d);
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;

  -- ── Corrections ──
  -- Sneha forgot to check out two working days ago; Gokul's internet was down yesterday
  d := demo_day(-2);
  INSERT INTO attendance_records (employee_id, date, check_in_time, check_out_time, break_seconds)
  VALUES (demo_id(6), d, demo_ts(d, '09:34'), NULL, 2700)
  ON CONFLICT (employee_id, date) DO UPDATE SET check_out_time = NULL;
  INSERT INTO attendance_corrections (employee_id, date, requested_check_out, reason)
  VALUES (demo_id(6), d, demo_ts(d, '18:10'), 'Forgot to check out — I was on a client call until 6 PM.');

  d := demo_day(-1);
  DELETE FROM attendance_records WHERE employee_id = demo_id(9) AND date = d;
  INSERT INTO attendance_records (employee_id, date, check_in_time, check_out_time, break_seconds)
  VALUES (demo_id(9), d, demo_ts(d, '09:52'), demo_ts(d, '18:20'), 2400);
  INSERT INTO attendance_corrections (employee_id, date, requested_check_in, reason)
  VALUES (demo_id(9), d, demo_ts(d, '09:25'),
          'Home internet was down in the morning. I started at 9:25 on mobile data — see my Slack messages.');

  -- Decided ones are older than the 7-day window, so they skip the request checks
  ALTER TABLE attendance_corrections DISABLE TRIGGER on_attendance_correction_insert;
  d := demo_day(-30);
  DELETE FROM attendance_records WHERE employee_id = demo_id(2) AND date = d;
  INSERT INTO attendance_records (employee_id, date, check_in_time, check_out_time, break_seconds)
  VALUES (demo_id(2), d, demo_ts(d, '09:30'), demo_ts(d, '17:52'), 2700);
  INSERT INTO attendance_corrections (employee_id, date, requested_check_in, reason, original_check_in,
    original_check_out, status, approved_check_in, approved_check_out, admin_note, requested_at, reviewed_by, reviewed_at)
  VALUES (demo_id(2), d, demo_ts(d, '09:28'), 'App didn''t load on my phone, checked in late from the laptop.',
    demo_ts(d, '10:05'), demo_ts(d, '17:52'), 'approved', demo_ts(d, '09:30'), demo_ts(d, '17:52'),
    'Verified with Rahul.', demo_ts(d, '10:12'), demo_id(1), demo_ts(d, '15:40'));

  d := demo_day(-20);
  INSERT INTO attendance_corrections (employee_id, date, requested_check_in, reason, original_check_in,
    original_check_out, status, admin_note, requested_at, reviewed_by, reviewed_at)
  SELECT demo_id(5), d, demo_ts(d, '09:15'), 'Was working from 9:15, forgot to check in.',
         a.check_in_time, a.check_out_time, 'rejected', 'No commits or messages before 10 AM that day.',
         demo_ts(d, '19:02'), demo_id(1), demo_ts(d + 1, '10:30')
  FROM attendance_records a WHERE a.employee_id = demo_id(5) AND a.date = d AND a.check_in_time IS NOT NULL;
  ALTER TABLE attendance_corrections ENABLE TRIGGER on_attendance_correction_insert;

  -- ── Balances, payroll ──
  INSERT INTO leave_adjustments (employee_id, leave_type, leave_year, days, reason, created_by) VALUES
    (demo_id(3), 'earned', leave_year_of(v_today), 1, 'Comp-off: weekend release support', demo_id(1)),
    (demo_id(9), 'earned', leave_year_of(v_today), 1, 'Comp-off: worked on a Sunday for the go-live', demo_id(1));

  m := date_trunc('month', v_start)::date;
  WHILE m <= v_today LOOP
    INSERT INTO payroll_settings (year_month, working_days)
    SELECT to_char(m, 'YYYY-MM'), count(*)
    FROM generate_series(m, (m + interval '1 month - 1 day')::date, interval '1 day') g(x)
    WHERE demo_is_working(g.x::date)
    ON CONFLICT (year_month) DO UPDATE SET working_days = EXCLUDED.working_days;
    m := (m + interval '1 month')::date;
  END LOOP;

  -- ── Today's plan (the demo employee is left for the visitor) ──
  IF demo_is_working(v_today) THEN
    FOR p IN SELECT * FROM demo_people
             WHERE n <> 2 AND status IN ('active', 'probation', 'on_notice') ORDER BY n LOOP
      SELECT * INTO rec FROM attendance_records WHERE employee_id = demo_id(p.n) AND date = v_today;
      CONTINUE WHEN rec.id IS NOT NULL AND rec.half_day_session IS NULL;   -- on leave
      s := shift_for(demo_id(p.n), v_today);
      v_in := CASE WHEN random() < p.late_p THEN s.late_after + demo_mins(2, 30)
                   ELSE s.start_time - interval '20 minutes' + demo_mins(0, 28) END;
      IF rec.half_day_session = 'afternoon' THEN
        v_bf := NULL; v_out := NULL;                     -- auto check-out at the split
      ELSE
        v_bf  := s.split_time - interval '25 minutes' + demo_mins(0, 30);
        v_out := s.end_time + demo_mins(0, 45);
      END IF;
      INSERT INTO demo_today_plan VALUES (
        demo_id(p.n), v_today, demo_ts(v_today, v_in),
        CASE WHEN v_bf IS NOT NULL AND random() > p.nobreak_p THEN demo_ts(v_today, v_bf) END,
        CASE WHEN v_bf IS NOT NULL THEN demo_ts(v_today, v_bf) + make_interval(mins => s.min_break_minutes) + demo_mins(2, 20) END,
        CASE WHEN v_out IS NOT NULL THEN demo_ts(v_today, v_out) END);
    END LOOP;
    UPDATE demo_today_plan SET break_to = NULL WHERE break_from IS NULL;
  END IF;

  PERFORM demo_tick();
END;
$$;

-- ── Reset: wipe everything except contact messages, then seed ──
CREATE OR REPLACE FUNCTION demo_reset()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
BEGIN
  PERFORM set_config('sb.demo_reset', 'on', true);

  -- Anyone visitors added
  DELETE FROM auth.users WHERE id NOT IN (SELECT demo_id(n) FROM demo_people);

  TRUNCATE leave_documents, leave_requests, attendance_records, attendance_corrections,
           leave_adjustments, payroll_settings, public_holidays, employee_shifts, shifts,
           employee_hr_notes, employee_options, demo_today_plan, employees CASCADE;

  -- Single-row settings point at employees (updated_by / published_by), so the
  -- TRUNCATE above empties them too: put them back (selfie switched off)
  INSERT INTO attendance_settings (id) VALUES (true) ON CONFLICT (id) DO UPDATE SET selfie_required = false;
  INSERT INTO leave_policy (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

  PERFORM demo_seed();
  PERFORM set_config('sb.demo_reset', 'off', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION demo_reset(), demo_seed(), demo_tick(),
  demo_upsert_user(uuid, text, text, text), demo_leave(integer, date, integer, text, text, text, integer, text, integer),
  demo_attach(uuid, text, text), demo_work_day(demo_people, date)
  FROM PUBLIC, anon, authenticated;

-- ── Schedules ───────────────────────────────────────────────
SELECT cron.schedule('demo-reset', '15 21 * * *', $$SELECT demo_reset()$$);   -- 2:45 AM IST
SELECT cron.schedule('demo-tick',  '*/5 * * * *', $$SELECT demo_tick()$$);

-- ── First run ───────────────────────────────────────────────
SELECT demo_reset();

-- Quick check — should list 13 people with attendance days and leave counts:
-- SELECT e.employee_code, e.full_name, e.status,
--        (SELECT count(*) FROM attendance_records a WHERE a.employee_id = e.id) AS days,
--        (SELECT count(*) FROM leave_requests l WHERE l.employee_id = e.id) AS leaves
-- FROM employees e ORDER BY 1;
