-- ============================================================
-- Sproutbien DEMO project — step 1 of 2: full schema
-- Migrations 001–031 in order, unchanged. Paste into the DEMO project's
-- SQL Editor (never the production one) and run.
-- ============================================================


-- ################ 001_initial_schema.sql ################
-- ============================================================
-- Sproutbien Attendance Tracker — Initial Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employees (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text        NOT NULL,
  email       text        UNIQUE NOT NULL,
  role        text        NOT NULL DEFAULT 'employee'
                          CHECK (role IN ('employee', 'admin')),
  department  text,
  status      text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date            date        NOT NULL,
  check_in_time   timestamptz,
  check_out_time  timestamptz,
  status          text        NOT NULL DEFAULT 'absent'
                              CHECK (status IN ('present', 'absent', 'late', 'on_leave')),
  notes           text,
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date   date        NOT NULL,
  end_date     date        NOT NULL,
  reason       text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid        REFERENCES employees(id),
  reviewed_at  timestamptz
);

-- ── Enable RLS ───────────────────────────────────────────────

ALTER TABLE employees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests     ENABLE ROW LEVEL SECURITY;

-- ── Helper: is the calling user an admin? ────────────────────

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ── RLS policies: employees ──────────────────────────────────

CREATE POLICY "employees: own row or admin"
  ON employees FOR SELECT
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "employees: admin insert"
  ON employees FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "employees: own row update or admin"
  ON employees FOR UPDATE
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "employees: admin delete"
  ON employees FOR DELETE
  USING (is_admin());

-- ── RLS policies: attendance_records ─────────────────────────

CREATE POLICY "attendance: own row or admin"
  ON attendance_records FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

CREATE POLICY "attendance: own row insert or admin"
  ON attendance_records FOR INSERT
  WITH CHECK (employee_id = auth.uid() OR is_admin());

CREATE POLICY "attendance: own row update or admin"
  ON attendance_records FOR UPDATE
  USING (employee_id = auth.uid() OR is_admin());

CREATE POLICY "attendance: admin delete"
  ON attendance_records FOR DELETE
  USING (is_admin());

-- ── RLS policies: leave_requests ─────────────────────────────

CREATE POLICY "leave: own row or admin"
  ON leave_requests FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

CREATE POLICY "leave: employee insert own"
  ON leave_requests FOR INSERT
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "leave: own pending update or admin"
  ON leave_requests FOR UPDATE
  USING (
    (employee_id = auth.uid() AND status = 'pending') OR is_admin()
  );

CREATE POLICY "leave: admin delete"
  ON leave_requests FOR DELETE
  USING (is_admin());

-- ── Trigger: auto-create attendance rows on leave approval ───

CREATE OR REPLACE FUNCTION handle_leave_approval()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  d date;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    d := NEW.start_date;
    WHILE d <= NEW.end_date LOOP
      INSERT INTO attendance_records (employee_id, date, status)
      VALUES (NEW.employee_id, d, 'on_leave')
      ON CONFLICT (employee_id, date)
        DO UPDATE SET status = 'on_leave';
      d := d + INTERVAL '1 day';
    END LOOP;

    IF NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_leave_approved
  BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION handle_leave_approval();



-- ################ 002_create_employee_function.sql ################
-- ============================================================
-- Sproutbien — Admin: create employee + auth user in one call
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Requires pgcrypto (enabled by default on all Supabase projects)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION create_employee(
  p_email       text,
  p_password    text,
  p_full_name   text,
  p_role        text DEFAULT 'employee',
  p_department  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can create employees';
  END IF;

  v_user_id := gen_random_uuid();

  -- Insert into Supabase auth.users
  INSERT INTO auth.users (
    id, instance_id,
    email, encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    aud, role,
    created_at, updated_at,
    -- GoTrue can't scan NULL into these string columns ("Database error querying schema")
    confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current, email_change,
    phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    p_email,
    crypt(p_password, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    'authenticated', 'authenticated',
    NOW(), NOW(),
    '', '',
    '', '', '',
    '', '', ''
  );

  -- Insert into auth.identities (needed for email login to work)
  INSERT INTO auth.identities (
    id, user_id, provider_id,
    identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_user_id,
    v_user_id,
    p_email,
    jsonb_build_object('sub', v_user_id::text, 'email', p_email),
    'email',
    NOW(), NOW(), NOW()
  );

  -- Insert the employee profile
  INSERT INTO public.employees (id, full_name, email, role, department, status)
  VALUES (v_user_id, p_full_name, p_email, p_role, p_department, 'active');

  RETURN v_user_id;
END;
$$;



-- ################ 003_payroll.sql ################
-- ============================================================
-- Sproutbien — Payroll: salary per employee + working days
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Monthly gross salary on each employee profile
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS monthly_salary numeric(12, 2);

-- One row per calendar month stores the company working-day count
CREATE TABLE IF NOT EXISTS payroll_settings (
  year_month   text PRIMARY KEY,                          -- e.g. "2026-09"
  working_days integer NOT NULL
    CHECK (working_days > 0 AND working_days <= 31),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can read or write payroll settings
CREATE POLICY "payroll_settings: admin only"
  ON payroll_settings FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());



-- ################ 004_fix_auth_null_tokens.sql ################
-- ============================================================
-- Sproutbien — Fix "Database error querying schema" on login
-- Users inserted directly into auth.users (seed.sql / create_employee)
-- had NULL token columns, which GoTrue cannot read. Backfill them.
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

UPDATE auth.users SET
  confirmation_token         = COALESCE(confirmation_token, ''),
  recovery_token             = COALESCE(recovery_token, ''),
  email_change_token_new     = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  email_change               = COALESCE(email_change, ''),
  phone_change               = COALESCE(phone_change, ''),
  phone_change_token         = COALESCE(phone_change_token, ''),
  reauthentication_token     = COALESCE(reauthentication_token, '')
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change_token_current IS NULL
   OR email_change IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL;



-- ################ 005_public_holidays.sql ################
-- ============================================================
-- Sproutbien — Public holidays (managed by admins, visible to all)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

CREATE TABLE IF NOT EXISTS public_holidays (
  date       date        PRIMARY KEY,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;

-- Every signed-in user sees holidays on their calendar
CREATE POLICY "public_holidays: authenticated read"
  ON public_holidays FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "public_holidays: admin insert"
  ON public_holidays FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "public_holidays: admin update"
  ON public_holidays FOR UPDATE
  USING (is_admin());

CREATE POLICY "public_holidays: admin delete"
  ON public_holidays FOR DELETE
  USING (is_admin());



-- ################ 006_whatsapp_notifications.sql ################
-- ============================================================
-- Sproutbien — WhatsApp leave notifications
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Setup steps (Meta app, Edge Function, Vault secrets): docs/WHATSAPP_SETUP.md
-- ============================================================

-- Employee WhatsApp number, digits only with country code (e.g. 919876543210)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS phone text
  CHECK (phone ~ '^[1-9][0-9]{7,14}$');

-- pg_net lets the trigger call the Edge Function asynchronously
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Trigger: notify on new request / approval / rejection ────

CREATE OR REPLACE FUNCTION notify_leave_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event  text;
  v_url    text;
  v_secret text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    v_event := 'leave_submitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('approved', 'rejected') THEN
    v_event := 'leave_reviewed';
  ELSE
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'leave_whatsapp_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'leave_whatsapp_secret';

  -- Not configured yet: skip silently so leave requests keep working
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fire-and-forget; only the id is sent, the function re-reads the row itself
  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('event', v_event, 'leave_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_whatsapp ON leave_requests;

CREATE TRIGGER on_leave_whatsapp
  AFTER INSERT OR UPDATE OF status ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION notify_leave_whatsapp();



-- ################ 007_designation.sql ################
-- ============================================================
-- Sproutbien — Employee designation (job title), set by admins
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS designation text;



-- ################ 008_breaks.sql ################
-- ============================================================
-- Sproutbien — Pause/resume breaks during the work day
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- break_started_at: set while the employee is on a break, NULL otherwise
-- break_seconds:    total of all finished breaks for that day
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS break_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS break_seconds    integer NOT NULL DEFAULT 0
                                            CHECK (break_seconds >= 0);



-- ################ 009_half_day_leave.sql ################
-- ============================================================
-- Sproutbien — Half-day leave (morning / afternoon)
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   Morning half-day   9:30 AM – 1:30 PM  → check-in opens at 1:30 PM
--   Afternoon half-day 1:30 PM – 5:30 PM  → auto check-out at 1:30 PM
-- Times are Asia/Kolkata.
-- ============================================================

-- ── Leave requests: full or half day ────────────────────────

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS duration         text NOT NULL DEFAULT 'full'
                                            CHECK (duration IN ('full', 'half')),
  ADD COLUMN IF NOT EXISTS half_day_session text
                                            CHECK (half_day_session IN ('morning', 'afternoon'));

-- A half day is a single date with a session; a full day has no session
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_half_day_shape;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_half_day_shape CHECK (
  (duration = 'full' AND half_day_session IS NULL) OR
  (duration = 'half' AND half_day_session IS NOT NULL AND start_date = end_date)
);

-- ── Attendance: which half of the day is approved leave ─────

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS half_day_session text
                           CHECK (half_day_session IN ('morning', 'afternoon'));

-- ── Approval trigger: half days tag the day instead of taking all of it ──

CREATE OR REPLACE FUNCTION handle_leave_approval()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  d date;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    IF NEW.duration = 'half' THEN
      -- Keep an existing check-in's present/late status; the other half is leave
      INSERT INTO attendance_records (employee_id, date, status, half_day_session)
      VALUES (NEW.employee_id, NEW.start_date, 'on_leave', NEW.half_day_session)
      ON CONFLICT (employee_id, date) DO UPDATE SET
        half_day_session = EXCLUDED.half_day_session,
        status = CASE WHEN attendance_records.check_in_time IS NULL
                      THEN 'on_leave' ELSE attendance_records.status END;
    ELSE
      d := NEW.start_date;
      WHILE d <= NEW.end_date LOOP
        INSERT INTO attendance_records (employee_id, date, status)
        VALUES (NEW.employee_id, d, 'on_leave')
        ON CONFLICT (employee_id, date)
          DO UPDATE SET status = 'on_leave', half_day_session = NULL;
        d := d + INTERVAL '1 day';
      END LOOP;
    END IF;

    IF NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Auto check-out for afternoon half days ──────────────────
-- Closes the day at 1:30 PM (folding any running break into break_seconds),
-- even if the employee never opens the app. Returns how many rows it closed.

CREATE OR REPLACE FUNCTION auto_checkout_afternoon_half_days()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  closed integer;
BEGIN
  UPDATE attendance_records ar SET
    break_seconds = ar.break_seconds + CASE
      WHEN ar.break_started_at IS NULL THEN 0
      ELSE GREATEST(0, floor(extract(epoch FROM c.cutoff - ar.break_started_at)))::integer
    END,
    break_started_at = NULL,
    check_out_time   = c.cutoff
  FROM (
    SELECT id, ((date + time '13:30') AT TIME ZONE 'Asia/Kolkata') AS cutoff
    FROM attendance_records
    WHERE half_day_session = 'afternoon'
      AND check_in_time IS NOT NULL
      AND check_out_time IS NULL
  ) c
  WHERE ar.id = c.id
    AND now() >= c.cutoff
    AND ar.check_in_time < c.cutoff;

  GET DIAGNOSTICS closed = ROW_COUNT;
  RETURN closed;
END;
$$;

REVOKE EXECUTE ON FUNCTION auto_checkout_afternoon_half_days() FROM PUBLIC, anon, authenticated;

-- Run every 5 minutes (re-running this file updates the job instead of duplicating it)
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'half-day-auto-checkout',
  '*/5 * * * *',
  $$SELECT auto_checkout_afternoon_half_days()$$
);



-- ################ 010_cancel_leave.sql ################
-- ============================================================
-- Sproutbien — Employees can cancel leave (pending or approved)
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Cancelling is allowed until 10 minutes before the leave starts:
--   full day / morning half day → starts 9:30 AM  → cancel by 9:20 AM
--   afternoon half day          → starts 1:30 PM  → cancel by 1:20 PM
-- Times are Asia/Kolkata. Admins are told via WhatsApp and in the app.
-- ============================================================

-- ── New status + cancellation bookkeeping ───────────────────

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS cancelled_at            timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_after_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancel_seen_at          timestamptz;  -- set when an admin dismisses the in-app alert

-- ── Employees no longer update leave rows directly ──────────
-- The old policy let an employee edit their own pending request — including
-- setting status = 'approved'. Cancelling now goes through cancel_leave_request().

DROP POLICY IF EXISTS "leave: own pending update or admin" ON leave_requests;
DROP POLICY IF EXISTS "leave: admin update" ON leave_requests;
CREATE POLICY "leave: admin update"
  ON leave_requests FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── When a leave request starts ─────────────────────────────

CREATE OR REPLACE FUNCTION leave_starts_at(p_start date, p_session text)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (p_start + CASE WHEN p_session = 'afternoon' THEN time '13:30' ELSE time '09:30' END)
         AT TIME ZONE 'Asia/Kolkata'
$$;

-- ── Cancel (called by the employee from the Leave page) ─────

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
    IF r.duration = 'half' THEN
      DELETE FROM attendance_records
      WHERE employee_id = r.employee_id AND date = r.start_date
        AND check_in_time IS NULL AND status = 'on_leave';
      UPDATE attendance_records SET half_day_session = NULL
      WHERE employee_id = r.employee_id AND date = r.start_date
        AND half_day_session = r.half_day_session;
    ELSE
      DELETE FROM attendance_records
      WHERE employee_id = r.employee_id
        AND date BETWEEN r.start_date AND r.end_date
        AND check_in_time IS NULL AND status = 'on_leave';
    END IF;
  END IF;

  UPDATE leave_requests SET
    status                   = 'cancelled',
    cancelled_at             = now(),
    cancelled_after_approval = (r.status = 'approved')
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_leave_request(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION cancel_leave_request(uuid) TO authenticated;

-- ── WhatsApp: also notify admins on cancellation ────────────

CREATE OR REPLACE FUNCTION notify_leave_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event  text;
  v_url    text;
  v_secret text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    v_event := 'leave_submitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('approved', 'rejected') THEN
    v_event := 'leave_reviewed';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status = 'cancelled' THEN
    v_event := 'leave_cancelled';
  ELSE
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'leave_whatsapp_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'leave_whatsapp_secret';

  -- Not configured yet: skip silently so leave requests keep working
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fire-and-forget; only the id is sent, the function re-reads the row itself
  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('event', v_event, 'leave_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    )
  );

  RETURN NEW;
END;
$$;



-- ################ 011_employee_update_admin_only.sql ################
-- ============================================================
-- Sproutbien — Only admins can edit employee profiles
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- The old policy let every employee UPDATE their own row, i.e. any column:
-- role (self-promote to admin), monthly_salary, phone, status, ...
-- Employees never edit their own profile in the app — all edits come from
-- the admin Employees page — so updates are now admin-only.
-- ============================================================

DROP POLICY IF EXISTS "employees: own row update or admin" ON employees;
DROP POLICY IF EXISTS "employees: admin update" ON employees;

CREATE POLICY "employees: admin update"
  ON employees FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());



-- ################ 012_same_day_leave_rules.sql ################
-- ============================================================
-- Sproutbien — Limits on leave requested for today
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- For leave starting today (Asia/Kolkata):
--                        not checked in         already checked in
--   full day             until 10:30 AM         not allowed
--   morning half day     any time               not allowed
--   afternoon half day   any time               until 1:30 PM
-- Leave can't start in the past. Mirrors sameDayLeaveBlock() in src/lib/halfDay.ts.
-- ============================================================

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
BEGIN
  IF NEW.start_date < v_today THEN
    RAISE EXCEPTION 'Leave can''t start in the past';
  END IF;
  IF NEW.start_date > v_today THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM attendance_records
    WHERE employee_id = NEW.employee_id AND date = v_today AND check_in_time IS NOT NULL
  ) INTO v_checked_in;

  IF v_checked_in THEN
    IF NEW.duration = 'full' THEN
      RAISE EXCEPTION 'You''ve already checked in today, so you can''t take a full day''s leave for today';
    ELSIF NEW.half_day_session = 'morning' THEN
      RAISE EXCEPTION 'You''ve already checked in today, so you can''t take the morning off';
    ELSIF v_time > time '13:30' THEN
      RAISE EXCEPTION 'Afternoon half-day leave for today can only be requested until 1:30 PM';
    END IF;
  ELSIF NEW.duration = 'full' AND v_time > time '10:30' THEN
    RAISE EXCEPTION 'Full-day leave for today can only be requested until 10:30 AM. You can still request a half day';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_request_timing ON leave_requests;

CREATE TRIGGER on_leave_request_timing
  BEFORE INSERT ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION check_leave_request_timing();



-- ################ 013_attendance_corrections.sql ################
-- ============================================================
-- Sproutbien — Attendance correction requests
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Employees ask to fix their check-in and/or check-out time for a day in the
-- last 7 days (today included). An admin approves (optionally adjusting the
-- times) or rejects. Approval writes the times onto attendance_records and
-- re-applies the late / half-day rules. Times are Asia/Kolkata.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date                 date        NOT NULL,
  -- What the employee asks for; NULL = leave that time as it is
  requested_check_in   timestamptz,
  requested_check_out  timestamptz,
  reason               text        NOT NULL CHECK (length(trim(reason)) > 0),
  -- The record as it was when the request was made
  original_check_in    timestamptz,
  original_check_out   timestamptz,
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'approved', 'rejected')),
  -- What the admin actually applied (may differ from the request)
  approved_check_in    timestamptz,
  approved_check_out   timestamptz,
  admin_note           text,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_by          uuid        REFERENCES employees(id),
  reviewed_at          timestamptz,
  CHECK (requested_check_in IS NOT NULL OR requested_check_out IS NOT NULL)
);

-- One open request per employee per day
CREATE UNIQUE INDEX IF NOT EXISTS attendance_corrections_one_pending
  ON attendance_corrections (employee_id, date) WHERE status = 'pending';

ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corrections: own row or admin"
  ON attendance_corrections FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

CREATE POLICY "corrections: employee insert own"
  ON attendance_corrections FOR INSERT
  WITH CHECK (employee_id = auth.uid());

-- Employees can withdraw a request that hasn't been decided yet
CREATE POLICY "corrections: withdraw own pending"
  ON attendance_corrections FOR DELETE
  USING (employee_id = auth.uid() AND status = 'pending');

-- Admins reject directly; approval goes through approve_attendance_correction()
CREATE POLICY "corrections: admin update"
  ON attendance_corrections FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── Validate new requests ───────────────────────────────────

CREATE OR REPLACE FUNCTION check_attendance_correction()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_rec   attendance_records;
BEGIN
  IF NEW.date > v_today OR NEW.date < v_today - 6 THEN
    RAISE EXCEPTION 'Corrections can only be requested for the last 7 days';
  END IF;
  IF (NEW.requested_check_in  IS NOT NULL AND (NEW.requested_check_in  AT TIME ZONE 'Asia/Kolkata')::date <> NEW.date)
  OR (NEW.requested_check_out IS NOT NULL AND (NEW.requested_check_out AT TIME ZONE 'Asia/Kolkata')::date <> NEW.date) THEN
    RAISE EXCEPTION 'Corrected times must be on the day being corrected';
  END IF;
  IF NEW.requested_check_in > now() OR NEW.requested_check_out > now() THEN
    RAISE EXCEPTION 'Corrected times can''t be in the future';
  END IF;

  SELECT * INTO v_rec FROM attendance_records
  WHERE employee_id = NEW.employee_id AND date = NEW.date;

  IF COALESCE(NEW.requested_check_in, v_rec.check_in_time) IS NULL THEN
    RAISE EXCEPTION 'There''s no check-in for this day, so please include your check-in time';
  END IF;
  IF COALESCE(NEW.requested_check_out, v_rec.check_out_time) <= COALESCE(NEW.requested_check_in, v_rec.check_in_time) THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;

  -- Server decides these, whatever the client sent
  NEW.status             := 'pending';
  NEW.original_check_in  := v_rec.check_in_time;
  NEW.original_check_out := v_rec.check_out_time;
  NEW.approved_check_in  := NULL;
  NEW.approved_check_out := NULL;
  NEW.admin_note         := NULL;
  NEW.reviewed_by        := NULL;
  NEW.reviewed_at        := NULL;
  NEW.requested_at       := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_attendance_correction_insert ON attendance_corrections;
CREATE TRIGGER on_attendance_correction_insert
  BEFORE INSERT ON attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION check_attendance_correction();

-- ── Status for a check-in time (mirrors checkInFields() in useAttendance.ts) ──
--   ≤ 9:40 present · 9:41–11:30 late · after 11:30 morning half day
--   On a morning half day: present until 1:30 PM, late after.

CREATE OR REPLACE FUNCTION check_in_status(p_check_in timestamptz, p_session text, OUT status text, OUT session text)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_local   timestamp := p_check_in AT TIME ZONE 'Asia/Kolkata';
  v_minutes integer   := extract(hour FROM v_local)::integer * 60 + extract(minute FROM v_local)::integer;
BEGIN
  session := COALESCE(p_session, CASE WHEN v_minutes > 11 * 60 + 30 THEN 'morning' END);
  IF session = 'morning' THEN
    status := CASE WHEN v_minutes <= 13 * 60 + 30 THEN 'present' ELSE 'late' END;
  ELSE
    status := CASE WHEN v_minutes <= 9 * 60 + 40 THEN 'present' ELSE 'late' END;
  END IF;
END;
$$;

-- ── Approve (admin), optionally with adjusted times ─────────
-- p_check_in / p_check_out NULL = keep what's on the record.

CREATE OR REPLACE FUNCTION approve_attendance_correction(
  p_id        uuid,
  p_check_in  timestamptz,
  p_check_out timestamptz,
  p_note      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c          attendance_corrections;
  v_rec      attendance_records;
  v_in       timestamptz;
  v_out      timestamptz;
  v_leave    text;   -- session of an approved half-day leave on that date
  v_result   record;
  v_breaks   integer;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve corrections';
  END IF;

  SELECT * INTO c FROM attendance_corrections WHERE id = p_id FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'Correction request not found';
  END IF;
  IF c.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been %', c.status;
  END IF;

  SELECT * INTO v_rec FROM attendance_records
  WHERE employee_id = c.employee_id AND date = c.date FOR UPDATE;

  v_in  := COALESCE(p_check_in,  v_rec.check_in_time);
  v_out := COALESCE(p_check_out, v_rec.check_out_time);

  IF v_in IS NULL THEN
    RAISE EXCEPTION 'A check-in time is needed';
  END IF;
  IF (v_in AT TIME ZONE 'Asia/Kolkata')::date <> c.date
  OR (v_out IS NOT NULL AND (v_out AT TIME ZONE 'Asia/Kolkata')::date <> c.date) THEN
    RAISE EXCEPTION 'Times must be on the day being corrected';
  END IF;
  IF v_out IS NOT NULL AND v_out <= v_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;
  IF v_in > now() OR v_out > now() THEN
    RAISE EXCEPTION 'Times can''t be in the future';
  END IF;

  -- Re-derive late / half day from the corrected check-in. Only an approved
  -- half-day leave keeps its session; an automatic one (late check-in) is recomputed.
  SELECT half_day_session INTO v_leave FROM leave_requests
  WHERE employee_id = c.employee_id AND status = 'approved' AND duration = 'half'
    AND start_date = c.date
  LIMIT 1;
  SELECT * INTO v_result FROM check_in_status(v_in, v_leave);

  -- A break still running at check-out ends at check-out
  v_breaks := COALESCE(v_rec.break_seconds, 0);
  IF v_rec.break_started_at IS NOT NULL AND v_out IS NOT NULL THEN
    v_breaks := v_breaks + GREATEST(0, floor(extract(epoch FROM v_out - v_rec.break_started_at)))::integer;
  END IF;

  INSERT INTO attendance_records
    (employee_id, date, check_in_time, check_out_time, status, half_day_session, break_seconds, break_started_at)
  VALUES
    (c.employee_id, c.date, v_in, v_out, v_result.status, v_result.session, v_breaks,
     CASE WHEN v_out IS NULL THEN v_rec.break_started_at END)
  ON CONFLICT (employee_id, date) DO UPDATE SET
    check_in_time    = EXCLUDED.check_in_time,
    check_out_time   = EXCLUDED.check_out_time,
    status           = EXCLUDED.status,
    half_day_session = EXCLUDED.half_day_session,
    break_seconds    = EXCLUDED.break_seconds,
    break_started_at = EXCLUDED.break_started_at;

  UPDATE attendance_corrections SET
    status             = 'approved',
    approved_check_in  = v_in,
    approved_check_out = v_out,
    admin_note         = NULLIF(trim(p_note), ''),
    reviewed_by        = auth.uid(),
    reviewed_at        = now()
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION approve_attendance_correction(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION approve_attendance_correction(uuid, timestamptz, timestamptz, text) TO authenticated;



-- ################ 014_leave_types_balances.sql ################
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



-- ################ 015_no_overlapping_leave.sql ################
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



-- ################ 016_leave_balance_check.sql ################
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



-- ################ 017_leave_accrual_start.sql ################
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



-- ################ 018_employee_bin.sql ################
-- ============================================================
-- Sproutbien — Delete employees to a bin (kept 6 months)
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Deleting an employee moves them to the bin: employees.deleted_at is set,
-- status becomes 'inactive' (so every report / attendance / leave list that
-- filters on active staff drops them) and their login is blocked.
-- From the bin an admin can restore them, or delete them permanently.
-- A daily pg_cron job permanently deletes anyone binned more than 6 months ago.
--
-- Permanent delete removes the auth user; employees, attendance, leave,
-- corrections and leave adjustments cascade away with it. Rows they *reviewed*
-- as an admin are kept, with the reviewer cleared.
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── A binned admin is no longer an admin ────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
  );
$$;

-- ── Reviewer / creator links must not block a permanent delete ──
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_reviewed_by_fkey;
ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE attendance_corrections DROP CONSTRAINT IF EXISTS attendance_corrections_reviewed_by_fkey;
ALTER TABLE attendance_corrections
  ADD CONSTRAINT attendance_corrections_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE leave_adjustments DROP CONSTRAINT IF EXISTS leave_adjustments_created_by_fkey;
ALTER TABLE leave_adjustments
  ADD CONSTRAINT leave_adjustments_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;

-- ── Move to bin ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bin_employee(p_employee uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can delete employees';
  END IF;
  IF p_employee = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete your own account';
  END IF;

  UPDATE employees
     SET deleted_at = now(), status = 'inactive'
   WHERE id = p_employee AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found or already in the bin';
  END IF;

  -- Block login and sign them out everywhere
  UPDATE auth.users SET banned_until = 'infinity' WHERE id = p_employee;
  DELETE FROM auth.sessions WHERE user_id = p_employee;
END;
$$;

-- ── Restore from bin (comes back active) ────────────────────
CREATE OR REPLACE FUNCTION restore_employee(p_employee uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can restore employees';
  END IF;

  UPDATE employees
     SET deleted_at = NULL, status = 'active'
   WHERE id = p_employee AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee is not in the bin';
  END IF;

  UPDATE auth.users SET banned_until = NULL WHERE id = p_employee;
END;
$$;

-- ── Delete permanently (only from the bin) ──────────────────
CREATE OR REPLACE FUNCTION purge_employee(p_employee uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can delete employees';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_employee AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Only employees in the bin can be deleted permanently';
  END IF;

  DELETE FROM auth.users WHERE id = p_employee;   -- cascades to employees and their records
END;
$$;

-- ── Daily auto-purge of anyone binned > 6 months ago ────────
CREATE OR REPLACE FUNCTION purge_expired_binned_employees()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  purged integer;
BEGIN
  DELETE FROM auth.users
   WHERE id IN (SELECT id FROM employees WHERE deleted_at < now() - interval '6 months');
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_expired_binned_employees() FROM PUBLIC, anon, authenticated;

-- 03:00 IST every day (21:30 UTC). Re-running this file updates the job.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'purge-binned-employees',
  '30 21 * * *',
  $$SELECT purge_expired_binned_employees()$$
);



-- ################ 019_employee_profile.sql ################
-- ============================================================
-- Sproutbien — Employee management: full profile + employment status
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Adds to employees: employee ID (SB001…), profile photo, employment type,
-- work location, reporting manager, emergency contact, last working day,
-- and the full employment-status list:
--
--   active, probation, on_notice   → work normally
--   on_long_leave                   → can log in, not marked Absent
--   resigned, terminated, inactive  → login blocked, left out of
--                                     attendance / leave / payroll lists
--
-- HR notes live in their own admin-only table (employees can read their
-- own employees row, so they can't go there).
-- Department / work location / employment type come from admin-managed
-- lists (employee_options).
-- ============================================================

-- ── Employment status ───────────────────────────────────────
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_status_check
  CHECK (status IN ('active', 'probation', 'on_notice', 'on_long_leave', 'resigned', 'terminated', 'inactive'));

-- ── New profile columns ─────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employee_code              text,
  ADD COLUMN IF NOT EXISTS photo_path                 text,   -- object path in the 'avatars' bucket
  ADD COLUMN IF NOT EXISTS employment_type            text,
  ADD COLUMN IF NOT EXISTS work_location              text,
  ADD COLUMN IF NOT EXISTS reporting_manager_id       uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_working_day           date,
  ADD COLUMN IF NOT EXISTS emergency_contact_name     text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relation text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone    text;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_manager_not_self;
ALTER TABLE employees ADD CONSTRAINT employees_manager_not_self
  CHECK (reporting_manager_id IS NULL OR reporting_manager_id <> id);

-- ── Employee ID: SB001, SB002, … (editable, unique) ─────────
CREATE SEQUENCE IF NOT EXISTS employee_code_seq;

-- Backfill existing staff in the order they were added
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, full_name) AS n
  FROM employees WHERE employee_code IS NULL
)
UPDATE employees e
   SET employee_code = 'SB' || lpad((n + (SELECT count(*) FROM employees WHERE employee_code IS NOT NULL))::text, 3, '0')
  FROM numbered WHERE e.id = numbered.id;

SELECT setval('employee_code_seq', greatest((SELECT count(*) FROM employees), 1), (SELECT count(*) FROM employees) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_code_key ON employees (upper(employee_code));

CREATE OR REPLACE FUNCTION assign_employee_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
BEGIN
  NEW.employee_code := nullif(upper(trim(NEW.employee_code)), '');
  IF NEW.employee_code IS NULL THEN
    LOOP  -- skip numbers an admin has already used by hand
      v_code := 'SB' || lpad(nextval('employee_code_seq')::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM employees WHERE upper(employee_code) = v_code);
    END LOOP;
    NEW.employee_code := v_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_assign_code ON employees;
CREATE TRIGGER employees_assign_code
  BEFORE INSERT OR UPDATE OF employee_code ON employees
  FOR EACH ROW EXECUTE FUNCTION assign_employee_code();

ALTER TABLE employees ALTER COLUMN employee_code SET NOT NULL;

-- ── Admin rights need a working status ──────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
      AND status NOT IN ('resigned', 'terminated', 'inactive')
  );
$$;

-- ── Status change → block / allow login ─────────────────────
-- Resigned, terminated, inactive and binned employees can't log in.
CREATE OR REPLACE FUNCTION sync_employee_login()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_blocked boolean := NEW.deleted_at IS NOT NULL OR NEW.status IN ('resigned', 'terminated', 'inactive');
BEGIN
  -- An admin locking themselves out (or dropping their own admin role) could leave nobody in charge
  IF NEW.id = auth.uid() AND (v_blocked OR (OLD.role = 'admin' AND NEW.role <> 'admin')) THEN
    RAISE EXCEPTION 'You cannot change your own status or role. Ask another admin';
  END IF;

  IF v_blocked THEN
    UPDATE auth.users SET banned_until = 'infinity' WHERE id = NEW.id;
    DELETE FROM auth.sessions WHERE user_id = NEW.id;
  ELSE
    UPDATE auth.users SET banned_until = NULL WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_sync_login ON employees;
CREATE TRIGGER employees_sync_login
  AFTER UPDATE OF status, deleted_at, role ON employees
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
     OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
     OR OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION sync_employee_login();

-- Employees deactivated before this migration could still log in — block them now
UPDATE auth.users SET banned_until = 'infinity'
 WHERE id IN (SELECT id FROM employees WHERE status = 'inactive');

-- ── Notice period ends → Resigned (daily, 00:05 IST) ────────
CREATE OR REPLACE FUNCTION close_ended_notice_periods()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE employees SET status = 'resigned'
   WHERE status = 'on_notice'
     AND last_working_day < (now() AT TIME ZONE 'Asia/Kolkata')::date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_ended_notice_periods() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('close-notice-periods', '35 18 * * *', $$SELECT close_ended_notice_periods()$$);

-- ── HR notes (admin only) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_hr_notes (
  employee_id uuid        PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  notes       text        NOT NULL DEFAULT '',
  updated_by  uuid        REFERENCES employees(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_hr_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr_notes: admin all" ON employee_hr_notes;
CREATE POLICY "hr_notes: admin all"
  ON employee_hr_notes FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── Admin-managed lists ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_options (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text        NOT NULL CHECK (kind IN ('department', 'work_location', 'employment_type')),
  name       text        NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, name)
);

ALTER TABLE employee_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_options: everyone reads" ON employee_options;
CREATE POLICY "employee_options: everyone reads"
  ON employee_options FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "employee_options: admin write" ON employee_options;
CREATE POLICY "employee_options: admin write"
  ON employee_options FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

INSERT INTO employee_options (kind, name) VALUES
  ('employment_type', 'Full-time'),
  ('employment_type', 'Part-time'),
  ('employment_type', 'Intern'),
  ('employment_type', 'Contract')
ON CONFLICT DO NOTHING;

-- Departments already typed in become the starting list
INSERT INTO employee_options (kind, name)
SELECT DISTINCT 'department', trim(department) FROM employees WHERE nullif(trim(department), '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Renaming an option renames it on every employee that uses it
CREATE OR REPLACE FUNCTION rename_employee_option(p_id uuid, p_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old employee_options;
  v_new text := trim(p_name);
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can edit lists';
  END IF;
  SELECT * INTO v_old FROM employee_options WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Option not found'; END IF;

  UPDATE employee_options SET name = v_new WHERE id = p_id;
  IF v_old.kind = 'department' THEN
    UPDATE employees SET department = v_new WHERE department = v_old.name;
  ELSIF v_old.kind = 'work_location' THEN
    UPDATE employees SET work_location = v_new WHERE work_location = v_old.name;
  ELSE
    UPDATE employees SET employment_type = v_new WHERE employment_type = v_old.name;
  END IF;
END;
$$;

-- ── Profile photos ──────────────────────────────────────────
-- Public bucket (photos show in the app without signed URLs); files sit
-- under <employee id>/…, and only that employee or an admin can write there.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars: own folder or admin insert" ON storage.objects;
CREATE POLICY "avatars: own folder or admin insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "avatars: own folder or admin update" ON storage.objects;
CREATE POLICY "avatars: own folder or admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "avatars: own folder or admin delete" ON storage.objects;
CREATE POLICY "avatars: own folder or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- Employees can't update their own employees row, so they set their photo through this
CREATE OR REPLACE FUNCTION set_employee_photo(p_employee uuid, p_path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_employee <> auth.uid() AND NOT is_admin() THEN
    RAISE EXCEPTION 'You can only change your own photo';
  END IF;
  IF p_path IS NOT NULL AND split_part(p_path, '/', 1) <> p_employee::text THEN
    RAISE EXCEPTION 'Invalid photo path';
  END IF;
  UPDATE employees SET photo_path = p_path WHERE id = p_employee;
END;
$$;



-- ################ 020_shifts.sql ################
-- ============================================================
-- Sproutbien — Shifts drive the attendance rules
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Each shift has (all Asia/Kolkata, same day — no overnight shifts):
--   start_time      work starts; full-day leave for today can be requested until start + 1 hour
--   late_after      checking in after this is Late
--   half_day_after  checking in after this makes the morning a half-day leave
--   split_time      where the morning and afternoon halves meet: morning-leave check-in
--                   opens, afternoon-leave auto check-out, and on a morning half day
--                   checking in after this is Late
--   end_time        work ends
--
-- The "General" shift (9:30–5:30, late after 9:40, half day after 11:30, split
-- 1:30) is the default and matches the old fixed rules, so nothing changes for
-- anyone until they're given another shift.
--
-- Shift changes are dated (employee_shifts.effective_from): past days keep the
-- shift they were worked under. Employees with no row are on the default shift.
--
-- Check-in status (present / late / automatic morning half day) is now set by
-- the server (attendance_records trigger), not the browser.
-- ============================================================

-- ── Shifts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  start_time     time        NOT NULL,
  end_time       time        NOT NULL,
  late_after     time        NOT NULL,
  half_day_after time        NOT NULL,
  split_time     time        NOT NULL,
  is_default     boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shifts_times_in_order CHECK (
    start_time <= late_after
    AND late_after <= half_day_after
    AND half_day_after <= split_time
    AND start_time < split_time
    AND split_time < end_time
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_default ON shifts (is_default) WHERE is_default;

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shifts: everyone reads" ON shifts;
CREATE POLICY "shifts: everyone reads" ON shifts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "shifts: admin write" ON shifts;
CREATE POLICY "shifts: admin write" ON shifts FOR ALL USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO shifts (name, start_time, end_time, late_after, half_day_after, split_time, is_default)
SELECT 'General', '09:30', '17:30', '09:40', '11:30', '13:30', true
WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE is_default);

-- The default shift can't be deleted (everyone without a shift is on it)
CREATE OR REPLACE FUNCTION protect_default_shift()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_default THEN
    RAISE EXCEPTION 'The default shift can''t be deleted. Make another shift the default first';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS shifts_protect_default ON shifts;
CREATE TRIGGER shifts_protect_default BEFORE DELETE ON shifts
  FOR EACH ROW EXECUTE FUNCTION protect_default_shift();

CREATE OR REPLACE FUNCTION set_default_shift(p_shift uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can change shifts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shifts WHERE id = p_shift) THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;
  UPDATE shifts SET is_default = false WHERE is_default AND id <> p_shift;
  UPDATE shifts SET is_default = true WHERE id = p_shift;
END;
$$;

-- ── Who works which shift, from when ────────────────────────
CREATE TABLE IF NOT EXISTS employee_shifts (
  employee_id    uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from date        NOT NULL,
  shift_id       uuid        NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  created_by     uuid        REFERENCES employees(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, effective_from)
);

ALTER TABLE employee_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_shifts: own or admin read" ON employee_shifts;
CREATE POLICY "employee_shifts: own or admin read" ON employee_shifts FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "employee_shifts: admin write" ON employee_shifts;
CREATE POLICY "employee_shifts: admin write" ON employee_shifts FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- Move someone to a shift from a date. Later scheduled changes are dropped,
-- so the newest decision wins.
CREATE OR REPLACE FUNCTION set_employee_shift(p_employee uuid, p_shift uuid, p_from date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: only admins can change shifts';
  END IF;
  IF p_from < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'A shift change can''t start in the past';
  END IF;

  DELETE FROM employee_shifts WHERE employee_id = p_employee AND effective_from > p_from;
  INSERT INTO employee_shifts (employee_id, effective_from, shift_id, created_by)
  VALUES (p_employee, p_from, p_shift, auth.uid())
  ON CONFLICT (employee_id, effective_from)
    DO UPDATE SET shift_id = EXCLUDED.shift_id, created_by = EXCLUDED.created_by, created_at = now();
END;
$$;

-- The shift an employee works on a date (default shift when none assigned)
CREATE OR REPLACE FUNCTION shift_for(p_employee uuid, p_date date)
RETURNS shifts
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s shifts;
BEGIN
  IF auth.uid() IS NOT NULL AND p_employee <> auth.uid() AND NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  SELECT * INTO s FROM shifts WHERE id = (
    SELECT shift_id FROM employee_shifts
     WHERE employee_id = p_employee AND effective_from <= p_date
     ORDER BY effective_from DESC LIMIT 1
  );
  IF s.id IS NULL THEN
    SELECT * INTO s FROM shifts WHERE is_default;
  END IF;
  RETURN s;
END;
$$;

-- "9:30 AM"
CREATE OR REPLACE FUNCTION fmt_clock(t time)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(date '2000-01-01' + t, 'FMHH12:MI AM') $$;  -- to_char has no time variant

-- ── Check-in status from the shift ──────────────────────────
--   ≤ late_after present · after it late · after half_day_after automatic morning half day
--   On a morning half day: present until split_time, late after.

DROP FUNCTION IF EXISTS check_in_status(timestamptz, text);

CREATE OR REPLACE FUNCTION check_in_status(p_employee uuid, p_check_in timestamptz, p_session text, OUT status text, OUT session text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local timestamp := p_check_in AT TIME ZONE 'Asia/Kolkata';
  v_time  time      := date_trunc('minute', v_local)::time;   -- 9:40:59 still counts as 9:40
  s       shifts    := shift_for(p_employee, v_local::date);
BEGIN
  session := COALESCE(p_session, CASE WHEN v_time > s.half_day_after THEN 'morning' END);
  IF session = 'morning' THEN
    status := CASE WHEN v_time <= s.split_time THEN 'present' ELSE 'late' END;
  ELSE
    status := CASE WHEN v_time <= s.late_after THEN 'present' ELSE 'late' END;
  END IF;
END;
$$;

-- Server sets status whenever a day gets its first check-in
CREATE OR REPLACE FUNCTION set_check_in_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.check_in_time IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.check_in_time IS NULL) THEN
    SELECT * INTO r FROM check_in_status(NEW.employee_id, NEW.check_in_time, NEW.half_day_session);
    NEW.status := r.status;
    NEW.half_day_session := r.session;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_set_check_in_status ON attendance_records;
CREATE TRIGGER attendance_set_check_in_status
  BEFORE INSERT OR UPDATE OF check_in_time ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION set_check_in_status();

-- ── Correction approval uses the shift too ──────────────────
CREATE OR REPLACE FUNCTION approve_attendance_correction(
  p_id        uuid,
  p_check_in  timestamptz,
  p_check_out timestamptz,
  p_note      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c          attendance_corrections;
  v_rec      attendance_records;
  v_in       timestamptz;
  v_out      timestamptz;
  v_leave    text;   -- session of an approved half-day leave on that date
  v_result   record;
  v_breaks   integer;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve corrections';
  END IF;

  SELECT * INTO c FROM attendance_corrections WHERE id = p_id FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'Correction request not found';
  END IF;
  IF c.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been %', c.status;
  END IF;

  SELECT * INTO v_rec FROM attendance_records
  WHERE employee_id = c.employee_id AND date = c.date FOR UPDATE;

  v_in  := COALESCE(p_check_in,  v_rec.check_in_time);
  v_out := COALESCE(p_check_out, v_rec.check_out_time);

  IF v_in IS NULL THEN
    RAISE EXCEPTION 'A check-in time is needed';
  END IF;
  IF (v_in AT TIME ZONE 'Asia/Kolkata')::date <> c.date
  OR (v_out IS NOT NULL AND (v_out AT TIME ZONE 'Asia/Kolkata')::date <> c.date) THEN
    RAISE EXCEPTION 'Times must be on the day being corrected';
  END IF;
  IF v_out IS NOT NULL AND v_out <= v_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;
  IF v_in > now() OR v_out > now() THEN
    RAISE EXCEPTION 'Times can''t be in the future';
  END IF;

  -- Re-derive late / half day from the corrected check-in. Only an approved
  -- half-day leave keeps its session; an automatic one (late check-in) is recomputed.
  SELECT half_day_session INTO v_leave FROM leave_requests
  WHERE employee_id = c.employee_id AND status = 'approved' AND duration = 'half'
    AND start_date = c.date
  LIMIT 1;
  SELECT * INTO v_result FROM check_in_status(c.employee_id, v_in, v_leave);

  -- A break still running at check-out ends at check-out
  v_breaks := COALESCE(v_rec.break_seconds, 0);
  IF v_rec.break_started_at IS NOT NULL AND v_out IS NOT NULL THEN
    v_breaks := v_breaks + GREATEST(0, floor(extract(epoch FROM v_out - v_rec.break_started_at)))::integer;
  END IF;

  INSERT INTO attendance_records
    (employee_id, date, check_in_time, check_out_time, status, half_day_session, break_seconds, break_started_at)
  VALUES
    (c.employee_id, c.date, v_in, v_out, v_result.status, v_result.session, v_breaks,
     CASE WHEN v_out IS NULL THEN v_rec.break_started_at END)
  ON CONFLICT (employee_id, date) DO UPDATE SET
    check_in_time    = EXCLUDED.check_in_time,
    check_out_time   = EXCLUDED.check_out_time,
    status           = EXCLUDED.status,
    half_day_session = EXCLUDED.half_day_session,
    break_seconds    = EXCLUDED.break_seconds,
    break_started_at = EXCLUDED.break_started_at;

  UPDATE attendance_corrections SET
    status             = 'approved',
    approved_check_in  = v_in,
    approved_check_out = v_out,
    admin_note         = NULLIF(trim(p_note), ''),
    reviewed_by        = auth.uid(),
    reviewed_at        = now()
  WHERE id = p_id;
END;
$$;

-- ── Afternoon half days: auto check-out at the shift's split ─
CREATE OR REPLACE FUNCTION auto_checkout_afternoon_half_days()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  closed integer;
BEGIN
  UPDATE attendance_records ar SET
    break_seconds = ar.break_seconds + CASE
      WHEN ar.break_started_at IS NULL THEN 0
      ELSE GREATEST(0, floor(extract(epoch FROM c.cutoff - ar.break_started_at)))::integer
    END,
    break_started_at = NULL,
    check_out_time   = c.cutoff
  FROM (
    SELECT id, ((date + (shift_for(employee_id, date)).split_time) AT TIME ZONE 'Asia/Kolkata') AS cutoff
    FROM attendance_records
    WHERE half_day_session = 'afternoon'
      AND check_in_time IS NOT NULL
      AND check_out_time IS NULL
  ) c
  WHERE ar.id = c.id
    AND now() >= c.cutoff
    AND ar.check_in_time < c.cutoff;

  GET DIAGNOSTICS closed = ROW_COUNT;
  RETURN closed;
END;
$$;

REVOKE EXECUTE ON FUNCTION auto_checkout_afternoon_half_days() FROM PUBLIC, anon, authenticated;

-- ── When a leave starts: shift start, or the split for an afternoon half ──
CREATE OR REPLACE FUNCTION leave_starts_at(p_employee uuid, p_start date, p_session text)
RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s shifts := shift_for(p_employee, p_start);
BEGIN
  RETURN (p_start + CASE WHEN p_session = 'afternoon' THEN s.split_time ELSE s.start_time END)
         AT TIME ZONE 'Asia/Kolkata';
END;
$$;

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
  IF now() >= leave_starts_at(r.employee_id, r.start_date, r.half_day_session) - interval '10 minutes' THEN
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

DROP FUNCTION IF EXISTS leave_starts_at(date, text);

-- ── Same-day leave limits from the shift ────────────────────
--                        not checked in            already checked in
--   full day             until start + 1 hour      not allowed
--   morning half day     any time                  not allowed
--   afternoon half day   any time                  until split_time
-- Mirrors sameDayLeaveBlock() in src/lib/shifts.ts.
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
  s            shifts;
  v_full_until time;
BEGIN
  IF NEW.start_date < v_today THEN
    RAISE EXCEPTION 'Leave can''t start in the past';
  END IF;
  IF NEW.start_date > v_today THEN
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

-- Signed-in users only (the WhatsApp function and cron run as service role / postgres)
REVOKE EXECUTE ON FUNCTION shift_for(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION shift_for(uuid, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION check_in_status(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION check_in_status(uuid, timestamptz, text) TO authenticated, service_role;



-- ################ 021_leave_voice_notes.sql ################
-- 021: Optional voice note on leave requests
--
--   • Employees can record up to 2 minutes of audio when requesting leave.
--   • A written reason OR a voice note is required (either is enough).
--   • Recordings live in the private 'leave-voice-notes' bucket under <employee id>/…
--     Employees can hear their own; admins can hear everyone's. Kept forever.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS voice_note_path    text,       -- object path in the 'leave-voice-notes' bucket
  ADD COLUMN IF NOT EXISTS voice_note_seconds smallint;

-- The recording must sit in the requester's own folder
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_voice_note_owner;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_voice_note_owner
  CHECK (voice_note_path IS NULL OR voice_note_path LIKE employee_id::text || '/%');

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_voice_note_length;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_voice_note_length
  CHECK (voice_note_seconds IS NULL OR voice_note_seconds BETWEEN 0 AND 125);

-- Written reason or voice note (NOT VALID: older rows aren't re-checked)
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_reason_or_voice;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_reason_or_voice
  CHECK (length(trim(reason)) > 0 OR voice_note_path IS NOT NULL) NOT VALID;

-- ── Storage ────────────────────────────────────────────────
-- Private bucket; 5 MB covers 2 minutes in every browser's format (Safari's AAC is the largest)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('leave-voice-notes', 'leave-voice-notes', false, 5242880,
        ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "leave-voice-notes: own folder insert" ON storage.objects;
CREATE POLICY "leave-voice-notes: own folder insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'leave-voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "leave-voice-notes: own folder or admin read" ON storage.objects;
CREATE POLICY "leave-voice-notes: own folder or admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'leave-voice-notes' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- Only lets the app clean up an upload whose leave request then failed to save;
-- once a request points at the recording, the employee can't remove it
DROP POLICY IF EXISTS "leave-voice-notes: unattached own delete" ON storage.objects;
CREATE POLICY "leave-voice-notes: unattached own delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'leave-voice-notes'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT EXISTS (SELECT 1 FROM public.leave_requests lr WHERE lr.voice_note_path = storage.objects.name)
  );



-- ################ 022_leave_split_with_lop.sql ################
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



-- ################ 023_shift_min_break.sql ################
-- ============================================================
-- Sproutbien — Minimum break per shift
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Each shift has a minimum break (minutes). On a full working day, worked
-- hours are reduced by whichever is larger: the breaks the employee actually
-- paused for, or this minimum. So not pausing the timer gains nothing.
--   • Full days only — half days (half_day_session set) aren't affected.
--   • Only once the day is checked out, and only when the day lasted at least
--     half the shift (someone who left after 2 hours didn't take lunch).
-- Worked hours are worked out in the app, so nothing else changes here;
-- payroll is by days and isn't affected.
-- ============================================================

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS min_break_minutes smallint NOT NULL DEFAULT 40
    CHECK (min_break_minutes BETWEEN 0 AND 240);



-- ################ 024_cancel_todays_leave.sql ################
-- ============================================================
-- Sproutbien — No check-in on a leave day; cancel today's leave instead
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Employees can't check in on a day covered by their own pending or
--     approved FULL-day leave (half days keep their existing rules).
--     Admin-approved attendance corrections are not affected.
--   • cancel_leave_today(id, mode) lets them cancel today's part of such a
--     leave at any time that day, as long as they haven't checked in
--     (the usual "10 minutes before it starts" rule still applies to leave
--     on later days):
--       mode 'today'  → only today; days before and after stay as leave
--       mode 'onward' → today to the end of the leave; earlier days stay
--     A multi-day leave is split into separate requests. The cancelled part
--     shows up for the admin like any other cancellation; paid days that are
--     freed go back to the balance (approved leave keeps paid days on its
--     earliest remaining dates).
-- ============================================================

-- ── Splitting a leave must not re-run the "new request" checks ──
-- The pieces of a split leave were already checked (and maybe approved) as a
-- whole, so these insert triggers are skipped while cancel_leave_today()
-- writes them (transaction-local setting).

DROP TRIGGER IF EXISTS on_leave_request_timing ON leave_requests;
CREATE TRIGGER on_leave_request_timing
  BEFORE INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION check_leave_request_timing();

DROP TRIGGER IF EXISTS on_leave_request_days ON leave_requests;
CREATE TRIGGER on_leave_request_days
  BEFORE INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION set_leave_request_days();

DROP TRIGGER IF EXISTS on_leave_overlap ON leave_requests;
CREATE TRIGGER on_leave_overlap
  BEFORE INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION check_leave_overlap();

DROP TRIGGER IF EXISTS on_leave_balance ON leave_requests;
CREATE TRIGGER on_leave_balance
  BEFORE INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION check_leave_balance();

-- No "new leave request" WhatsApp for the pieces (the cancellation still notifies)
DROP TRIGGER IF EXISTS on_leave_whatsapp ON leave_requests;
CREATE TRIGGER on_leave_whatsapp
  AFTER INSERT OR UPDATE OF status ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION notify_leave_whatsapp();

-- ── Cancel today's part of a full-day leave ─────────────────

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
    v_before := leave_working_days(r.start_date, v_today - 1, 'full');
  END IF;
  IF v_cut_end < r.end_date THEN
    v_after := leave_working_days(v_cut_end + 1, r.end_date, 'full');
  END IF;
  v_cut := leave_working_days(v_today, v_cut_end, 'full');

  -- Paid days stay on the earliest remaining dates
  v_paid := CASE WHEN r.status = 'approved' THEN r.paid_days ELSE r.planned_paid_days END;
  IF v_paid IS NOT NULL THEN
    v_paid_b := least(v_paid, v_before);
    v_paid_a := least(v_paid - v_paid_b, v_after);
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

REVOKE EXECUTE ON FUNCTION cancel_leave_today(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION cancel_leave_today(uuid, text) TO authenticated;

-- ── No check-in on your own full-day leave ──────────────────
-- Only when the employee checks themselves in; an admin approving an
-- attendance correction (auth.uid() = the admin) isn't blocked.

CREATE OR REPLACE FUNCTION block_check_in_on_leave()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.check_in_time IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.check_in_time IS NULL)
     AND auth.uid() = NEW.employee_id
     AND EXISTS (
       SELECT 1 FROM leave_requests l
       WHERE l.employee_id = NEW.employee_id
         AND l.status IN ('pending', 'approved')
         AND l.duration = 'full'
         AND NEW.date BETWEEN l.start_date AND l.end_date)
  THEN
    RAISE EXCEPTION 'You have leave today. Cancel today''s leave on the Leaves page before checking in.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_block_check_in_on_leave ON attendance_records;
CREATE TRIGGER attendance_block_check_in_on_leave
  BEFORE INSERT OR UPDATE OF check_in_time ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION block_check_in_on_leave();



-- ################ 025_sick_leave_documents.sql ################
-- ============================================================
-- Sproutbien — Documents on sick leave
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Sick leave (including Sick + Loss of Pay splits) can have up to 5
--     documents: PDF, PNG, JPEG, Word (.doc/.docx), 10 MB each. Optional.
--   • Employees add them while applying or later, up to 30 days after the
--     request was made, on pending or approved leave. Within those 30 days
--     they can also remove their own uploads. They can always view them.
--   • Admins can view, add and remove documents on any sick leave, any time.
--   • Files live in the private 'leave-documents' bucket under
--     <employee id>/<leave id>/…
--   • When cancel_leave_today() splits a leave, the kept parts keep the documents.
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_documents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_id    uuid        NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  employee_id uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  path        text        NOT NULL,     -- object in the 'leave-documents' bucket
  file_name   text        NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  mime_type   text        NOT NULL,
  size_bytes  integer     NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  uploaded_by uuid        REFERENCES employees(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_documents_own_folder CHECK (path LIKE employee_id::text || '/%')
);

CREATE INDEX IF NOT EXISTS leave_documents_leave_idx ON leave_documents (leave_id);

ALTER TABLE leave_documents ENABLE ROW LEVEL SECURITY;

-- Employee can still add/remove documents on this leave
CREATE OR REPLACE FUNCTION leave_documents_open(p_leave uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM leave_requests l
    WHERE l.id = p_leave
      AND l.employee_id = auth.uid()
      AND l.leave_type = 'sick'
      AND l.status IN ('pending', 'approved')
      AND now() <= l.requested_at + interval '30 days');
$$;

DROP POLICY IF EXISTS "leave_documents: own or admin read" ON leave_documents;
CREATE POLICY "leave_documents: own or admin read" ON leave_documents FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "leave_documents: own (open window) or admin insert" ON leave_documents;
CREATE POLICY "leave_documents: own (open window) or admin insert" ON leave_documents FOR INSERT
  WITH CHECK (is_admin() OR (employee_id = auth.uid() AND leave_documents_open(leave_id)));

DROP POLICY IF EXISTS "leave_documents: own upload (open window) or admin delete" ON leave_documents;
CREATE POLICY "leave_documents: own upload (open window) or admin delete" ON leave_documents FOR DELETE
  USING (is_admin() OR (employee_id = auth.uid() AND uploaded_by = auth.uid() AND leave_documents_open(leave_id)));

-- Sick leave only, 5 per leave, owner and uploader set by the server
CREATE OR REPLACE FUNCTION check_leave_document()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r leave_requests;
BEGIN
  SELECT * INTO r FROM leave_requests WHERE id = NEW.leave_id;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;
  IF r.leave_type <> 'sick' THEN
    RAISE EXCEPTION 'Documents can only be added to sick leave';
  END IF;
  NEW.employee_id := r.employee_id;
  NEW.uploaded_by := auth.uid();
  IF (SELECT count(*) FROM leave_documents WHERE leave_id = NEW.leave_id) >= 5 THEN
    RAISE EXCEPTION 'A leave can have at most 5 documents';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_document ON leave_documents;
CREATE TRIGGER on_leave_document
  BEFORE INSERT ON leave_documents
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION check_leave_document();

-- ── Storage ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('leave-documents', 'leave-documents', false, 10485760, ARRAY[
  'application/pdf', 'image/png', 'image/jpeg', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "leave-documents: own folder or admin insert" ON storage.objects;
CREATE POLICY "leave-documents: own folder or admin insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'leave-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "leave-documents: own folder or admin read" ON storage.objects;
CREATE POLICY "leave-documents: own folder or admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'leave-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- Files are removed after their row: employees only once nothing points at them
DROP POLICY IF EXISTS "leave-documents: unattached own or admin delete" ON storage.objects;
CREATE POLICY "leave-documents: unattached own or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'leave-documents'
    AND (public.is_admin() OR (
      (storage.foldername(name))[1] = auth.uid()::text
      AND NOT EXISTS (SELECT 1 FROM public.leave_documents d WHERE d.path = storage.objects.name))));

-- ── A split leave's kept parts keep its documents ───────────
CREATE OR REPLACE FUNCTION copy_split_leave_documents()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO leave_documents (leave_id, employee_id, path, file_name, mime_type, size_bytes, uploaded_by, uploaded_at)
  SELECT NEW.id, d.employee_id, d.path, d.file_name, d.mime_type, d.size_bytes, d.uploaded_by, d.uploaded_at
  FROM leave_documents d
  WHERE d.leave_id = current_setting('sb.leave_split_from', true)::uuid;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_split_documents ON leave_requests;
CREATE TRIGGER on_leave_split_documents
  AFTER INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) = 'on')
  EXECUTE FUNCTION copy_split_leave_documents();

-- Same as migration 024, plus recording which leave is being split
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
    v_before := leave_working_days(r.start_date, v_today - 1, 'full');
  END IF;
  IF v_cut_end < r.end_date THEN
    v_after := leave_working_days(v_cut_end + 1, r.end_date, 'full');
  END IF;
  v_cut := leave_working_days(v_today, v_cut_end, 'full');

  -- Paid days stay on the earliest remaining dates
  v_paid := CASE WHEN r.status = 'approved' THEN r.paid_days ELSE r.planned_paid_days END;
  IF v_paid IS NOT NULL THEN
    v_paid_b := least(v_paid, v_before);
    v_paid_a := least(v_paid - v_paid_b, v_after);
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



-- ################ 026_monthly_leave_caps.sql ################
-- ============================================================
-- Sproutbien — Monthly limits on Casual / Earned leave
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- For months with many public holidays an admin can limit how many paid
-- Casual + Earned days each employee takes in that month (e.g. Oct 2026: 2).
--   • Counted by the days that fall in the month (a leave from 30 Oct to
--     4 Nov uses October's limit for 30–31 Oct only). Half days are 0.5.
--   • Paid days of a leave are its earliest dates (as before), so a leave
--     stops being paid at the first day over a limit; the rest is Loss of Pay.
--   • Days over the limit become Loss of Pay automatically — no refusal and no
--     "use what's left" consent needed (that's still asked for a short balance).
--   • A new request counts the employee's approved and pending leave in the
--     month; approval counts approved leave only (first approved, first paid),
--     the same way the balance works.
--   • Sick Leave and Loss of Pay are never limited.
--   • Leave approved before a limit was set keeps its paid days.
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_month_caps (
  month      date          PRIMARY KEY CHECK (extract(day FROM month) = 1),   -- first of the month
  max_days   numeric(4, 1) NOT NULL CHECK (max_days >= 0 AND max_days * 2 = floor(max_days * 2)),
  note       text,
  created_at timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE leave_month_caps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_month_caps: everyone reads"
  ON leave_month_caps FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "leave_month_caps: admin insert"
  ON leave_month_caps FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "leave_month_caps: admin update"
  ON leave_month_caps FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "leave_month_caps: admin delete"
  ON leave_month_caps FOR DELETE USING (is_admin());

-- Leave types the monthly limits apply to
CREATE OR REPLACE FUNCTION leave_type_month_capped(p_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_type IN ('casual', 'earned')
$$;

-- Paid days of a leave that fall in p_month, when its p_paid days are its earliest working dates
CREATE OR REPLACE FUNCTION leave_paid_in_month(p_start date, p_end date, p_duration text, p_paid numeric, p_month date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH w AS (
    SELECT g.d::date AS d, row_number() OVER (ORDER BY g.d) AS n,
           CASE WHEN p_duration = 'half' THEN 0.5 ELSE 1 END AS portion
    FROM generate_series(p_start, p_end, interval '1 day') AS g(d)
    WHERE extract(dow FROM g.d) <> 0
      AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.date = g.d::date)
  )
  SELECT COALESCE(sum(least(portion, greatest(0, COALESCE(p_paid, 0) - (n - 1) * portion))), 0)
  FROM w
  WHERE date_trunc('month', d)::date = p_month
$$;

-- Paid Casual + Earned days an employee has in a month: approved leave, plus
-- pending leave (its planned paid part) when p_with_pending. p_exclude = the request being checked.
CREATE OR REPLACE FUNCTION leave_month_capped_used(p_employee uuid, p_month date, p_exclude uuid, p_with_pending boolean)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(leave_paid_in_month(r.start_date, r.end_date, r.duration,
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

-- Most paid days a leave can have under the monthly limits (ignoring the balance):
-- walks its working dates in order and stops at the first one over a limit.
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
    RETURN leave_working_days(p_start, p_end, p_duration);
  END IF;

  FOR d IN
    SELECT g.d::date FROM generate_series(p_start, p_end, interval '1 day') AS g(d)
    WHERE extract(dow FROM g.d) <> 0
      AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.date = g.d::date)
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

-- ── Employee: what the limits mean for a leave they're about to request ──
-- { "cap_paid": 2, "months": [{ "month": "2026-10-01", "max_days": 2, "used": 0.5, "note": "Diwali" }] }
-- cap_paid = paid days the limits allow (the balance is checked separately).

CREATE OR REPLACE FUNCTION leave_cap_preview(p_start date, p_end date, p_duration text, p_type text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN jsonb_build_object(
    'cap_paid', leave_cap_paid(auth.uid(), p_type, p_start, p_end, p_duration, NULL, true),
    'months', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'month', c.month, 'max_days', c.max_days, 'note', c.note,
               'used', leave_month_capped_used(auth.uid(), c.month, NULL, true))
             ORDER BY c.month)
      FROM leave_month_caps c
      WHERE c.month BETWEEN date_trunc('month', p_start)::date AND p_end), '[]'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION leave_cap_preview(date, date, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION leave_cap_preview(date, date, text, text) TO authenticated;

-- ── Paid days a request would get if approved now ───────────
-- Balance as of the leave's start (this request not counted), then the monthly limits.

CREATE OR REPLACE FUNCTION leave_paid_on_approval(r leave_requests)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_days      numeric := COALESCE(r.days, leave_working_days(r.start_date, r.end_date, r.duration));
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

-- Admin: preview for a pending request, so the queue can show the Loss of Pay part
-- { "paid": 1, "cap_paid": 1 }  (cap_paid < days → a monthly limit applies)
CREATE OR REPLACE FUNCTION leave_approval_preview(p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r leave_requests;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO r FROM leave_requests WHERE id = p_request;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'paid', leave_paid_on_approval(r),
    'cap_paid', leave_cap_paid(r.employee_id, r.leave_type, r.start_date, r.end_date, r.duration, r.id, false));
END;
$$;

REVOKE EXECUTE ON FUNCTION leave_approval_preview(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION leave_approval_preview(uuid) TO authenticated;

-- ── New requests: same as migration 022, plus the monthly limits ──

CREATE OR REPLACE FUNCTION check_leave_balance()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type   leave_types;
  v_bal    record;
  v_days   numeric := leave_working_days(NEW.start_date, NEW.end_date, NEW.duration);
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

-- ── Approval: same as migration 014, with paid days from leave_paid_on_approval() ──

CREATE OR REPLACE FUNCTION handle_leave_approval()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    NEW.days      := COALESCE(NEW.days, leave_working_days(NEW.start_date, NEW.end_date, NEW.duration));
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

-- ── Cancel today's part: same as migration 025, except paid days freed by the
-- cancelled part move to later days only as far as the monthly limits allow ──

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
    v_before := leave_working_days(r.start_date, v_today - 1, 'full');
  END IF;
  IF v_cut_end < r.end_date THEN
    v_after := leave_working_days(v_cut_end + 1, r.end_date, 'full');
  END IF;
  v_cut := leave_working_days(v_today, v_cut_end, 'full');

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


-- ################ 027_choice_holidays.sql ################
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


-- ################ 028_fix_choice_holiday_save.sql ################
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


-- ################ 029_onboarding.sql ################
-- ============================================================
-- Sproutbien — Onboarding: checklist, employee documents, probation
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Checklist template (admin-managed): tasks for the admin or the new
--     employee. A task can ask for a document of a category; it's done when
--     one is uploaded. Starting onboarding copies the template to that employee;
--     admins can add or remove tasks per person afterwards.
--   • Employees tick their own tasks (not document tasks — those tick themselves);
--     admins tick anything.
--   • Employee documents (offer letter, ID proof, PAN, bank proof, certificates,
--     other): private 'employee-documents' bucket under <employee id>/…, PDF /
--     PNG / JPEG / Word, 10 MB each. Employees upload and view their own; only
--     admins remove them (they're HR records).
--   • Probation end date, and confirm_probation() → Active, noted in HR notes.
--   • Before their joining date, employees can log in (to finish onboarding)
--     but can't check in.
-- ============================================================

-- ── Probation ───────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end_date date;

-- ── Document categories ─────────────────────────────────────
CREATE OR REPLACE FUNCTION employee_document_category_ok(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p IN ('Offer letter', 'ID proof', 'PAN card', 'Bank proof', 'Certificates', 'Other')
$$;

-- ── Checklist template ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_template (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text        NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  details           text        CHECK (details IS NULL OR length(details) <= 500),
  assignee          text        NOT NULL CHECK (assignee IN ('admin', 'employee')),
  document_category text        CHECK (document_category IS NULL OR employee_document_category_ok(document_category)),
  sort_order        integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_template ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "onboarding_template: admin all" ON onboarding_template;
CREATE POLICY "onboarding_template: admin all" ON onboarding_template FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO onboarding_template (title, details, assignee, document_category, sort_order)
SELECT * FROM (VALUES
  ('Upload your ID proof', 'Aadhaar card or passport.', 'employee', 'ID proof', 1),
  ('Upload your PAN card', NULL, 'employee', 'PAN card', 2),
  ('Upload bank proof', 'A cancelled cheque or the first page of your passbook, for salary.', 'employee', 'Bank proof', 3),
  ('Upload your educational certificates', NULL, 'employee', 'Certificates', 4),
  ('Share your emergency contact with HR', 'Name, relationship and phone number.', 'employee', NULL, 5),
  ('Read the leave policy', 'Casual, Sick and Earned leave are credited monthly; ask HR if anything is unclear.', 'employee', NULL, 6),
  ('Upload the signed offer letter', NULL, 'admin', 'Offer letter', 10),
  ('Set up email and work accounts', NULL, 'admin', NULL, 11),
  ('Hand over laptop and equipment', NULL, 'admin', NULL, 12),
  ('Add to the team WhatsApp group', NULL, 'admin', NULL, 13),
  ('Set shift and reporting manager', NULL, 'admin', NULL, 14)
) AS t(title, details, assignee, document_category, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM onboarding_template);

-- ── Each employee's checklist ───────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title             text        NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  details           text        CHECK (details IS NULL OR length(details) <= 500),
  assignee          text        NOT NULL CHECK (assignee IN ('admin', 'employee')),
  document_category text        CHECK (document_category IS NULL OR employee_document_category_ok(document_category)),
  sort_order        integer     NOT NULL DEFAULT 0,
  done_at           timestamptz,
  done_by           uuid        REFERENCES employees(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_tasks_employee_idx ON onboarding_tasks (employee_id);

ALTER TABLE onboarding_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "onboarding_tasks: own or admin read" ON onboarding_tasks;
CREATE POLICY "onboarding_tasks: own or admin read" ON onboarding_tasks FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());
DROP POLICY IF EXISTS "onboarding_tasks: admin insert" ON onboarding_tasks;
CREATE POLICY "onboarding_tasks: admin insert" ON onboarding_tasks FOR INSERT WITH CHECK (is_admin());
DROP POLICY IF EXISTS "onboarding_tasks: admin update" ON onboarding_tasks;
CREATE POLICY "onboarding_tasks: admin update" ON onboarding_tasks FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS "onboarding_tasks: admin delete" ON onboarding_tasks;
CREATE POLICY "onboarding_tasks: admin delete" ON onboarding_tasks FOR DELETE USING (is_admin());

-- ── Employee documents ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_documents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category    text        NOT NULL CHECK (employee_document_category_ok(category)),
  path        text        NOT NULL,     -- object in the 'employee-documents' bucket
  file_name   text        NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  mime_type   text        NOT NULL,
  size_bytes  integer     NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  uploaded_by uuid        REFERENCES employees(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_documents_own_folder CHECK (path LIKE employee_id::text || '/%')
);
CREATE INDEX IF NOT EXISTS employee_documents_employee_idx ON employee_documents (employee_id);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employee_documents: own or admin read" ON employee_documents;
CREATE POLICY "employee_documents: own or admin read" ON employee_documents FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());
DROP POLICY IF EXISTS "employee_documents: own or admin insert" ON employee_documents;
CREATE POLICY "employee_documents: own or admin insert" ON employee_documents FOR INSERT
  WITH CHECK (employee_id = auth.uid() OR is_admin());
DROP POLICY IF EXISTS "employee_documents: admin delete" ON employee_documents;
CREATE POLICY "employee_documents: admin delete" ON employee_documents FOR DELETE USING (is_admin());

-- Uploader set by the server; at most 50 per employee
CREATE OR REPLACE FUNCTION check_employee_document()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.uploaded_by := auth.uid();
  IF (SELECT count(*) FROM employee_documents WHERE employee_id = NEW.employee_id) >= 50 THEN
    RAISE EXCEPTION 'An employee can have at most 50 documents. Remove some first.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_employee_document ON employee_documents;
CREATE TRIGGER on_employee_document
  BEFORE INSERT ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION check_employee_document();

-- A document ticks off the open checklist task asking for that category
CREATE OR REPLACE FUNCTION tick_document_task()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE onboarding_tasks SET done_at = now(), done_by = auth.uid()
  WHERE employee_id = NEW.employee_id
    AND document_category = NEW.category
    AND done_at IS NULL;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_employee_document_tick ON employee_documents;
CREATE TRIGGER on_employee_document_tick
  AFTER INSERT ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION tick_document_task();

-- ── Storage ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('employee-documents', 'employee-documents', false, 10485760, ARRAY[
  'application/pdf', 'image/png', 'image/jpeg', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "employee-documents: own folder or admin insert" ON storage.objects;
CREATE POLICY "employee-documents: own folder or admin insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "employee-documents: own folder or admin read" ON storage.objects;
CREATE POLICY "employee-documents: own folder or admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'employee-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- Admins remove files; employees only clean up an upload whose record failed to save
DROP POLICY IF EXISTS "employee-documents: unattached own or admin delete" ON storage.objects;
CREATE POLICY "employee-documents: unattached own or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'employee-documents'
    AND (public.is_admin() OR (
      (storage.foldername(name))[1] = auth.uid()::text
      AND NOT EXISTS (SELECT 1 FROM public.employee_documents d WHERE d.path = storage.objects.name))));

-- ── Start onboarding: copy the template to an employee ──────
-- Does nothing if they already have a checklist. Document tasks already
-- covered by an uploaded document start ticked.
CREATE OR REPLACE FUNCTION start_onboarding(p_employee uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM onboarding_tasks WHERE employee_id = p_employee) THEN RETURN 0; END IF;

  INSERT INTO onboarding_tasks (employee_id, title, details, assignee, document_category, sort_order, done_at, done_by)
  SELECT p_employee, t.title, t.details, t.assignee, t.document_category, t.sort_order,
         CASE WHEN d.id IS NOT NULL THEN now() END,
         CASE WHEN d.id IS NOT NULL THEN auth.uid() END
  FROM onboarding_template t
  LEFT JOIN LATERAL (SELECT id FROM employee_documents
                     WHERE employee_id = p_employee AND category = t.document_category LIMIT 1) d ON true
  ORDER BY t.sort_order, t.created_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION start_onboarding(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION start_onboarding(uuid) TO authenticated;

-- ── Tick / untick a task ────────────────────────────────────
-- Employees: their own tasks that aren't document tasks. Admins: any task.
CREATE OR REPLACE FUNCTION set_onboarding_task_done(p_task uuid, p_done boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t onboarding_tasks;
BEGIN
  SELECT * INTO t FROM onboarding_tasks WHERE id = p_task;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF NOT is_admin() THEN
    IF t.employee_id IS DISTINCT FROM auth.uid() OR t.assignee <> 'employee' THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
    IF t.document_category IS NOT NULL THEN
      RAISE EXCEPTION 'Upload the document to complete this step.';
    END IF;
  END IF;
  UPDATE onboarding_tasks SET
    done_at = CASE WHEN p_done THEN COALESCE(done_at, now()) END,
    done_by = CASE WHEN p_done THEN COALESCE(done_by, auth.uid()) END
  WHERE id = p_task;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_onboarding_task_done(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_onboarding_task_done(uuid, boolean) TO authenticated;

-- ── Confirm probation → Active, noted in HR notes ───────────
CREATE OR REPLACE FUNCTION confirm_probation(p_employee uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e    employees;
  me   text;
  line text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO e FROM employees WHERE id = p_employee;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF e.status <> 'probation' THEN RAISE EXCEPTION '% isn''t on probation.', e.full_name; END IF;

  UPDATE employees SET status = 'active' WHERE id = p_employee;

  SELECT full_name INTO me FROM employees WHERE id = auth.uid();
  line := 'Probation confirmed on ' || to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'FMDD Mon YYYY')
          || COALESCE(' by ' || me, '') || '.';
  INSERT INTO employee_hr_notes (employee_id, notes, updated_by, updated_at)
  VALUES (p_employee, line, auth.uid(), now())
  ON CONFLICT (employee_id) DO UPDATE SET
    notes      = CASE WHEN employee_hr_notes.notes = '' THEN line ELSE employee_hr_notes.notes || E'\n' || line END,
    updated_by = auth.uid(),
    updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION confirm_probation(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION confirm_probation(uuid) TO authenticated;

-- ── No check-in before the joining date ─────────────────────
-- Only when the employee checks themselves in; admin-approved corrections aren't affected.
CREATE OR REPLACE FUNCTION block_check_in_before_joining()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_join date;
BEGIN
  IF NEW.check_in_time IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.check_in_time IS NULL)
     AND auth.uid() = NEW.employee_id THEN
    SELECT joining_date INTO v_join FROM employees WHERE id = NEW.employee_id;
    IF v_join IS NOT NULL AND NEW.date < v_join THEN
      RAISE EXCEPTION 'Check-in opens on your joining date, %.', to_char(v_join, 'FMDD Mon YYYY');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_block_check_in_before_joining ON attendance_records;
CREATE TRIGGER attendance_block_check_in_before_joining
  BEFORE INSERT OR UPDATE OF check_in_time ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION block_check_in_before_joining();


-- ################ 030_hiring.sql ################
-- ============================================================
-- Sproutbien — Hiring: a simple candidates list
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Candidates: name, role applied for, contact, where they came from,
--     notes, an optional résumé, and a stage:
--       applied → interview → offer → hired / not selected
--   • Hire (in the app) adds them as an employee with the usual form,
--     starts their onboarding checklist, copies the résumé to their
--     documents and links the candidate to the new employee.
--   • Admins only. Résumés live in the private 'candidate-resumes' bucket.
-- ============================================================

CREATE TABLE IF NOT EXISTS candidates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        text        NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 120),
  role             text        CHECK (role IS NULL OR length(role) <= 120),        -- position applied for
  email            text        CHECK (email IS NULL OR length(email) <= 200),
  phone            text        CHECK (phone IS NULL OR length(phone) <= 40),
  source           text        CHECK (source IS NULL OR length(source) <= 80),     -- e.g. Referral, LinkedIn
  notes            text        NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
  stage            text        NOT NULL DEFAULT 'applied'
                               CHECK (stage IN ('applied', 'interview', 'offer', 'hired', 'not_selected')),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  resume_path      text,                                                            -- object in 'candidate-resumes'
  resume_name      text        CHECK (resume_name IS NULL OR length(resume_name) <= 200),
  resume_type      text,
  resume_size      integer     CHECK (resume_size IS NULL OR resume_size BETWEEN 1 AND 10485760),
  employee_id      uuid        REFERENCES employees(id) ON DELETE SET NULL,          -- set when hired
  created_by       uuid        REFERENCES employees(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS candidates_stage_idx ON candidates (stage);

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "candidates: admin all" ON candidates;
CREATE POLICY "candidates: admin all" ON candidates FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Stage changes are timestamped (for "in Interview for 6 days")
CREATE OR REPLACE FUNCTION touch_candidate_stage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_candidate_stage ON candidates;
CREATE TRIGGER on_candidate_stage
  BEFORE UPDATE OF stage ON candidates
  FOR EACH ROW EXECUTE FUNCTION touch_candidate_stage();

-- ── Résumés: private, admins only ───────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('candidate-resumes', 'candidate-resumes', false, 10485760, ARRAY[
  'application/pdf', 'image/png', 'image/jpeg', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "candidate-resumes: admin insert" ON storage.objects;
CREATE POLICY "candidate-resumes: admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'candidate-resumes' AND public.is_admin());
DROP POLICY IF EXISTS "candidate-resumes: admin read" ON storage.objects;
CREATE POLICY "candidate-resumes: admin read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'candidate-resumes' AND public.is_admin());
DROP POLICY IF EXISTS "candidate-resumes: admin delete" ON storage.objects;
CREATE POLICY "candidate-resumes: admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'candidate-resumes' AND public.is_admin());


-- ################ 031_leave_policy.sql ################
-- ============================================================
-- Sproutbien — Leave policy page and acknowledgements
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • The policy page is built in the app from the live settings (leave
--     types, holidays, monthly limits, shift times). Admins add anything
--     else as "Additional rules" (leave_policy, one row).
--   • version = how many times the policy was published to everyone
--     (0 = never). Publishing asks every employee to read it and press
--     "I've read it"; leave_policy_acks records who did, per version.
--   • The onboarding step "Read the leave policy" is now done by
--     acknowledging the policy (action = 'leave_policy'), not ticked by hand.
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_policy (
  id               boolean     PRIMARY KEY DEFAULT true CHECK (id),   -- a single row
  additional_rules text        NOT NULL DEFAULT '' CHECK (length(additional_rules) <= 5000),
  version          integer     NOT NULL DEFAULT 0 CHECK (version >= 0),
  published_at     timestamptz,
  published_by     uuid        REFERENCES employees(id) ON DELETE SET NULL
);
INSERT INTO leave_policy (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE leave_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_policy: everyone reads" ON leave_policy;
CREATE POLICY "leave_policy: everyone reads" ON leave_policy FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "leave_policy: admin update" ON leave_policy;
CREATE POLICY "leave_policy: admin update" ON leave_policy FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

CREATE TABLE IF NOT EXISTS leave_policy_acks (
  employee_id     uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  version         integer     NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, version)
);

ALTER TABLE leave_policy_acks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_policy_acks: own or admin read" ON leave_policy_acks;
CREATE POLICY "leave_policy_acks: own or admin read" ON leave_policy_acks FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

-- ── Onboarding steps done by an action in the app ───────────
ALTER TABLE onboarding_template ADD COLUMN IF NOT EXISTS action text CHECK (action IS NULL OR action IN ('leave_policy'));
ALTER TABLE onboarding_tasks    ADD COLUMN IF NOT EXISTS action text CHECK (action IS NULL OR action IN ('leave_policy'));

UPDATE onboarding_template SET action = 'leave_policy', details = 'Open it from here and press “I’ve read it” at the end.'
 WHERE title = 'Read the leave policy' AND assignee = 'employee';
UPDATE onboarding_tasks SET action = 'leave_policy', details = 'Open it from here and press “I’ve read it” at the end.'
 WHERE title = 'Read the leave policy' AND assignee = 'employee';

-- ── Employee: "I've read it" ────────────────────────────────
CREATE OR REPLACE FUNCTION acknowledge_leave_policy()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO leave_policy_acks (employee_id, version)
  SELECT auth.uid(), version FROM leave_policy WHERE id
  ON CONFLICT (employee_id, version) DO NOTHING;
  UPDATE onboarding_tasks SET done_at = now(), done_by = auth.uid()
  WHERE employee_id = auth.uid() AND action = 'leave_policy' AND done_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION acknowledge_leave_policy() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION acknowledge_leave_policy() TO authenticated;

-- ── Admin: save the additional rules, optionally asking everyone to read it again ──
CREATE OR REPLACE FUNCTION save_leave_policy(p_rules text, p_publish boolean)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v integer;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE leave_policy SET
    additional_rules = COALESCE(p_rules, ''),
    version          = CASE WHEN p_publish THEN version + 1 ELSE version END,
    published_at     = CASE WHEN p_publish THEN now() ELSE published_at END,
    published_by     = CASE WHEN p_publish THEN auth.uid() ELSE published_by END
  WHERE id
  RETURNING version INTO v;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION save_leave_policy(text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION save_leave_policy(text, boolean) TO authenticated;

-- ── Same as migration 029, carrying the action across; a policy already
-- acknowledged ticks its step ──
CREATE OR REPLACE FUNCTION start_onboarding(p_employee uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM onboarding_tasks WHERE employee_id = p_employee) THEN RETURN 0; END IF;

  INSERT INTO onboarding_tasks (employee_id, title, details, assignee, document_category, action, sort_order, done_at, done_by)
  SELECT p_employee, t.title, t.details, t.assignee, t.document_category, t.action, t.sort_order,
         CASE WHEN d.id IS NOT NULL OR a.version IS NOT NULL THEN now() END,
         CASE WHEN d.id IS NOT NULL OR a.version IS NOT NULL THEN auth.uid() END
  FROM onboarding_template t
  LEFT JOIN LATERAL (SELECT id FROM employee_documents
                     WHERE employee_id = p_employee AND category = t.document_category LIMIT 1) d ON true
  LEFT JOIN LATERAL (SELECT k.version FROM leave_policy_acks k JOIN leave_policy p ON p.id
                     WHERE t.action = 'leave_policy' AND k.employee_id = p_employee AND k.version = p.version) a ON true
  ORDER BY t.sort_order, t.created_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Same as migration 029, plus: employees can't tick an action step by hand
CREATE OR REPLACE FUNCTION set_onboarding_task_done(p_task uuid, p_done boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t onboarding_tasks;
BEGIN
  SELECT * INTO t FROM onboarding_tasks WHERE id = p_task;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF NOT is_admin() THEN
    IF t.employee_id IS DISTINCT FROM auth.uid() OR t.assignee <> 'employee' THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
    IF t.document_category IS NOT NULL THEN
      RAISE EXCEPTION 'Upload the document to complete this step.';
    END IF;
    IF t.action = 'leave_policy' THEN
      RAISE EXCEPTION 'Open the leave policy and press “I’ve read it” to complete this step.';
    END IF;
  END IF;
  UPDATE onboarding_tasks SET
    done_at = CASE WHEN p_done THEN COALESCE(done_at, now()) END,
    done_by = CASE WHEN p_done THEN COALESCE(done_by, auth.uid()) END
  WHERE id = p_task;
END;
$$;


-- ################ 032_checkin_selfie.sql ################
-- ============================================================
-- Sproutbien — Selfie at check-in
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Admin switches it on for everyone (attendance_settings.selfie_required)
--     and can override per person (employees.selfie_rule: default/always/never).
--   • When it applies, the employee takes a selfie with the camera to check in.
--     If the camera doesn't work they can still check in; the day is flagged
--     "No selfie" with the reason (selfie_missing_reason) for the admin.
--   • Selfies live in the private 'checkin-selfies' bucket under <employee id>/…
--     The employee and admins can see them. They're deleted after 15 days:
--     the app removes expired files through the Storage API whenever an admin
--     or the employee opens it (SQL can't delete Storage files).
--   • Only check-in. Admin edits, corrections and server jobs aren't affected.
-- ============================================================

-- ── Company setting (one row) ──────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_settings (
  id              boolean     PRIMARY KEY DEFAULT true CHECK (id),   -- a single row
  selfie_required boolean     NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        REFERENCES employees(id) ON DELETE SET NULL
);
INSERT INTO attendance_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE attendance_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_settings: everyone reads" ON attendance_settings;
CREATE POLICY "attendance_settings: everyone reads" ON attendance_settings FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "attendance_settings: admin update" ON attendance_settings;
CREATE POLICY "attendance_settings: admin update" ON attendance_settings FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- ── Per-person override ────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS selfie_rule text NOT NULL DEFAULT 'default';
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_selfie_rule;
ALTER TABLE employees ADD CONSTRAINT employees_selfie_rule CHECK (selfie_rule IN ('default', 'always', 'never'));

-- ── On the attendance record ───────────────────────────────
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS selfie_path           text,   -- object path in 'checkin-selfies'
  ADD COLUMN IF NOT EXISTS selfie_missing_reason text;   -- set = checked in without the required selfie

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_selfie_owner;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_selfie_owner
  CHECK (selfie_path IS NULL OR selfie_path LIKE employee_id::text || '/%');

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_selfie_reason_length;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_selfie_reason_length
  CHECK (selfie_missing_reason IS NULL OR length(selfie_missing_reason) <= 300);

-- A selfie belongs to one check-in
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_selfie_path_key
  ON attendance_records (selfie_path) WHERE selfie_path IS NOT NULL;

-- ── Does this person need a selfie to check in? ────────────
CREATE OR REPLACE FUNCTION selfie_required(p_employee uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE e.selfie_rule
           WHEN 'always' THEN true
           WHEN 'never'  THEN false
           ELSE COALESCE((SELECT s.selfie_required FROM attendance_settings s WHERE s.id), false)
         END
  FROM employees e
  WHERE e.id = p_employee AND (p_employee = auth.uid() OR is_admin() OR auth.uid() IS NULL);
$$;

REVOKE EXECUTE ON FUNCTION selfie_required(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION selfie_required(uuid) TO authenticated;

-- ── Enforced on the employee's own check-in ────────────────
CREATE OR REPLACE FUNCTION attendance_check_in_selfie()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checking_in boolean := NEW.check_in_time IS NOT NULL
                           AND (TG_OP = 'INSERT' OR OLD.check_in_time IS NULL);
BEGIN
  -- Admin entries, approved corrections and server jobs are left alone
  IF auth.uid() IS NULL OR auth.uid() <> NEW.employee_id THEN RETURN NEW; END IF;

  IF v_checking_in THEN
    NEW.selfie_missing_reason := NULLIF(trim(NEW.selfie_missing_reason), '');
    IF NEW.selfie_path IS NOT NULL THEN
      -- Must be a photo just uploaded, not an older one reused
      IF NOT EXISTS (SELECT 1 FROM storage.objects o
                     WHERE o.bucket_id = 'checkin-selfies' AND o.name = NEW.selfie_path
                       AND o.created_at > now() - interval '15 minutes') THEN
        RAISE EXCEPTION 'The selfie didn''t upload. Please take it again.';
      END IF;
      NEW.selfie_missing_reason := NULL;
    ELSIF selfie_required(NEW.employee_id) THEN
      IF NEW.selfie_missing_reason IS NULL THEN
        RAISE EXCEPTION 'A selfie is needed to check in.';
      END IF;
    ELSE
      NEW.selfie_missing_reason := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Otherwise employees can't add or change the selfie fields
  IF TG_OP = 'INSERT' THEN
    NEW.selfie_path := NULL;
    NEW.selfie_missing_reason := NULL;
  ELSIF NOT is_admin()
    AND (NEW.selfie_path IS DISTINCT FROM OLD.selfie_path
         OR NEW.selfie_missing_reason IS DISTINCT FROM OLD.selfie_missing_reason) THEN
    RAISE EXCEPTION 'The check-in selfie can''t be changed.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_check_in_selfie ON attendance_records;
CREATE TRIGGER attendance_check_in_selfie
  BEFORE INSERT OR UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION attendance_check_in_selfie();

-- ── Storage ────────────────────────────────────────────────
-- Private; the app saves a small JPEG (about 50–100 KB)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('checkin-selfies', 'checkin-selfies', false, 1048576, ARRAY['image/jpeg', 'image/webp', 'image/png'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "checkin-selfies: own folder insert" ON storage.objects;
CREATE POLICY "checkin-selfies: own folder insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'checkin-selfies' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "checkin-selfies: own folder or admin read" ON storage.objects;
CREATE POLICY "checkin-selfies: own folder or admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'checkin-selfies' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- Admins: any. Employees: an upload whose check-in then failed, or their own expired selfies.
DROP POLICY IF EXISTS "checkin-selfies: expired, unattached own or admin delete" ON storage.objects;
CREATE POLICY "checkin-selfies: expired, unattached own or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'checkin-selfies'
    AND (public.is_admin()
         OR ((storage.foldername(name))[1] = auth.uid()::text
             AND (created_at < now() - interval '15 days'
                  OR NOT EXISTS (SELECT 1 FROM public.attendance_records r WHERE r.selfie_path = storage.objects.name))))
  );

-- Files past 15 days, for the app to remove (admins: everyone's; employees: their own)
CREATE OR REPLACE FUNCTION expired_checkin_selfies()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.name FROM storage.objects o
  WHERE o.bucket_id = 'checkin-selfies'
    AND o.created_at < now() - interval '15 days'
    AND (is_admin() OR (storage.foldername(o.name))[1] = auth.uid()::text)
  ORDER BY o.created_at
  LIMIT 500;
$$;

REVOKE EXECUTE ON FUNCTION expired_checkin_selfies() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION expired_checkin_selfies() TO authenticated;


-- ################ 033_first_login_password.sql ################
-- ============================================================
-- Sproutbien — Change the temporary password at first login
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • An account an admin creates starts with must_change_password = true;
--     the app then shows only a "choose your own password" screen.
--   • The flag clears itself when the password in auth.users actually changes
--     (this screen, or a "forgot password" reset), so it can't be skipped by
--     calling the API directly.
--   • Accounts that have never been logged in to are flagged now too.
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Created by someone else (an admin through create_employee) → flag it.
-- Server jobs and the SQL editor (no signed-in user) leave it off.
CREATE OR REPLACE FUNCTION employees_flag_temporary_password()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.id <> auth.uid() THEN
    NEW.must_change_password := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_flag_temporary_password ON employees;
CREATE TRIGGER employees_flag_temporary_password
  BEFORE INSERT ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_flag_temporary_password();

-- Only the server may clear it: employees can't update their own row (migration 011),
-- and admins shouldn't switch it off by accident
CREATE OR REPLACE FUNCTION employees_keep_password_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
     AND current_setting('sb.password_changed', true) IS DISTINCT FROM 'on' THEN
    NEW.must_change_password := OLD.must_change_password;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_keep_password_flag ON employees;
CREATE TRIGGER employees_keep_password_flag
  BEFORE UPDATE OF must_change_password ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_keep_password_flag();

-- The password itself changed → done
CREATE OR REPLACE FUNCTION public.clear_temporary_password_flag()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    PERFORM set_config('sb.password_changed', 'on', true);
    UPDATE public.employees SET must_change_password = false
    WHERE id = NEW.id AND must_change_password;
    PERFORM set_config('sb.password_changed', 'off', true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_temporary_password_flag ON auth.users;
CREATE TRIGGER clear_temporary_password_flag
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.clear_temporary_password_flag();

-- Accounts nobody has logged in to yet still have the admin's password
UPDATE employees e SET must_change_password = true
FROM auth.users u
WHERE u.id = e.id AND u.last_sign_in_at IS NULL AND e.deleted_at IS NULL;


-- ################ 034_admin_reset_password.sql ################
-- ============================================================
-- Sproutbien — Admin: reset an employee's password
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Sets a new temporary password the admin shares, signs the person out
--     of their devices (no new sessions from old logins; an open tab stops
--     working within the hour), and asks them to choose their own password
--     at the next login (must_change_password, migration 033).
--   • Not for your own account: use "Forgot password" for that.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_reset_password(p_employee uuid, p_password text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_old text;
  v_new text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_employee = auth.uid() THEN
    RAISE EXCEPTION 'To change your own password, use “Forgot password” on the login page.';
  END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'The temporary password must be at least 8 characters.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT encrypted_password INTO v_old FROM auth.users WHERE id = p_employee;
  IF NOT FOUND THEN RAISE EXCEPTION 'This employee has no login account.'; END IF;

  UPDATE auth.users
     SET encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
   WHERE id = p_employee
  RETURNING encrypted_password INTO v_new;

  -- Something kept the old password (e.g. a protected demo login): change nothing
  IF v_new IS NOT DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'This account''s password can''t be changed.';
  END IF;

  -- Sign out everywhere: no device can renew its login
  DELETE FROM auth.sessions WHERE user_id = p_employee;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_employee::text;

  -- The password change above cleared the flag (migration 033); this one is temporary again
  PERFORM set_config('sb.password_changed', 'on', true);
  UPDATE public.employees SET must_change_password = true WHERE id = p_employee;
  PERFORM set_config('sb.password_changed', 'off', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_reset_password(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION admin_reset_password(uuid, text) TO authenticated;


-- ################ 035_branding.sql ################
-- ============================================================
-- Sproutbien — White-label branding + superadmin
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • branding (one row): app name, tagline, company details, brand colour,
--     logo + square icon. Everyone can read it (the login page shows it
--     before anyone signs in); only a superadmin can change it.
--   • superadmins: the vendor's own logins. They are NOT employees, so they
--     never appear in staff lists, attendance or payroll. Add one by hand:
--       1. Authentication → Users → Add user (email + password, auto-confirm)
--       2. INSERT INTO superadmins (user_id)
--            SELECT id FROM auth.users WHERE email = 'you@example.com';
--   • Logos live in the public 'branding' storage bucket.
--   • No foreign keys to employees, so the demo's nightly TRUNCATE can't wipe it.
-- ============================================================

CREATE TABLE IF NOT EXISTS superadmins (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE superadmins ENABLE ROW LEVEL SECURITY;   -- no policies: read through is_superadmin()

CREATE OR REPLACE FUNCTION is_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM superadmins WHERE user_id = auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION is_superadmin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION is_superadmin() TO authenticated;

CREATE TABLE IF NOT EXISTS branding (
  id              boolean     PRIMARY KEY DEFAULT true CHECK (id),   -- a single row
  app_name        text        NOT NULL DEFAULT 'SproutBien'                    CHECK (length(trim(app_name)) BETWEEN 1 AND 40),
  tagline         text        NOT NULL DEFAULT 'nurturing businesses digitally' CHECK (length(tagline) <= 60),
  product_name    text        NOT NULL DEFAULT 'Attendance Tracker'             CHECK (length(product_name) <= 40),
  company_name    text        NOT NULL DEFAULT 'Sproutbien'                     CHECK (length(company_name) <= 80),
  company_address text        NOT NULL DEFAULT ''                               CHECK (length(company_address) <= 200),
  support_email   text        NOT NULL DEFAULT ''                               CHECK (length(support_email) <= 120),
  support_phone   text        NOT NULL DEFAULT ''                               CHECK (length(support_phone) <= 30),
  primary_color   text        NOT NULL DEFAULT '#2a7a22'                        CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_path       text,       -- object in the 'branding' bucket; NULL = the built-in logo
  icon_path       text,       -- square icon (sidebar, browser tab); NULL = use the logo
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        -- no FK on purpose (see header)
);
INSERT INTO branding (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE branding ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "branding: anyone reads" ON branding;
CREATE POLICY "branding: anyone reads" ON branding FOR SELECT USING (true);
DROP POLICY IF EXISTS "branding: superadmin update" ON branding;
CREATE POLICY "branding: superadmin update" ON branding FOR UPDATE USING (is_superadmin()) WITH CHECK (is_superadmin());
GRANT SELECT ON branding TO anon;

-- ── Storage ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('branding', 'branding', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "branding: superadmin insert" ON storage.objects;
CREATE POLICY "branding: superadmin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'branding' AND public.is_superadmin());
DROP POLICY IF EXISTS "branding: superadmin read" ON storage.objects;
CREATE POLICY "branding: superadmin read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'branding' AND public.is_superadmin());
DROP POLICY IF EXISTS "branding: superadmin delete" ON storage.objects;
CREATE POLICY "branding: superadmin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'branding' AND public.is_superadmin());
