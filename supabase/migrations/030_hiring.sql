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
