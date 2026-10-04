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
