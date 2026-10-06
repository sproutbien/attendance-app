-- ============================================================
-- Sproutbien — HR verifies onboarding documents
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Admin can ask an employee to re-send a document, with a reason
--     (employee_documents.resend_reason). The matching onboarding step
--     unticks; the employee's next upload in that category replaces the
--     flagged file(s) and ticks the step again. The admin can withdraw it.
--   • Once the employee has finished their own steps and nothing is waiting
--     to be re-sent, the admin passes verification (onboarding_reviews).
--     Admin steps don't need to be done first.
--   • The employee sees "verified" on their Dashboard until they press Done.
--   • After verification, employees can no longer remove their own uploads.
--   • Employees who had already finished their steps are marked verified
--     (and the notice as seen), so nobody is left waiting for a review.
-- ============================================================

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS resend_reason       text CHECK (length(resend_reason) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS resend_requested_at timestamptz;

CREATE TABLE IF NOT EXISTS onboarding_reviews (
  employee_id uuid        PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid        REFERENCES employees(id) ON DELETE SET NULL,
  seen_at     timestamptz              -- employee pressed Done on the notice
);

ALTER TABLE onboarding_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "onboarding_reviews: own or admin read" ON onboarding_reviews;
CREATE POLICY "onboarding_reviews: own or admin read" ON onboarding_reviews FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());
-- No direct writes: the functions below do them.

-- Already finished before this existed → verified quietly
INSERT INTO onboarding_reviews (employee_id, verified_at, seen_at)
SELECT t.employee_id, now(), now()
FROM onboarding_tasks t
GROUP BY t.employee_id
HAVING bool_and(t.done_at IS NOT NULL OR t.assignee <> 'employee')
   AND bool_or(t.assignee = 'employee')
ON CONFLICT (employee_id) DO NOTHING;

-- ── Admin: ask for a document again ─────────────────────────
CREATE OR REPLACE FUNCTION request_document_resend(p_document uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d employee_documents;
  r text := btrim(coalesce(p_reason, ''));
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF r = '' THEN RAISE EXCEPTION 'Say what needs fixing.'; END IF;
  SELECT * INTO d FROM employee_documents WHERE id = p_document;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;

  UPDATE employee_documents SET resend_reason = left(r, 200), resend_requested_at = now() WHERE id = d.id;
  UPDATE onboarding_tasks SET done_at = NULL, done_by = NULL
  WHERE employee_id = d.employee_id AND document_category = d.category;
  DELETE FROM onboarding_reviews WHERE employee_id = d.employee_id;
END;
$$;

-- ── Admin: withdraw a re-send request ───────────────────────
CREATE OR REPLACE FUNCTION withdraw_document_resend(p_document uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d employee_documents;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO d FROM employee_documents WHERE id = p_document;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;

  UPDATE employee_documents SET resend_reason = NULL, resend_requested_at = NULL WHERE id = d.id;
  IF NOT EXISTS (SELECT 1 FROM employee_documents
                 WHERE employee_id = d.employee_id AND category = d.category AND resend_reason IS NOT NULL) THEN
    UPDATE onboarding_tasks SET done_at = now(), done_by = auth.uid()
    WHERE employee_id = d.employee_id AND document_category = d.category AND done_at IS NULL;
  END IF;
END;
$$;

-- ── A new upload replaces flagged files in its category ─────
-- Rows only; the app then deletes the files (the storage policy allows an
-- employee to delete their own file once its record is gone).
CREATE OR REPLACE FUNCTION replace_flagged_documents()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM employee_documents
  WHERE employee_id = NEW.employee_id AND category = NEW.category
    AND resend_reason IS NOT NULL AND id <> NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_employee_document_replace ON employee_documents;
CREATE TRIGGER on_employee_document_replace
  AFTER INSERT ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION replace_flagged_documents();

-- ── Admin: pass / undo verification ─────────────────────────
CREATE OR REPLACE FUNCTION pass_document_verification(p_employee uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM employee_documents WHERE employee_id = p_employee AND resend_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'A document is still waiting to be re-sent.';
  END IF;
  IF EXISTS (SELECT 1 FROM onboarding_tasks WHERE employee_id = p_employee AND assignee = 'employee' AND done_at IS NULL) THEN
    RAISE EXCEPTION 'They haven''t finished their steps yet.';
  END IF;
  INSERT INTO onboarding_reviews (employee_id, verified_at, verified_by, seen_at)
  VALUES (p_employee, now(), auth.uid(), NULL)
  ON CONFLICT (employee_id) DO UPDATE SET verified_at = now(), verified_by = auth.uid(), seen_at = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION undo_document_verification(p_employee uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  DELETE FROM onboarding_reviews WHERE employee_id = p_employee;
END;
$$;

-- ── Employee: Done on the "verified" notice ─────────────────
CREATE OR REPLACE FUNCTION dismiss_verification_notice()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE onboarding_reviews SET seen_at = now() WHERE employee_id = auth.uid() AND seen_at IS NULL;
END;
$$;

-- ── Own-upload removal (038) stops once verified ────────────
CREATE OR REPLACE FUNCTION remove_own_document(p_document uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d employee_documents;
BEGIN
  SELECT * INTO d FROM employee_documents WHERE id = p_document;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF d.employee_id IS DISTINCT FROM auth.uid() OR d.uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only remove documents you uploaded yourself.';
  END IF;
  IF d.uploaded_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION 'This document was uploaded more than a day ago. Ask HR to remove it.';
  END IF;
  IF EXISTS (SELECT 1 FROM onboarding_reviews WHERE employee_id = d.employee_id) THEN
    RAISE EXCEPTION 'HR has already verified your documents. Ask HR to remove it.';
  END IF;

  DELETE FROM employee_documents WHERE id = d.id;

  IF NOT EXISTS (SELECT 1 FROM employee_documents WHERE employee_id = d.employee_id AND category = d.category) THEN
    UPDATE onboarding_tasks SET done_at = NULL, done_by = NULL
    WHERE employee_id = d.employee_id AND document_category = d.category;
  END IF;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'request_document_resend(uuid, text)', 'withdraw_document_resend(uuid)',
    'pass_document_verification(uuid)', 'undo_document_verification(uuid)',
    'dismiss_verification_notice()', 'remove_own_document(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
