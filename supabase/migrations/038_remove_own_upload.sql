-- ============================================================
-- Sproutbien — Employees can remove a document they just uploaded
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • remove_own_document(id): an employee removes a document they uploaded
--     themselves within the last 24 hours (e.g. picked the wrong file during
--     onboarding). Older uploads, and anything HR added, stay admin-only.
--   • If no documents are left in that category, the matching onboarding
--     step is unticked again.
--   • The file itself is then deleted by the app: the existing storage policy
--     lets an employee delete their own file once its record is gone.
-- ============================================================

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

  DELETE FROM employee_documents WHERE id = d.id;

  IF NOT EXISTS (SELECT 1 FROM employee_documents WHERE employee_id = d.employee_id AND category = d.category) THEN
    UPDATE onboarding_tasks SET done_at = NULL, done_by = NULL
    WHERE employee_id = d.employee_id AND document_category = d.category;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_own_document(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION remove_own_document(uuid) TO authenticated;
