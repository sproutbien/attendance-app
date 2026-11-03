-- ============================================================
-- Sproutbien — Fix: card photos for employees
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- 047's photo rules looked up the card in `celebrations`, which only
-- admins can read, so employees could not upload a photo and the person
-- celebrated could not see the photos on their card. The checks now run
-- in functions that can see the card.
-- ============================================================

CREATE OR REPLACE FUNCTION can_upload_celebration_photo(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (storage.foldername(p_name))[2] = auth.uid()::text
     AND EXISTS (SELECT 1 FROM celebrations c
                  WHERE c.id::text = (storage.foldername(p_name))[1]
                    AND c.employee_id <> auth.uid());
$$;

CREATE OR REPLACE FUNCTION can_read_celebration_photo(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_admin()
      OR (storage.foldername(p_name))[2] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM celebrations c
                  WHERE c.id::text = (storage.foldername(p_name))[1]
                    AND c.employee_id = auth.uid()
                    AND c.occasion_date <= celebration_today());
$$;

REVOKE EXECUTE ON FUNCTION can_upload_celebration_photo(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION can_upload_celebration_photo(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION can_read_celebration_photo(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION can_read_celebration_photo(text) TO authenticated;

DROP POLICY IF EXISTS "celebration-photos: author uploads" ON storage.objects;
CREATE POLICY "celebration-photos: author uploads" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'celebration-photos' AND public.can_upload_celebration_photo(name));

DROP POLICY IF EXISTS "celebration-photos: read" ON storage.objects;
CREATE POLICY "celebration-photos: read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'celebration-photos' AND public.can_read_celebration_photo(name));
