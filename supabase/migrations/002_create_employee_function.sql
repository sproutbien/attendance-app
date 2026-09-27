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
SET search_path = public, auth
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
    created_at, updated_at
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    p_email,
    crypt(p_password, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    'authenticated', 'authenticated',
    NOW(), NOW()
  );

  -- Insert into auth.identities (needed for email login to work)
  INSERT INTO auth.identities (
    id, user_id, provider_id,
    identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_user_id::text,
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
