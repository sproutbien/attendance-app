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
