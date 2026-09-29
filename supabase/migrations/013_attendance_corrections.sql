-- ============================================================
-- Sproutbien — Attendance correction requests
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Employees ask to fix their check-in and/or check-out time for a day in the
-- last 7 days (today included). An admin approves (optionally adjusting the
-- times) or rejects. Approval writes the times onto attendance_records and
-- re-applies the late / half-day rules. Times are Asia/Kolkata.
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date                 date        NOT NULL,
  -- What the employee asks for; NULL = leave that time as it is
  requested_check_in   timestamptz,
  requested_check_out  timestamptz,
  reason               text        NOT NULL CHECK (length(trim(reason)) > 0),
  -- The record as it was when the request was made
  original_check_in    timestamptz,
  original_check_out   timestamptz,
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'approved', 'rejected')),
  -- What the admin actually applied (may differ from the request)
  approved_check_in    timestamptz,
  approved_check_out   timestamptz,
  admin_note           text,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_by          uuid        REFERENCES employees(id),
  reviewed_at          timestamptz,
  CHECK (requested_check_in IS NOT NULL OR requested_check_out IS NOT NULL)
);

-- One open request per employee per day
CREATE UNIQUE INDEX IF NOT EXISTS attendance_corrections_one_pending
  ON attendance_corrections (employee_id, date) WHERE status = 'pending';

ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corrections: own row or admin"
  ON attendance_corrections FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

CREATE POLICY "corrections: employee insert own"
  ON attendance_corrections FOR INSERT
  WITH CHECK (employee_id = auth.uid());

-- Employees can withdraw a request that hasn't been decided yet
CREATE POLICY "corrections: withdraw own pending"
  ON attendance_corrections FOR DELETE
  USING (employee_id = auth.uid() AND status = 'pending');

-- Admins reject directly; approval goes through approve_attendance_correction()
CREATE POLICY "corrections: admin update"
  ON attendance_corrections FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── Validate new requests ───────────────────────────────────

CREATE OR REPLACE FUNCTION check_attendance_correction()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_rec   attendance_records;
BEGIN
  IF NEW.date > v_today OR NEW.date < v_today - 6 THEN
    RAISE EXCEPTION 'Corrections can only be requested for the last 7 days';
  END IF;
  IF (NEW.requested_check_in  IS NOT NULL AND (NEW.requested_check_in  AT TIME ZONE 'Asia/Kolkata')::date <> NEW.date)
  OR (NEW.requested_check_out IS NOT NULL AND (NEW.requested_check_out AT TIME ZONE 'Asia/Kolkata')::date <> NEW.date) THEN
    RAISE EXCEPTION 'Corrected times must be on the day being corrected';
  END IF;
  IF NEW.requested_check_in > now() OR NEW.requested_check_out > now() THEN
    RAISE EXCEPTION 'Corrected times can''t be in the future';
  END IF;

  SELECT * INTO v_rec FROM attendance_records
  WHERE employee_id = NEW.employee_id AND date = NEW.date;

  IF COALESCE(NEW.requested_check_in, v_rec.check_in_time) IS NULL THEN
    RAISE EXCEPTION 'There''s no check-in for this day, so please include your check-in time';
  END IF;
  IF COALESCE(NEW.requested_check_out, v_rec.check_out_time) <= COALESCE(NEW.requested_check_in, v_rec.check_in_time) THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;

  -- Server decides these, whatever the client sent
  NEW.status             := 'pending';
  NEW.original_check_in  := v_rec.check_in_time;
  NEW.original_check_out := v_rec.check_out_time;
  NEW.approved_check_in  := NULL;
  NEW.approved_check_out := NULL;
  NEW.admin_note         := NULL;
  NEW.reviewed_by        := NULL;
  NEW.reviewed_at        := NULL;
  NEW.requested_at       := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_attendance_correction_insert ON attendance_corrections;
CREATE TRIGGER on_attendance_correction_insert
  BEFORE INSERT ON attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION check_attendance_correction();

-- ── Status for a check-in time (mirrors checkInFields() in useAttendance.ts) ──
--   ≤ 9:40 present · 9:41–11:30 late · after 11:30 morning half day
--   On a morning half day: present until 1:30 PM, late after.

CREATE OR REPLACE FUNCTION check_in_status(p_check_in timestamptz, p_session text, OUT status text, OUT session text)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_local   timestamp := p_check_in AT TIME ZONE 'Asia/Kolkata';
  v_minutes integer   := extract(hour FROM v_local)::integer * 60 + extract(minute FROM v_local)::integer;
BEGIN
  session := COALESCE(p_session, CASE WHEN v_minutes > 11 * 60 + 30 THEN 'morning' END);
  IF session = 'morning' THEN
    status := CASE WHEN v_minutes <= 13 * 60 + 30 THEN 'present' ELSE 'late' END;
  ELSE
    status := CASE WHEN v_minutes <= 9 * 60 + 40 THEN 'present' ELSE 'late' END;
  END IF;
END;
$$;

-- ── Approve (admin), optionally with adjusted times ─────────
-- p_check_in / p_check_out NULL = keep what's on the record.

CREATE OR REPLACE FUNCTION approve_attendance_correction(
  p_id        uuid,
  p_check_in  timestamptz,
  p_check_out timestamptz,
  p_note      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c          attendance_corrections;
  v_rec      attendance_records;
  v_in       timestamptz;
  v_out      timestamptz;
  v_leave    text;   -- session of an approved half-day leave on that date
  v_result   record;
  v_breaks   integer;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve corrections';
  END IF;

  SELECT * INTO c FROM attendance_corrections WHERE id = p_id FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'Correction request not found';
  END IF;
  IF c.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been %', c.status;
  END IF;

  SELECT * INTO v_rec FROM attendance_records
  WHERE employee_id = c.employee_id AND date = c.date FOR UPDATE;

  v_in  := COALESCE(p_check_in,  v_rec.check_in_time);
  v_out := COALESCE(p_check_out, v_rec.check_out_time);

  IF v_in IS NULL THEN
    RAISE EXCEPTION 'A check-in time is needed';
  END IF;
  IF (v_in AT TIME ZONE 'Asia/Kolkata')::date <> c.date
  OR (v_out IS NOT NULL AND (v_out AT TIME ZONE 'Asia/Kolkata')::date <> c.date) THEN
    RAISE EXCEPTION 'Times must be on the day being corrected';
  END IF;
  IF v_out IS NOT NULL AND v_out <= v_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;
  IF v_in > now() OR v_out > now() THEN
    RAISE EXCEPTION 'Times can''t be in the future';
  END IF;

  -- Re-derive late / half day from the corrected check-in. Only an approved
  -- half-day leave keeps its session; an automatic one (late check-in) is recomputed.
  SELECT half_day_session INTO v_leave FROM leave_requests
  WHERE employee_id = c.employee_id AND status = 'approved' AND duration = 'half'
    AND start_date = c.date
  LIMIT 1;
  SELECT * INTO v_result FROM check_in_status(v_in, v_leave);

  -- A break still running at check-out ends at check-out
  v_breaks := COALESCE(v_rec.break_seconds, 0);
  IF v_rec.break_started_at IS NOT NULL AND v_out IS NOT NULL THEN
    v_breaks := v_breaks + GREATEST(0, floor(extract(epoch FROM v_out - v_rec.break_started_at)))::integer;
  END IF;

  INSERT INTO attendance_records
    (employee_id, date, check_in_time, check_out_time, status, half_day_session, break_seconds, break_started_at)
  VALUES
    (c.employee_id, c.date, v_in, v_out, v_result.status, v_result.session, v_breaks,
     CASE WHEN v_out IS NULL THEN v_rec.break_started_at END)
  ON CONFLICT (employee_id, date) DO UPDATE SET
    check_in_time    = EXCLUDED.check_in_time,
    check_out_time   = EXCLUDED.check_out_time,
    status           = EXCLUDED.status,
    half_day_session = EXCLUDED.half_day_session,
    break_seconds    = EXCLUDED.break_seconds,
    break_started_at = EXCLUDED.break_started_at;

  UPDATE attendance_corrections SET
    status             = 'approved',
    approved_check_in  = v_in,
    approved_check_out = v_out,
    admin_note         = NULLIF(trim(p_note), ''),
    reviewed_by        = auth.uid(),
    reviewed_at        = now()
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION approve_attendance_correction(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION approve_attendance_correction(uuid, timestamptz, timestamptz, text) TO authenticated;
