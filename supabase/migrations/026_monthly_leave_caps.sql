-- ============================================================
-- Sproutbien — Monthly limits on Casual / Earned leave
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- For months with many public holidays an admin can limit how many paid
-- Casual + Earned days each employee takes in that month (e.g. Oct 2026: 2).
--   • Counted by the days that fall in the month (a leave from 30 Oct to
--     4 Nov uses October's limit for 30–31 Oct only). Half days are 0.5.
--   • Paid days of a leave are its earliest dates (as before), so a leave
--     stops being paid at the first day over a limit; the rest is Loss of Pay.
--   • Days over the limit become Loss of Pay automatically — no refusal and no
--     "use what's left" consent needed (that's still asked for a short balance).
--   • A new request counts the employee's approved and pending leave in the
--     month; approval counts approved leave only (first approved, first paid),
--     the same way the balance works.
--   • Sick Leave and Loss of Pay are never limited.
--   • Leave approved before a limit was set keeps its paid days.
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_month_caps (
  month      date          PRIMARY KEY CHECK (extract(day FROM month) = 1),   -- first of the month
  max_days   numeric(4, 1) NOT NULL CHECK (max_days >= 0 AND max_days * 2 = floor(max_days * 2)),
  note       text,
  created_at timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE leave_month_caps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leave_month_caps: everyone reads"
  ON leave_month_caps FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "leave_month_caps: admin insert"
  ON leave_month_caps FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "leave_month_caps: admin update"
  ON leave_month_caps FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "leave_month_caps: admin delete"
  ON leave_month_caps FOR DELETE USING (is_admin());

-- Leave types the monthly limits apply to
CREATE OR REPLACE FUNCTION leave_type_month_capped(p_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_type IN ('casual', 'earned')
$$;

-- Paid days of a leave that fall in p_month, when its p_paid days are its earliest working dates
CREATE OR REPLACE FUNCTION leave_paid_in_month(p_start date, p_end date, p_duration text, p_paid numeric, p_month date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH w AS (
    SELECT g.d::date AS d, row_number() OVER (ORDER BY g.d) AS n,
           CASE WHEN p_duration = 'half' THEN 0.5 ELSE 1 END AS portion
    FROM generate_series(p_start, p_end, interval '1 day') AS g(d)
    WHERE extract(dow FROM g.d) <> 0
      AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.date = g.d::date)
  )
  SELECT COALESCE(sum(least(portion, greatest(0, COALESCE(p_paid, 0) - (n - 1) * portion))), 0)
  FROM w
  WHERE date_trunc('month', d)::date = p_month
$$;

-- Paid Casual + Earned days an employee has in a month: approved leave, plus
-- pending leave (its planned paid part) when p_with_pending. p_exclude = the request being checked.
CREATE OR REPLACE FUNCTION leave_month_capped_used(p_employee uuid, p_month date, p_exclude uuid, p_with_pending boolean)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(leave_paid_in_month(r.start_date, r.end_date, r.duration,
           CASE WHEN r.status = 'approved' THEN COALESCE(r.paid_days, r.days)
                ELSE COALESCE(r.planned_paid_days, r.days) END,
           p_month)), 0)
  FROM leave_requests r
  WHERE r.employee_id = p_employee
    AND leave_type_month_capped(r.leave_type)
    AND (r.status = 'approved' OR (p_with_pending AND r.status = 'pending'))
    AND r.id IS DISTINCT FROM p_exclude
    AND r.start_date < (p_month + interval '1 month')::date
    AND r.end_date >= p_month
$$;

-- Most paid days a leave can have under the monthly limits (ignoring the balance):
-- walks its working dates in order and stops at the first one over a limit.
CREATE OR REPLACE FUNCTION leave_cap_paid(
  p_employee uuid, p_type text, p_start date, p_end date, p_duration text,
  p_exclude uuid, p_with_pending boolean
)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_portion numeric := CASE WHEN p_duration = 'half' THEN 0.5 ELSE 1 END;
  v_paid    numeric := 0;
  v_month   date;
  v_max     numeric;
  v_left    numeric;   -- NULL = no limit this month
  v_take    numeric;
  d         date;
BEGIN
  IF NOT leave_type_month_capped(p_type) THEN
    RETURN leave_working_days(p_start, p_end, p_duration);
  END IF;

  FOR d IN
    SELECT g.d::date FROM generate_series(p_start, p_end, interval '1 day') AS g(d)
    WHERE extract(dow FROM g.d) <> 0
      AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.date = g.d::date)
    ORDER BY 1
  LOOP
    IF v_month IS DISTINCT FROM date_trunc('month', d)::date THEN
      v_month := date_trunc('month', d)::date;
      SELECT c.max_days INTO v_max FROM leave_month_caps c WHERE c.month = v_month;
      v_left := CASE WHEN v_max IS NULL THEN NULL
                     ELSE greatest(0, v_max - leave_month_capped_used(p_employee, v_month, p_exclude, p_with_pending)) END;
    END IF;

    IF v_left IS NULL THEN
      v_paid := v_paid + v_portion;
    ELSE
      v_take := least(v_portion, v_left);
      v_paid := v_paid + v_take;
      v_left := v_left - v_take;
      IF v_take < v_portion THEN RETURN v_paid; END IF;
    END IF;
  END LOOP;
  RETURN v_paid;
END;
$$;

-- ── Employee: what the limits mean for a leave they're about to request ──
-- { "cap_paid": 2, "months": [{ "month": "2026-10-01", "max_days": 2, "used": 0.5, "note": "Diwali" }] }
-- cap_paid = paid days the limits allow (the balance is checked separately).

CREATE OR REPLACE FUNCTION leave_cap_preview(p_start date, p_end date, p_duration text, p_type text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN jsonb_build_object(
    'cap_paid', leave_cap_paid(auth.uid(), p_type, p_start, p_end, p_duration, NULL, true),
    'months', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'month', c.month, 'max_days', c.max_days, 'note', c.note,
               'used', leave_month_capped_used(auth.uid(), c.month, NULL, true))
             ORDER BY c.month)
      FROM leave_month_caps c
      WHERE c.month BETWEEN date_trunc('month', p_start)::date AND p_end), '[]'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION leave_cap_preview(date, date, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION leave_cap_preview(date, date, text, text) TO authenticated;

-- ── Paid days a request would get if approved now ───────────
-- Balance as of the leave's start (this request not counted), then the monthly limits.

CREATE OR REPLACE FUNCTION leave_paid_on_approval(r leave_requests)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_days      numeric := COALESCE(r.days, leave_working_days(r.start_date, r.end_date, r.duration));
  v_available numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM leave_types WHERE code = r.leave_type AND is_paid) THEN
    RETURN 0;
  END IF;
  SELECT b.available INTO v_available
  FROM leave_balances(r.employee_id, r.start_date) b
  WHERE b.leave_type = r.leave_type;
  RETURN least(v_days,
               greatest(0, floor(COALESCE(v_available, 0) * 2) / 2),
               leave_cap_paid(r.employee_id, r.leave_type, r.start_date, r.end_date, r.duration, r.id, false));
END;
$$;

-- Admin: preview for a pending request, so the queue can show the Loss of Pay part
-- { "paid": 1, "cap_paid": 1 }  (cap_paid < days → a monthly limit applies)
CREATE OR REPLACE FUNCTION leave_approval_preview(p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r leave_requests;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO r FROM leave_requests WHERE id = p_request;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'paid', leave_paid_on_approval(r),
    'cap_paid', leave_cap_paid(r.employee_id, r.leave_type, r.start_date, r.end_date, r.duration, r.id, false));
END;
$$;

REVOKE EXECUTE ON FUNCTION leave_approval_preview(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION leave_approval_preview(uuid) TO authenticated;

-- ── New requests: same as migration 022, plus the monthly limits ──

CREATE OR REPLACE FUNCTION check_leave_balance()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type   leave_types;
  v_bal    record;
  v_days   numeric := leave_working_days(NEW.start_date, NEW.end_date, NEW.duration);
  v_free   numeric;
  v_paid   numeric;   -- what the balance covers
  v_cap    numeric;   -- what the monthly limits allow
  v_target numeric;   -- paid days wanted after the limits
BEGIN
  NEW.planned_paid_days := NULL;   -- only ever set here

  SELECT * INTO v_type FROM leave_types WHERE code = NEW.leave_type;
  IF NOT COALESCE(v_type.is_paid, false) THEN
    NEW.split_with_lop := false;
    RETURN NEW;
  END IF;

  -- Same per-employee lock as the overlap check, so two requests at once can't both fit
  PERFORM pg_advisory_xact_lock(hashtext('leave:' || NEW.employee_id::text));

  SELECT b.available, b.pending INTO v_bal
  FROM leave_balances(NEW.employee_id, leave_bookable_as_of(NEW.start_date)) b
  WHERE b.leave_type = NEW.leave_type;

  v_free   := greatest(0, COALESCE(v_bal.available, 0) - COALESCE(v_bal.pending, 0));
  v_paid   := floor(v_free * 2) / 2;   -- leave is taken in half days
  v_cap    := leave_cap_paid(NEW.employee_id, NEW.leave_type, NEW.start_date, NEW.end_date, NEW.duration, NULL, true);
  v_target := least(v_days, v_cap);

  -- Balance short of what the limits allow: their consent is needed, as before
  IF v_paid < v_target THEN
    IF NEW.split_with_lop AND v_paid > 0 THEN
      NEW.planned_paid_days := v_paid;
      RETURN NEW;
    END IF;
    IF v_paid = 0 THEN
      RAISE EXCEPTION 'You have no % left%. Choose another leave type or Loss of Pay.',
        v_type.name,
        CASE WHEN COALESCE(v_bal.pending, 0) > 0
             THEN ' (' || trim_scale(v_bal.pending) || ' day(s) are waiting for approval)' ELSE '' END;
    END IF;
    RAISE EXCEPTION 'Not enough %: this request needs % day(s) but only % % available%. Pick fewer days, choose Loss of Pay, or take the rest as Loss of Pay.',
      v_type.name, trim_scale(v_target), trim_scale(v_free),
      CASE WHEN v_free = 1 THEN 'is' ELSE 'are' END,
      CASE WHEN COALESCE(v_bal.pending, 0) > 0
           THEN ' (after ' || trim_scale(v_bal.pending) || ' day(s) waiting for approval)' ELSE '' END;
  END IF;

  -- Over a monthly limit: the rest is Loss of Pay automatically
  IF v_target < v_days THEN
    NEW.planned_paid_days := v_target;
    NEW.split_with_lop := true;
    RETURN NEW;
  END IF;

  NEW.split_with_lop := false;   -- it all fits; nothing to split
  RETURN NEW;
END;
$$;

-- ── Approval: same as migration 014, with paid days from leave_paid_on_approval() ──

CREATE OR REPLACE FUNCTION handle_leave_approval()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    NEW.days      := COALESCE(NEW.days, leave_working_days(NEW.start_date, NEW.end_date, NEW.duration));
    NEW.paid_days := leave_paid_on_approval(NEW);
    NEW.lop_days  := NEW.days - NEW.paid_days;

    PERFORM apply_leave_to_attendance(NEW.employee_id, NEW.start_date, NEW.end_date,
                                      NEW.duration, NEW.half_day_session, NEW.paid_days);

    IF NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Cancel today's part: same as migration 025, except paid days freed by the
-- cancelled part move to later days only as far as the monthly limits allow ──

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
    -- Worked out after the earlier part is saved, so its days count towards the limits
    IF v_paid IS NOT NULL THEN
      v_paid_a := least(v_paid - v_paid_b, v_after,
                        leave_cap_paid(r.employee_id, r.leave_type, v_cut_end + 1, r.end_date, 'full',
                                       p_id, r.status = 'pending'));
    END IF;
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
