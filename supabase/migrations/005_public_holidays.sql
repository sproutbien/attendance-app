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
