-- ============================================================
-- Sproutbien — Documents on sick leave
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • Sick leave (including Sick + Loss of Pay splits) can have up to 5
--     documents: PDF, PNG, JPEG, Word (.doc/.docx), 10 MB each. Optional.
--   • Employees add them while applying or later, up to 30 days after the
--     request was made, on pending or approved leave. Within those 30 days
--     they can also remove their own uploads. They can always view them.
--   • Admins can view, add and remove documents on any sick leave, any time.
--   • Files live in the private 'leave-documents' bucket under
--     <employee id>/<leave id>/…
--   • When cancel_leave_today() splits a leave, the kept parts keep the documents.
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_documents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_id    uuid        NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  employee_id uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  path        text        NOT NULL,     -- object in the 'leave-documents' bucket
  file_name   text        NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  mime_type   text        NOT NULL,
  size_bytes  integer     NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  uploaded_by uuid        REFERENCES employees(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_documents_own_folder CHECK (path LIKE employee_id::text || '/%')
);

CREATE INDEX IF NOT EXISTS leave_documents_leave_idx ON leave_documents (leave_id);

ALTER TABLE leave_documents ENABLE ROW LEVEL SECURITY;

-- Employee can still add/remove documents on this leave
CREATE OR REPLACE FUNCTION leave_documents_open(p_leave uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM leave_requests l
    WHERE l.id = p_leave
      AND l.employee_id = auth.uid()
      AND l.leave_type = 'sick'
      AND l.status IN ('pending', 'approved')
      AND now() <= l.requested_at + interval '30 days');
$$;

DROP POLICY IF EXISTS "leave_documents: own or admin read" ON leave_documents;
CREATE POLICY "leave_documents: own or admin read" ON leave_documents FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "leave_documents: own (open window) or admin insert" ON leave_documents;
CREATE POLICY "leave_documents: own (open window) or admin insert" ON leave_documents FOR INSERT
  WITH CHECK (is_admin() OR (employee_id = auth.uid() AND leave_documents_open(leave_id)));

DROP POLICY IF EXISTS "leave_documents: own upload (open window) or admin delete" ON leave_documents;
CREATE POLICY "leave_documents: own upload (open window) or admin delete" ON leave_documents FOR DELETE
  USING (is_admin() OR (employee_id = auth.uid() AND uploaded_by = auth.uid() AND leave_documents_open(leave_id)));

-- Sick leave only, 5 per leave, owner and uploader set by the server
CREATE OR REPLACE FUNCTION check_leave_document()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r leave_requests;
BEGIN
  SELECT * INTO r FROM leave_requests WHERE id = NEW.leave_id;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;
  IF r.leave_type <> 'sick' THEN
    RAISE EXCEPTION 'Documents can only be added to sick leave';
  END IF;
  NEW.employee_id := r.employee_id;
  NEW.uploaded_by := auth.uid();
  IF (SELECT count(*) FROM leave_documents WHERE leave_id = NEW.leave_id) >= 5 THEN
    RAISE EXCEPTION 'A leave can have at most 5 documents';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_document ON leave_documents;
CREATE TRIGGER on_leave_document
  BEFORE INSERT ON leave_documents
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION check_leave_document();

-- ── Storage ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('leave-documents', 'leave-documents', false, 10485760, ARRAY[
  'application/pdf', 'image/png', 'image/jpeg', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "leave-documents: own folder or admin insert" ON storage.objects;
CREATE POLICY "leave-documents: own folder or admin insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'leave-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "leave-documents: own folder or admin read" ON storage.objects;
CREATE POLICY "leave-documents: own folder or admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'leave-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- Files are removed after their row: employees only once nothing points at them
DROP POLICY IF EXISTS "leave-documents: unattached own or admin delete" ON storage.objects;
CREATE POLICY "leave-documents: unattached own or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'leave-documents'
    AND (public.is_admin() OR (
      (storage.foldername(name))[1] = auth.uid()::text
      AND NOT EXISTS (SELECT 1 FROM public.leave_documents d WHERE d.path = storage.objects.name))));

-- ── A split leave's kept parts keep its documents ───────────
CREATE OR REPLACE FUNCTION copy_split_leave_documents()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO leave_documents (leave_id, employee_id, path, file_name, mime_type, size_bytes, uploaded_by, uploaded_at)
  SELECT NEW.id, d.employee_id, d.path, d.file_name, d.mime_type, d.size_bytes, d.uploaded_by, d.uploaded_at
  FROM leave_documents d
  WHERE d.leave_id = current_setting('sb.leave_split_from', true)::uuid;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_split_documents ON leave_requests;
CREATE TRIGGER on_leave_split_documents
  AFTER INSERT ON leave_requests
  FOR EACH ROW WHEN (current_setting('sb.leave_split', true) = 'on')
  EXECUTE FUNCTION copy_split_leave_documents();

-- Same as migration 024, plus recording which leave is being split
CREATE OR REPLACE FUNCTION cancel_leave_today(p_id uuid, p_mode text DEFAULT 'onward')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          leave_requests;
  v_today    date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_cut_end  date;            -- last cancelled day
  v_before   numeric := 0;    -- working days kept before today
  v_after    numeric := 0;    -- working days kept after the cancelled part
  v_cut      numeric;
  v_paid     numeric;         -- paid days (approved) or planned paid days (pending) to share out
  v_paid_b   numeric := 0;
  v_paid_a   numeric := 0;
BEGIN
  IF p_mode NOT IN ('today', 'onward') THEN
    RAISE EXCEPTION 'Unknown cancel option';
  END IF;

  SELECT * INTO r FROM leave_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR r.employee_id <> auth.uid() THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;
  IF r.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Only pending or approved leave can be cancelled';
  END IF;
  IF r.duration <> 'full' OR v_today NOT BETWEEN r.start_date AND r.end_date THEN
    RAISE EXCEPTION 'This leave doesn''t cover today';
  END IF;
  IF EXISTS (SELECT 1 FROM attendance_records
             WHERE employee_id = r.employee_id AND date = v_today AND check_in_time IS NOT NULL) THEN
    RAISE EXCEPTION 'You''ve already checked in today';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('leave:' || r.employee_id::text));

  v_cut_end := CASE WHEN p_mode = 'today' THEN v_today ELSE r.end_date END;
  IF r.start_date < v_today THEN
    v_before := leave_working_days(r.start_date, v_today - 1, 'full');
  END IF;
  IF v_cut_end < r.end_date THEN
    v_after := leave_working_days(v_cut_end + 1, r.end_date, 'full');
  END IF;
  v_cut := leave_working_days(v_today, v_cut_end, 'full');

  -- Paid days stay on the earliest remaining dates
  v_paid := CASE WHEN r.status = 'approved' THEN r.paid_days ELSE r.planned_paid_days END;
  IF v_paid IS NOT NULL THEN
    v_paid_b := least(v_paid, v_before);
    v_paid_a := least(v_paid - v_paid_b, v_after);
  END IF;

  -- Take today's (and maybe later) days off the attendance sheet
  IF r.status = 'approved' THEN
    DELETE FROM attendance_records
    WHERE employee_id = r.employee_id
      AND date BETWEEN v_today AND v_cut_end
      AND check_in_time IS NULL AND status = 'on_leave';
  END IF;

  -- Kept days become their own requests (same status, reason, voice note, review)
  PERFORM set_config('sb.leave_split', 'on', true);
  PERFORM set_config('sb.leave_split_from', p_id::text, true);   -- documents follow the kept days
  IF v_before > 0 THEN
    INSERT INTO leave_requests (
      employee_id, start_date, end_date, duration, half_day_session, leave_type, reason,
      voice_note_path, voice_note_seconds, split_with_lop, planned_paid_days,
      status, requested_at, reviewed_by, reviewed_at, days, paid_days, lop_days)
    VALUES (
      r.employee_id, r.start_date, v_today - 1, 'full', NULL, r.leave_type, r.reason,
      r.voice_note_path, r.voice_note_seconds, r.split_with_lop,
      CASE WHEN r.status = 'pending' AND v_paid IS NOT NULL THEN v_paid_b END,
      r.status, r.requested_at, r.reviewed_by, r.reviewed_at, v_before,
      CASE WHEN r.status = 'approved' THEN v_paid_b END,
      CASE WHEN r.status = 'approved' THEN v_before - v_paid_b END);
  END IF;
  IF v_after > 0 THEN
    INSERT INTO leave_requests (
      employee_id, start_date, end_date, duration, half_day_session, leave_type, reason,
      voice_note_path, voice_note_seconds, split_with_lop, planned_paid_days,
      status, requested_at, reviewed_by, reviewed_at, days, paid_days, lop_days)
    VALUES (
      r.employee_id, v_cut_end + 1, r.end_date, 'full', NULL, r.leave_type, r.reason,
      r.voice_note_path, r.voice_note_seconds, r.split_with_lop,
      CASE WHEN r.status = 'pending' AND v_paid IS NOT NULL THEN v_paid_a END,
      r.status, r.requested_at, r.reviewed_by, r.reviewed_at, v_after,
      CASE WHEN r.status = 'approved' THEN v_paid_a END,
      CASE WHEN r.status = 'approved' THEN v_after - v_paid_a END);
    -- A freed paid day may now cover a day that was Loss of Pay
    IF r.status = 'approved' THEN
      PERFORM apply_leave_to_attendance(r.employee_id, v_cut_end + 1, r.end_date, 'full', NULL, v_paid_a);
    END IF;
  END IF;
  PERFORM set_config('sb.leave_split', 'off', true);

  -- The original request becomes the cancelled part (admin is notified as usual)
  UPDATE leave_requests SET
    start_date               = v_today,
    end_date                 = v_cut_end,
    days                     = v_cut,
    paid_days                = CASE WHEN r.status = 'approved' THEN greatest(0, least(v_cut, v_paid - v_paid_b - v_paid_a)) END,
    lop_days                 = CASE WHEN r.status = 'approved' THEN v_cut - greatest(0, least(v_cut, v_paid - v_paid_b - v_paid_a)) END,
    planned_paid_days        = NULL,
    status                   = 'cancelled',
    cancelled_at             = now(),
    cancelled_after_approval = (r.status = 'approved')
  WHERE id = p_id;
END;
$$;
