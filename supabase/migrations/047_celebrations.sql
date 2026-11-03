-- ============================================================
-- Sproutbien — Birthday and work-anniversary celebrations
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Who is celebrated: Active / Probation staff with a date of birth
--     (birthday) or a joining date at least a year back (anniversary),
--     unless an admin ticked employees.no_celebrations. Day and month only.
--   • Team card: teammates sign from 3 days before until the day itself
--     (a message, optionally one photo). Admins can write from 30 days
--     before until 3 days after (late wishes).
--   • Only the person celebrated (from the day) and admins can read the
--     messages and photos. Teammates see who has signed, not what.
--   • Pop-up: shown to the person on the day or the next 3 days, once.
--     "Thank you!" is shown to everyone who signed.
--   • Photos: private bucket 'celebration-photos', <celebration>/<author>/<file>.
--   Rows are created on demand by the functions below; all writes go
--   through them (tables are read-only, admins only).
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS no_celebrations boolean NOT NULL DEFAULT false;   -- admin only

CREATE TABLE IF NOT EXISTS celebrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('birthday', 'anniversary')),
  occasion_date date NOT NULL,              -- this year's day
  years         int,                        -- anniversaries: years with the company
  seen_at       timestamptz,                -- the person saw the pop-up
  thanked_at    timestamptz,                -- the person tapped "Thank you!"
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, kind, occasion_date)
);

CREATE TABLE IF NOT EXISTS celebration_wishes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  celebration_id uuid NOT NULL REFERENCES celebrations(id) ON DELETE CASCADE,
  author_id      uuid REFERENCES employees(id) ON DELETE SET NULL,
  author_name    text NOT NULL,
  from_admin     boolean NOT NULL DEFAULT false,
  message        text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 1000),
  photo_path     text,                      -- object in 'celebration-photos'
  thanks_seen_at timestamptz,               -- author dismissed the "says thank you" note
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (celebration_id, author_id)
);
CREATE INDEX IF NOT EXISTS celebration_wishes_author_idx ON celebration_wishes (author_id);

ALTER TABLE celebrations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE celebration_wishes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "celebrations: admins read" ON celebrations;
CREATE POLICY "celebrations: admins read" ON celebrations FOR SELECT TO authenticated USING (is_admin());
DROP POLICY IF EXISTS "celebration_wishes: admins read" ON celebration_wishes;
CREATE POLICY "celebration_wishes: admins read" ON celebration_wishes FOR SELECT TO authenticated USING (is_admin());
GRANT SELECT ON celebrations, celebration_wishes TO authenticated;

-- ── Dates ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION celebration_today()
RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- The yearly repeat of d between p_from and p_to (29 Feb falls on 28 Feb in other years); null if none
CREATE OR REPLACE FUNCTION yearly_repeat_between(d date, p_from date, p_to date)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  y int;
  c date;
BEGIN
  IF d IS NULL OR p_from IS NULL OR p_to IS NULL THEN RETURN NULL; END IF;
  FOR y IN extract(year FROM p_from)::int .. extract(year FROM p_to)::int LOOP
    IF extract(month FROM d) = 2 AND extract(day FROM d) = 29 AND NOT (y % 4 = 0 AND (y % 100 <> 0 OR y % 400 = 0)) THEN
      c := make_date(y, 2, 28);
    ELSE
      c := make_date(y, extract(month FROM d)::int, extract(day FROM d)::int);
    END IF;
    IF c > d AND c BETWEEN p_from AND p_to THEN RETURN c; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- Everyone celebrated between two dates
CREATE OR REPLACE FUNCTION celebration_occasions(p_from date, p_to date)
RETURNS TABLE (employee_id uuid, kind text, occasion_date date, years int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, o.kind, o.d,
         CASE WHEN o.kind = 'anniversary' THEN extract(year FROM o.d)::int - extract(year FROM e.joining_date)::int END
  FROM employees e
  CROSS JOIN LATERAL (VALUES
    ('birthday'::text,    yearly_repeat_between(e.date_of_birth, p_from, p_to)),
    ('anniversary'::text, yearly_repeat_between(e.joining_date,  p_from, p_to))
  ) AS o(kind, d)
  WHERE o.d IS NOT NULL
    AND e.deleted_at IS NULL
    AND e.status IN ('active', 'probation')
    AND NOT e.no_celebrations;
$$;

-- Can the caller write on this card today? Returns the celebration id (row made if needed).
CREATE OR REPLACE FUNCTION open_celebration(p_employee uuid, p_kind text, p_occasion date)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := celebration_today();
  v_admin boolean := is_admin();
  v_years int;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM employees WHERE id = auth.uid() AND deleted_at IS NULL
      AND status NOT IN ('resigned', 'terminated', 'inactive')
  ) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_employee = auth.uid() THEN
    RAISE EXCEPTION 'You can’t sign your own card.';
  END IF;
  SELECT o.years INTO v_years FROM celebration_occasions(p_occasion, p_occasion) o
   WHERE o.employee_id = p_employee AND o.kind = p_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There’s no celebration for them on that day.';
  END IF;
  IF v_admin THEN
    IF v_today < p_occasion - 30 OR v_today > p_occasion + 3 THEN
      RAISE EXCEPTION 'Wishes can be written from 30 days before until 3 days after.';
    END IF;
  ELSIF v_today < p_occasion - 3 OR v_today > p_occasion THEN
    RAISE EXCEPTION 'This card is closed. Cards open 3 days before and close at the end of the day.';
  END IF;

  INSERT INTO celebrations (employee_id, kind, occasion_date, years)
  VALUES (p_employee, p_kind, p_occasion, v_years)
  ON CONFLICT (employee_id, kind, occasion_date) DO NOTHING;
  SELECT id INTO v_id FROM celebrations
   WHERE employee_id = p_employee AND kind = p_kind AND occasion_date = p_occasion;
  RETURN v_id;
END;
$$;

-- Add or change the caller's message (and optional photo, uploaded first)
CREATE OR REPLACE FUNCTION sign_celebration(p_celebration uuid, p_message text, p_photo_path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c celebrations%ROWTYPE;
  v_msg text := btrim(coalesce(p_message, ''));
BEGIN
  SELECT * INTO c FROM celebrations WHERE id = p_celebration;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found.'; END IF;
  PERFORM open_celebration(c.employee_id, c.kind, c.occasion_date);   -- same checks
  IF length(v_msg) = 0 THEN RAISE EXCEPTION 'Write a message first.'; END IF;
  IF length(v_msg) > 1000 THEN RAISE EXCEPTION 'Keep the message under 1000 characters.'; END IF;
  IF p_photo_path IS NOT NULL AND (
       p_photo_path NOT LIKE p_celebration::text || '/' || auth.uid()::text || '/%'
       OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'celebration-photos' AND name = p_photo_path)
     ) THEN
    RAISE EXCEPTION 'The photo didn’t upload. Try adding it again.';
  END IF;

  INSERT INTO celebration_wishes (celebration_id, author_id, author_name, from_admin, message, photo_path)
  SELECT p_celebration, e.id, e.full_name, is_admin(), v_msg, p_photo_path
    FROM employees e WHERE e.id = auth.uid()
  ON CONFLICT (celebration_id, author_id) DO UPDATE
    SET message = EXCLUDED.message, photo_path = EXCLUDED.photo_path,
        from_admin = EXCLUDED.from_admin, updated_at = now();
END;
$$;

-- Take the caller's message off a card that is still open. Returns the photo to delete, if any.
CREATE OR REPLACE FUNCTION remove_my_wish(p_celebration uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c celebrations%ROWTYPE;
  v_photo text;
BEGIN
  SELECT * INTO c FROM celebrations WHERE id = p_celebration;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found.'; END IF;
  PERFORM open_celebration(c.employee_id, c.kind, c.occasion_date);
  DELETE FROM celebration_wishes WHERE celebration_id = p_celebration AND author_id = auth.uid()
  RETURNING photo_path INTO v_photo;
  RETURN v_photo;
END;
$$;

-- Admins: take a photo, or a whole message, off any card. Returns the photo to delete, if any.
CREATE OR REPLACE FUNCTION admin_remove_wish(p_wish uuid, p_photo_only boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_photo text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Only admins can do this.'; END IF;
  SELECT photo_path INTO v_photo FROM celebration_wishes WHERE id = p_wish;
  IF p_photo_only THEN
    UPDATE celebration_wishes SET photo_path = NULL, updated_at = now() WHERE id = p_wish;
  ELSE
    DELETE FROM celebration_wishes WHERE id = p_wish;
  END IF;
  RETURN v_photo;
END;
$$;

-- ── Teammates: open cards (3 days before until the day) ─────

CREATE OR REPLACE FUNCTION team_celebrations()
RETURNS TABLE (
  employee_id uuid, full_name text, designation text, photo_path text,
  kind text, years int, occasion_date date, celebration_id uuid,
  my_message text, my_photo_path text, signers jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.employee_id, e.full_name, e.designation, e.photo_path,
         o.kind, o.years, o.occasion_date, c.id,
         mine.message, mine.photo_path,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object('name', w.author_name, 'photo_path', a.photo_path) ORDER BY w.created_at)
           FROM celebration_wishes w LEFT JOIN employees a ON a.id = w.author_id
           WHERE w.celebration_id = c.id
         ), '[]'::jsonb)
  FROM celebration_occasions(celebration_today(), celebration_today() + 3) o
  JOIN employees e ON e.id = o.employee_id
  LEFT JOIN celebrations c ON c.employee_id = o.employee_id AND c.kind = o.kind AND c.occasion_date = o.occasion_date
  LEFT JOIN celebration_wishes mine ON mine.celebration_id = c.id AND mine.author_id = auth.uid()
  WHERE o.employee_id <> auth.uid()
    AND EXISTS (SELECT 1 FROM employees me WHERE me.id = auth.uid() AND me.deleted_at IS NULL
                  AND me.status NOT IN ('resigned', 'terminated', 'inactive'))
  ORDER BY o.occasion_date, e.full_name;
$$;

-- "Priya says thank you!" for people who signed (shown for a week, until dismissed)
CREATE OR REPLACE FUNCTION my_thanks()
RETURNS TABLE (celebration_id uuid, full_name text, photo_path text, kind text, years int, occasion_date date)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, e.full_name, e.photo_path, c.kind, c.years, c.occasion_date
  FROM celebration_wishes w
  JOIN celebrations c ON c.id = w.celebration_id
  JOIN employees e ON e.id = c.employee_id
  WHERE w.author_id = auth.uid() AND w.thanks_seen_at IS NULL
    AND c.thanked_at IS NOT NULL AND c.thanked_at > now() - interval '7 days'
  ORDER BY c.thanked_at DESC;
$$;

CREATE OR REPLACE FUNCTION dismiss_thanks(p_celebration uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE celebration_wishes SET thanks_seen_at = now()
   WHERE celebration_id = p_celebration AND author_id = auth.uid();
$$;

-- ── The person celebrated ───────────────────────────────────

-- Their cards up to today, newest first, with every message.
-- Makes the row for a celebration in the last 3 days so the pop-up shows even with no messages.
CREATE OR REPLACE FUNCTION my_celebrations()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := celebration_today();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;

  INSERT INTO celebrations (employee_id, kind, occasion_date, years)
  SELECT o.employee_id, o.kind, o.occasion_date, o.years
    FROM celebration_occasions(v_today - 3, v_today) o
   WHERE o.employee_id = auth.uid()
  ON CONFLICT (employee_id, kind, occasion_date) DO NOTHING;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'years', c.years, 'occasion_date', c.occasion_date,
      'seen_at', c.seen_at, 'thanked_at', c.thanked_at,
      'wishes', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', w.id, 'author_name', w.author_name, 'author_photo', a.photo_path,
          'author_designation', a.designation, 'from_admin', w.from_admin,
          'message', w.message, 'photo_path', w.photo_path, 'created_at', w.created_at
        ) ORDER BY w.from_admin DESC, w.created_at)
        FROM celebration_wishes w LEFT JOIN employees a ON a.id = w.author_id
        WHERE w.celebration_id = c.id
      ), '[]'::jsonb)
    ) ORDER BY c.occasion_date DESC, c.kind)
    FROM celebrations c
    WHERE c.employee_id = auth.uid() AND c.occasion_date <= v_today
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION celebration_seen(p_id uuid, p_thanked boolean)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE celebrations
     SET seen_at = coalesce(seen_at, now()),
         thanked_at = CASE WHEN p_thanked THEN coalesce(thanked_at, now()) ELSE thanked_at END
   WHERE id = p_id AND employee_id = auth.uid() AND occasion_date <= celebration_today();
$$;

-- ── Photos ──────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('celebration-photos', 'celebration-photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "celebration-photos: author uploads" ON storage.objects;
CREATE POLICY "celebration-photos: author uploads" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'celebration-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (SELECT 1 FROM public.celebrations c
                 WHERE c.id::text = (storage.foldername(name))[1] AND c.employee_id <> auth.uid()));

DROP POLICY IF EXISTS "celebration-photos: read" ON storage.objects;
CREATE POLICY "celebration-photos: read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'celebration-photos' AND (
    public.is_admin()
    OR (storage.foldername(name))[2] = auth.uid()::text
    OR EXISTS (SELECT 1 FROM public.celebrations c
                WHERE c.id::text = (storage.foldername(name))[1]
                  AND c.employee_id = auth.uid() AND c.occasion_date <= public.celebration_today())));

DROP POLICY IF EXISTS "celebration-photos: author or admin deletes" ON storage.objects;
CREATE POLICY "celebration-photos: author or admin deletes" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'celebration-photos' AND ((storage.foldername(name))[2] = auth.uid()::text OR public.is_admin()));

-- ── Access ──────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION celebration_occasions(date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION open_celebration(uuid, text, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION open_celebration(uuid, text, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION sign_celebration(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION sign_celebration(uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION remove_my_wish(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION remove_my_wish(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_remove_wish(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION admin_remove_wish(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION team_celebrations() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION team_celebrations() TO authenticated;
REVOKE EXECUTE ON FUNCTION my_thanks() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION my_thanks() TO authenticated;
REVOKE EXECUTE ON FUNCTION dismiss_thanks(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION dismiss_thanks(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION my_celebrations() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION my_celebrations() TO authenticated;
REVOKE EXECUTE ON FUNCTION celebration_seen(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION celebration_seen(uuid, boolean) TO authenticated;
