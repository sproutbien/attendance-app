-- ============================================================
-- Sproutbien Attendance Tracker — Initial Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employees (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text        NOT NULL,
  email       text        UNIQUE NOT NULL,
  role        text        NOT NULL DEFAULT 'employee'
                          CHECK (role IN ('employee', 'admin')),
  department  text,
  status      text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date            date        NOT NULL,
  check_in_time   timestamptz,
  check_out_time  timestamptz,
  status          text        NOT NULL DEFAULT 'absent'
                              CHECK (status IN ('present', 'absent', 'late', 'on_leave')),
  notes           text,
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date   date        NOT NULL,
  end_date     date        NOT NULL,
  reason       text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid        REFERENCES employees(id),
  reviewed_at  timestamptz
);

-- ── Enable RLS ───────────────────────────────────────────────

ALTER TABLE employees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests     ENABLE ROW LEVEL SECURITY;

-- ── Helper: is the calling user an admin? ────────────────────

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ── RLS policies: employees ──────────────────────────────────

CREATE POLICY "employees: own row or admin"
  ON employees FOR SELECT
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "employees: admin insert"
  ON employees FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "employees: own row update or admin"
  ON employees FOR UPDATE
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "employees: admin delete"
  ON employees FOR DELETE
  USING (is_admin());

-- ── RLS policies: attendance_records ─────────────────────────

CREATE POLICY "attendance: own row or admin"
  ON attendance_records FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

CREATE POLICY "attendance: own row insert or admin"
  ON attendance_records FOR INSERT
  WITH CHECK (employee_id = auth.uid() OR is_admin());

CREATE POLICY "attendance: own row update or admin"
  ON attendance_records FOR UPDATE
  USING (employee_id = auth.uid() OR is_admin());

CREATE POLICY "attendance: admin delete"
  ON attendance_records FOR DELETE
  USING (is_admin());

-- ── RLS policies: leave_requests ─────────────────────────────

CREATE POLICY "leave: own row or admin"
  ON leave_requests FOR SELECT
  USING (employee_id = auth.uid() OR is_admin());

CREATE POLICY "leave: employee insert own"
  ON leave_requests FOR INSERT
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "leave: own pending update or admin"
  ON leave_requests FOR UPDATE
  USING (
    (employee_id = auth.uid() AND status = 'pending') OR is_admin()
  );

CREATE POLICY "leave: admin delete"
  ON leave_requests FOR DELETE
  USING (is_admin());

-- ── Trigger: auto-create attendance rows on leave approval ───

CREATE OR REPLACE FUNCTION handle_leave_approval()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  d date;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    d := NEW.start_date;
    WHILE d <= NEW.end_date LOOP
      INSERT INTO attendance_records (employee_id, date, status)
      VALUES (NEW.employee_id, d, 'on_leave')
      ON CONFLICT (employee_id, date)
        DO UPDATE SET status = 'on_leave';
      d := d + INTERVAL '1 day';
    END LOOP;

    IF NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_leave_approved
  BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION handle_leave_approval();
