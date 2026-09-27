-- ============================================================
-- Sproutbien Attendance Tracker — Seed Data
-- Creates 8 test employees + one week of attendance + leave requests
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- All test accounts use password: Test1234!
-- Dates are hardcoded to the week of 2026-09-22 to 2026-09-26.
-- ============================================================

-- Fixed UUIDs for deterministic re-runs
-- (safe to run multiple times — conflicts are ignored)

DO $$
DECLARE
  id_sarah    uuid := 'a1b2c3d4-0001-4001-8001-000000000001';
  id_michael  uuid := 'a1b2c3d4-0002-4002-8002-000000000002';
  id_emma     uuid := 'a1b2c3d4-0003-4003-8003-000000000003';
  id_james    uuid := 'a1b2c3d4-0004-4004-8004-000000000004';
  id_olivia   uuid := 'a1b2c3d4-0005-4005-8005-000000000005';
  id_priya    uuid := 'a1b2c3d4-0006-4006-8006-000000000006';
  id_marcus   uuid := 'a1b2c3d4-0007-4007-8007-000000000007';
  id_lisa     uuid := 'a1b2c3d4-0008-4008-8008-000000000008';

  pw text := crypt('Test1234!', gen_salt('bf'));
BEGIN

  -- ── Auth users ─────────────────────────────────────────────
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
  VALUES
    (id_sarah,   '00000000-0000-0000-0000-000000000000', 'sarah.johnson@sproutbien.com',   pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Sarah Johnson"}',   'authenticated', 'authenticated', NOW(), NOW()),
    (id_michael, '00000000-0000-0000-0000-000000000000', 'michael.chen@sproutbien.com',    pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Michael Chen"}',    'authenticated', 'authenticated', NOW(), NOW()),
    (id_emma,    '00000000-0000-0000-0000-000000000000', 'emma.williams@sproutbien.com',   pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Emma Williams"}',   'authenticated', 'authenticated', NOW(), NOW()),
    (id_james,   '00000000-0000-0000-0000-000000000000', 'james.brown@sproutbien.com',     pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"James Brown"}',     'authenticated', 'authenticated', NOW(), NOW()),
    (id_olivia,  '00000000-0000-0000-0000-000000000000', 'olivia.davis@sproutbien.com',    pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Olivia Davis"}',    'authenticated', 'authenticated', NOW(), NOW()),
    (id_priya,   '00000000-0000-0000-0000-000000000000', 'priya.patel@sproutbien.com',     pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Priya Patel"}',     'authenticated', 'authenticated', NOW(), NOW()),
    (id_marcus,  '00000000-0000-0000-0000-000000000000', 'marcus.thompson@sproutbien.com', pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Marcus Thompson"}', 'authenticated', 'authenticated', NOW(), NOW()),
    (id_lisa,    '00000000-0000-0000-0000-000000000000', 'lisa.zhang@sproutbien.com',      pw, NOW(), '{"provider":"email","providers":["email"]}', '{"full_name":"Lisa Zhang"}',      'authenticated', 'authenticated', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ── Auth identities ────────────────────────────────────────
  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES
    (id_sarah::text,   id_sarah,   'sarah.johnson@sproutbien.com',   jsonb_build_object('sub', id_sarah::text,   'email', 'sarah.johnson@sproutbien.com'),   'email', NOW(), NOW(), NOW()),
    (id_michael::text, id_michael, 'michael.chen@sproutbien.com',    jsonb_build_object('sub', id_michael::text, 'email', 'michael.chen@sproutbien.com'),    'email', NOW(), NOW(), NOW()),
    (id_emma::text,    id_emma,    'emma.williams@sproutbien.com',   jsonb_build_object('sub', id_emma::text,    'email', 'emma.williams@sproutbien.com'),   'email', NOW(), NOW(), NOW()),
    (id_james::text,   id_james,   'james.brown@sproutbien.com',     jsonb_build_object('sub', id_james::text,   'email', 'james.brown@sproutbien.com'),     'email', NOW(), NOW(), NOW()),
    (id_olivia::text,  id_olivia,  'olivia.davis@sproutbien.com',    jsonb_build_object('sub', id_olivia::text,  'email', 'olivia.davis@sproutbien.com'),    'email', NOW(), NOW(), NOW()),
    (id_priya::text,   id_priya,   'priya.patel@sproutbien.com',     jsonb_build_object('sub', id_priya::text,   'email', 'priya.patel@sproutbien.com'),     'email', NOW(), NOW(), NOW()),
    (id_marcus::text,  id_marcus,  'marcus.thompson@sproutbien.com', jsonb_build_object('sub', id_marcus::text,  'email', 'marcus.thompson@sproutbien.com'), 'email', NOW(), NOW(), NOW()),
    (id_lisa::text,    id_lisa,    'lisa.zhang@sproutbien.com',      jsonb_build_object('sub', id_lisa::text,    'email', 'lisa.zhang@sproutbien.com'),      'email', NOW(), NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ── Employee profiles ──────────────────────────────────────
  INSERT INTO public.employees (id, full_name, email, role, department, status)
  VALUES
    (id_sarah,   'Sarah Johnson',   'sarah.johnson@sproutbien.com',   'employee', 'Engineering', 'active'),
    (id_michael, 'Michael Chen',    'michael.chen@sproutbien.com',    'employee', 'Engineering', 'active'),
    (id_emma,    'Emma Williams',   'emma.williams@sproutbien.com',   'employee', 'Marketing',   'active'),
    (id_james,   'James Brown',     'james.brown@sproutbien.com',     'employee', 'Marketing',   'active'),
    (id_olivia,  'Olivia Davis',    'olivia.davis@sproutbien.com',    'employee', 'HR',          'active'),
    (id_priya,   'Priya Patel',     'priya.patel@sproutbien.com',     'employee', 'HR',          'active'),
    (id_marcus,  'Marcus Thompson', 'marcus.thompson@sproutbien.com', 'employee', 'Finance',     'active'),
    (id_lisa,    'Lisa Zhang',      'lisa.zhang@sproutbien.com',      'employee', 'Finance',     'active')
  ON CONFLICT (id) DO NOTHING;

  -- ── Attendance: week of 2026-09-22 (Mon) – 2026-09-26 (Fri) ──
  --
  -- Sarah Johnson:  present all 5 days
  -- Michael Chen:   present Mon–Thu, absent Fri
  -- Emma Williams:  late Mon (9:32), present Tue–Fri
  -- James Brown:    on_leave all 5 days (via approved leave below)
  -- Olivia Davis:   present Mon–Wed, absent Thu–Fri
  -- Priya Patel:    present all 5 days
  -- Marcus Thompson: present Mon, late Tue (9:48), present Wed–Fri
  -- Lisa Zhang:     present all 5 days

  INSERT INTO public.attendance_records (employee_id, date, check_in_time, check_out_time, status)
  VALUES
    -- Sarah Johnson — present all week
    (id_sarah, '2026-09-22', '2026-09-22T08:31:00Z', '2026-09-22T17:05:00Z', 'present'),
    (id_sarah, '2026-09-23', '2026-09-23T08:47:00Z', '2026-09-23T17:15:00Z', 'present'),
    (id_sarah, '2026-09-24', '2026-09-24T08:25:00Z', '2026-09-24T17:30:00Z', 'present'),
    (id_sarah, '2026-09-25', '2026-09-25T08:52:00Z', '2026-09-25T17:10:00Z', 'present'),
    (id_sarah, '2026-09-26', '2026-09-26T08:38:00Z', '2026-09-26T17:00:00Z', 'present'),

    -- Michael Chen — absent Friday
    (id_michael, '2026-09-22', '2026-09-22T08:42:00Z', '2026-09-22T17:20:00Z', 'present'),
    (id_michael, '2026-09-23', '2026-09-23T08:30:00Z', '2026-09-23T17:45:00Z', 'present'),
    (id_michael, '2026-09-24', '2026-09-24T08:55:00Z', '2026-09-24T17:10:00Z', 'present'),
    (id_michael, '2026-09-25', '2026-09-25T08:40:00Z', '2026-09-25T17:00:00Z', 'present'),

    -- Emma Williams — late Monday
    (id_emma, '2026-09-22', '2026-09-22T09:32:00Z', '2026-09-22T18:00:00Z', 'late'),
    (id_emma, '2026-09-23', '2026-09-23T08:28:00Z', '2026-09-23T17:15:00Z', 'present'),
    (id_emma, '2026-09-24', '2026-09-24T08:50:00Z', '2026-09-24T17:30:00Z', 'present'),
    (id_emma, '2026-09-25', '2026-09-25T08:35:00Z', '2026-09-25T17:05:00Z', 'present'),
    (id_emma, '2026-09-26', '2026-09-26T08:45:00Z', '2026-09-26T17:20:00Z', 'present'),

    -- James Brown — on_leave all week
    (id_james, '2026-09-22', NULL, NULL, 'on_leave'),
    (id_james, '2026-09-23', NULL, NULL, 'on_leave'),
    (id_james, '2026-09-24', NULL, NULL, 'on_leave'),
    (id_james, '2026-09-25', NULL, NULL, 'on_leave'),
    (id_james, '2026-09-26', NULL, NULL, 'on_leave'),

    -- Olivia Davis — absent Thu & Fri
    (id_olivia, '2026-09-22', '2026-09-22T08:55:00Z', '2026-09-22T17:00:00Z', 'present'),
    (id_olivia, '2026-09-23', '2026-09-23T08:40:00Z', '2026-09-23T17:10:00Z', 'present'),
    (id_olivia, '2026-09-24', '2026-09-24T08:48:00Z', '2026-09-24T17:25:00Z', 'present'),

    -- Priya Patel — present all week
    (id_priya, '2026-09-22', '2026-09-22T08:29:00Z', '2026-09-22T17:05:00Z', 'present'),
    (id_priya, '2026-09-23', '2026-09-23T08:45:00Z', '2026-09-23T17:15:00Z', 'present'),
    (id_priya, '2026-09-24', '2026-09-24T08:33:00Z', '2026-09-24T17:30:00Z', 'present'),
    (id_priya, '2026-09-25', '2026-09-25T08:51:00Z', '2026-09-25T17:00:00Z', 'present'),
    (id_priya, '2026-09-26', '2026-09-26T08:27:00Z', '2026-09-26T17:10:00Z', 'present'),

    -- Marcus Thompson — late Tuesday
    (id_marcus, '2026-09-22', '2026-09-22T08:44:00Z', '2026-09-22T17:20:00Z', 'present'),
    (id_marcus, '2026-09-23', '2026-09-23T09:48:00Z', '2026-09-23T18:15:00Z', 'late'),
    (id_marcus, '2026-09-24', '2026-09-24T08:37:00Z', '2026-09-24T17:05:00Z', 'present'),
    (id_marcus, '2026-09-25', '2026-09-25T08:42:00Z', '2026-09-25T17:30:00Z', 'present'),
    (id_marcus, '2026-09-26', '2026-09-26T08:30:00Z', '2026-09-26T17:00:00Z', 'present'),

    -- Lisa Zhang — present all week
    (id_lisa, '2026-09-22', '2026-09-22T08:35:00Z', '2026-09-22T17:10:00Z', 'present'),
    (id_lisa, '2026-09-23', '2026-09-23T08:50:00Z', '2026-09-23T17:25:00Z', 'present'),
    (id_lisa, '2026-09-24', '2026-09-24T08:28:00Z', '2026-09-24T17:15:00Z', 'present'),
    (id_lisa, '2026-09-25', '2026-09-25T08:40:00Z', '2026-09-25T17:05:00Z', 'present'),
    (id_lisa, '2026-09-26', '2026-09-26T08:55:00Z', '2026-09-26T17:30:00Z', 'present')
  ON CONFLICT (employee_id, date) DO NOTHING;

  -- ── Leave requests ─────────────────────────────────────────
  INSERT INTO public.leave_requests (id, employee_id, start_date, end_date, reason, status, requested_at, reviewed_at)
  VALUES
    -- James Brown: last week, approved (attendance rows inserted above)
    (
      'b0000001-0001-4001-8001-000000000001',
      id_james,
      '2026-09-22', '2026-09-26',
      'Family vacation',
      'approved',
      '2026-09-15T10:00:00Z',
      '2026-09-16T09:00:00Z'
    ),
    -- Olivia Davis: next week, pending
    (
      'b0000002-0002-4002-8002-000000000002',
      id_olivia,
      '2026-10-06', '2026-10-10',
      'Medical procedure and recovery',
      'pending',
      '2026-09-22T11:30:00Z',
      NULL
    ),
    -- Michael Chen: two weeks ago, rejected
    (
      'b0000003-0003-4003-8003-000000000003',
      id_michael,
      '2026-09-14', '2026-09-18',
      'Personal trip',
      'rejected',
      '2026-09-08T14:00:00Z',
      '2026-09-09T08:30:00Z'
    ),
    -- Priya Patel: upcoming, pending
    (
      'b0000004-0004-4004-8004-000000000004',
      id_priya,
      '2026-10-20', '2026-10-22',
      'Wedding attendance',
      'pending',
      '2026-09-25T09:15:00Z',
      NULL
    )
  ON CONFLICT (id) DO NOTHING;

END $$;
