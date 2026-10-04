-- ============================================================
-- Sproutbien — Leave policy page and acknowledgements
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • The policy page is built in the app from the live settings (leave
--     types, holidays, monthly limits, shift times). Admins add anything
--     else as "Additional rules" (leave_policy, one row).
--   • version = how many times the policy was published to everyone
--     (0 = never). Publishing asks every employee to read it and press
--     "I've read it"; leave_policy_acks records who did, per version.
--   • The onboarding step "Read the leave policy" is now done by
--     acknowledging the policy (action = 'leave_policy'), not ticked by hand.
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_policy (
  id               boolean     PRIMARY KEY DEFAULT true CHECK (id),   -- a single row
  additional_rules text        NOT NULL DEFAULT '' CHECK (length(additional_rules) <= 5000),
  version          integer     NOT NULL DEFAULT 0 CHECK (version >= 0),
  published_at     timestamptz,
  published_by     uuid        REFERENCES employees(id) ON DELETE SET NULL
);
INSERT INTO leave_policy (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE leave_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_policy: everyone reads" ON leave_policy;
CREATE POLICY "leave_policy: everyone reads" ON leave_policy FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "leave_policy: admin update" ON leave_policy;
CREATE POLICY "leave_policy: admin update" ON leave_policy FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

CREATE TABLE IF NOT EXISTS leave_policy_acks (
  employee_id     uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  version         integer     NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, version)
);

ALTER TABLE leave_policy_acks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_policy_acks: own or admin read" ON leave_policy_acks;
CREATE POLICY "leave_policy_acks: own or admin read" ON leave_policy_acks FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

-- ── Onboarding steps done by an action in the app ───────────
ALTER TABLE onboarding_template ADD COLUMN IF NOT EXISTS action text CHECK (action IS NULL OR action IN ('leave_policy'));
ALTER TABLE onboarding_tasks    ADD COLUMN IF NOT EXISTS action text CHECK (action IS NULL OR action IN ('leave_policy'));

UPDATE onboarding_template SET action = 'leave_policy', details = 'Open it from here and press “I’ve read it” at the end.'
 WHERE title = 'Read the leave policy' AND assignee = 'employee';
UPDATE onboarding_tasks SET action = 'leave_policy', details = 'Open it from here and press “I’ve read it” at the end.'
 WHERE title = 'Read the leave policy' AND assignee = 'employee';

-- ── Employee: "I've read it" ────────────────────────────────
CREATE OR REPLACE FUNCTION acknowledge_leave_policy()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO leave_policy_acks (employee_id, version)
  SELECT auth.uid(), version FROM leave_policy WHERE id
  ON CONFLICT (employee_id, version) DO NOTHING;
  UPDATE onboarding_tasks SET done_at = now(), done_by = auth.uid()
  WHERE employee_id = auth.uid() AND action = 'leave_policy' AND done_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION acknowledge_leave_policy() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION acknowledge_leave_policy() TO authenticated;

-- ── Admin: save the additional rules, optionally asking everyone to read it again ──
CREATE OR REPLACE FUNCTION save_leave_policy(p_rules text, p_publish boolean)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v integer;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE leave_policy SET
    additional_rules = COALESCE(p_rules, ''),
    version          = CASE WHEN p_publish THEN version + 1 ELSE version END,
    published_at     = CASE WHEN p_publish THEN now() ELSE published_at END,
    published_by     = CASE WHEN p_publish THEN auth.uid() ELSE published_by END
  WHERE id
  RETURNING version INTO v;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION save_leave_policy(text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION save_leave_policy(text, boolean) TO authenticated;

-- ── Same as migration 029, carrying the action across; a policy already
-- acknowledged ticks its step ──
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

  INSERT INTO onboarding_tasks (employee_id, title, details, assignee, document_category, action, sort_order, done_at, done_by)
  SELECT p_employee, t.title, t.details, t.assignee, t.document_category, t.action, t.sort_order,
         CASE WHEN d.id IS NOT NULL OR a.version IS NOT NULL THEN now() END,
         CASE WHEN d.id IS NOT NULL OR a.version IS NOT NULL THEN auth.uid() END
  FROM onboarding_template t
  LEFT JOIN LATERAL (SELECT id FROM employee_documents
                     WHERE employee_id = p_employee AND category = t.document_category LIMIT 1) d ON true
  LEFT JOIN LATERAL (SELECT k.version FROM leave_policy_acks k JOIN leave_policy p ON p.id
                     WHERE t.action = 'leave_policy' AND k.employee_id = p_employee AND k.version = p.version) a ON true
  ORDER BY t.sort_order, t.created_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Same as migration 029, plus: employees can't tick an action step by hand
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
    IF t.action = 'leave_policy' THEN
      RAISE EXCEPTION 'Open the leave policy and press “I’ve read it” to complete this step.';
    END IF;
  END IF;
  UPDATE onboarding_tasks SET
    done_at = CASE WHEN p_done THEN COALESCE(done_at, now()) END,
    done_by = CASE WHEN p_done THEN COALESCE(done_by, auth.uid()) END
  WHERE id = p_task;
END;
$$;
