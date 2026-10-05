-- ============================================================
-- Sproutbien — Let a customer's admins change their own branding
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Two switches only a superadmin can flip (both off by default):
--       admin_edit_look     logo, square icon and brand colour
--       admin_edit_details  app name, tagline, product name, company
--                           name/address and support contact
--   • All branding saves now go through update_branding(), which checks
--     who may change what.
-- ============================================================

ALTER TABLE branding
  ADD COLUMN IF NOT EXISTS admin_edit_look    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_edit_details boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION update_branding(p jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b     branding;
  sup   boolean := is_superadmin();
  look  boolean;
  det   boolean;
  f     text;
BEGIN
  SELECT * INTO b FROM branding WHERE id;
  IF NOT sup AND NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  look := sup OR b.admin_edit_look;
  det  := sup OR b.admin_edit_details;

  IF NOT look THEN
    FOREACH f IN ARRAY ARRAY['primary_color', 'logo_path', 'icon_path'] LOOP
      IF p ? f AND (p->>f) IS DISTINCT FROM (to_jsonb(b)->>f) THEN
        RAISE EXCEPTION 'You can''t change the logo or colours.';
      END IF;
    END LOOP;
  END IF;
  IF NOT det THEN
    FOREACH f IN ARRAY ARRAY['app_name', 'tagline', 'product_name', 'company_name', 'company_address', 'support_email', 'support_phone'] LOOP
      IF p ? f AND (p->>f) IS DISTINCT FROM (to_jsonb(b)->>f) THEN
        RAISE EXCEPTION 'You can''t change the names or contact details.';
      END IF;
    END LOOP;
  END IF;
  IF NOT sup AND ((p ? 'admin_edit_look' AND (p->>'admin_edit_look')::boolean IS DISTINCT FROM b.admin_edit_look)
               OR (p ? 'admin_edit_details' AND (p->>'admin_edit_details')::boolean IS DISTINCT FROM b.admin_edit_details)) THEN
    RAISE EXCEPTION 'Only your provider can change who may edit the branding.';
  END IF;

  -- Images must be files in the branding bucket
  FOREACH f IN ARRAY ARRAY['logo_path', 'icon_path'] LOOP
    IF p ? f AND p->>f IS NOT NULL AND (p->>f) IS DISTINCT FROM (to_jsonb(b)->>f)
       AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'branding' AND o.name = p->>f) THEN
      RAISE EXCEPTION 'That image didn''t upload. Please try again.';
    END IF;
  END LOOP;

  UPDATE branding SET
    app_name           = CASE WHEN p ? 'app_name'        THEN p->>'app_name'        ELSE app_name END,
    tagline            = CASE WHEN p ? 'tagline'         THEN p->>'tagline'         ELSE tagline END,
    product_name       = CASE WHEN p ? 'product_name'    THEN p->>'product_name'    ELSE product_name END,
    company_name       = CASE WHEN p ? 'company_name'    THEN p->>'company_name'    ELSE company_name END,
    company_address    = CASE WHEN p ? 'company_address' THEN p->>'company_address' ELSE company_address END,
    support_email      = CASE WHEN p ? 'support_email'   THEN p->>'support_email'   ELSE support_email END,
    support_phone      = CASE WHEN p ? 'support_phone'   THEN p->>'support_phone'   ELSE support_phone END,
    primary_color      = CASE WHEN p ? 'primary_color'   THEN p->>'primary_color'   ELSE primary_color END,
    logo_path          = CASE WHEN p ? 'logo_path'       THEN p->>'logo_path'       ELSE logo_path END,
    icon_path          = CASE WHEN p ? 'icon_path'       THEN p->>'icon_path'       ELSE icon_path END,
    admin_edit_look    = CASE WHEN p ? 'admin_edit_look'    THEN (p->>'admin_edit_look')::boolean    ELSE admin_edit_look END,
    admin_edit_details = CASE WHEN p ? 'admin_edit_details' THEN (p->>'admin_edit_details')::boolean ELSE admin_edit_details END,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_branding(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION update_branding(jsonb) TO authenticated;

-- Admins upload/remove logo files while "Logo and colours" is on
CREATE OR REPLACE FUNCTION can_edit_branding_images()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_superadmin() OR (is_admin() AND COALESCE((SELECT admin_edit_look FROM branding WHERE id), false));
$$;

REVOKE EXECUTE ON FUNCTION can_edit_branding_images() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION can_edit_branding_images() TO authenticated;

DROP POLICY IF EXISTS "branding: superadmin insert" ON storage.objects;
DROP POLICY IF EXISTS "branding: superadmin read" ON storage.objects;
DROP POLICY IF EXISTS "branding: superadmin delete" ON storage.objects;
DROP POLICY IF EXISTS "branding: editors insert" ON storage.objects;
CREATE POLICY "branding: editors insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'branding' AND public.can_edit_branding_images());
DROP POLICY IF EXISTS "branding: editors read" ON storage.objects;
CREATE POLICY "branding: editors read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'branding' AND public.can_edit_branding_images());
DROP POLICY IF EXISTS "branding: editors delete" ON storage.objects;
CREATE POLICY "branding: editors delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'branding' AND public.can_edit_branding_images());
