-- ============================================================
-- Sproutbien — Employees can cancel leave (pending or approved)
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- Cancelling is allowed until 10 minutes before the leave starts:
--   full day / morning half day → starts 9:30 AM  → cancel by 9:20 AM
--   afternoon half day          → starts 1:30 PM  → cancel by 1:20 PM
-- Times are Asia/Kolkata. Admins are told via WhatsApp and in the app.
-- ============================================================

-- ── New status + cancellation bookkeeping ───────────────────

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS cancelled_at            timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_after_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancel_seen_at          timestamptz;  -- set when an admin dismisses the in-app alert

-- ── Employees no longer update leave rows directly ──────────
-- The old policy let an employee edit their own pending request — including
-- setting status = 'approved'. Cancelling now goes through cancel_leave_request().

DROP POLICY IF EXISTS "leave: own pending update or admin" ON leave_requests;
DROP POLICY IF EXISTS "leave: admin update" ON leave_requests;
CREATE POLICY "leave: admin update"
  ON leave_requests FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── When a leave request starts ─────────────────────────────

CREATE OR REPLACE FUNCTION leave_starts_at(p_start date, p_session text)
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (p_start + CASE WHEN p_session = 'afternoon' THEN time '13:30' ELSE time '09:30' END)
         AT TIME ZONE 'Asia/Kolkata'
$$;

-- ── Cancel (called by the employee from the Leave page) ─────

CREATE OR REPLACE FUNCTION cancel_leave_request(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r leave_requests;
BEGIN
  SELECT * INTO r FROM leave_requests WHERE id = p_id FOR UPDATE;

  IF r.id IS NULL OR r.employee_id <> auth.uid() THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;
  IF r.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Only pending or approved leave can be cancelled';
  END IF;
  IF now() >= leave_starts_at(r.start_date, r.half_day_session) - interval '10 minutes' THEN
    RAISE EXCEPTION 'Too late to cancel: leave can be cancelled up to 10 minutes before it starts';
  END IF;

  -- Undo what approval put on the attendance sheet (days without a check-in)
  IF r.status = 'approved' THEN
    IF r.duration = 'half' THEN
      DELETE FROM attendance_records
      WHERE employee_id = r.employee_id AND date = r.start_date
        AND check_in_time IS NULL AND status = 'on_leave';
      UPDATE attendance_records SET half_day_session = NULL
      WHERE employee_id = r.employee_id AND date = r.start_date
        AND half_day_session = r.half_day_session;
    ELSE
      DELETE FROM attendance_records
      WHERE employee_id = r.employee_id
        AND date BETWEEN r.start_date AND r.end_date
        AND check_in_time IS NULL AND status = 'on_leave';
    END IF;
  END IF;

  UPDATE leave_requests SET
    status                   = 'cancelled',
    cancelled_at             = now(),
    cancelled_after_approval = (r.status = 'approved')
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_leave_request(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION cancel_leave_request(uuid) TO authenticated;

-- ── WhatsApp: also notify admins on cancellation ────────────

CREATE OR REPLACE FUNCTION notify_leave_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event  text;
  v_url    text;
  v_secret text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    v_event := 'leave_submitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('approved', 'rejected') THEN
    v_event := 'leave_reviewed';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status = 'cancelled' THEN
    v_event := 'leave_cancelled';
  ELSE
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'leave_whatsapp_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'leave_whatsapp_secret';

  -- Not configured yet: skip silently so leave requests keep working
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fire-and-forget; only the id is sent, the function re-reads the row itself
  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('event', v_event, 'leave_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    )
  );

  RETURN NEW;
END;
$$;
