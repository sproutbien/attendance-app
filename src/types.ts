export type Employee = {
  id: string
  full_name: string
  email: string
  role: 'employee' | 'admin'
  department: string | null
  designation: string | null      // job title, e.g. "Senior Designer"
  status: 'active' | 'inactive'
  monthly_salary: number | null
  phone: string | null            // WhatsApp number, digits with country code
  created_at: string
}

export type HalfDaySession = 'morning' | 'afternoon'

export type AttendanceRecord = {
  id: string
  employee_id: string
  date: string
  check_in_time: string | null
  check_out_time: string | null
  break_started_at: string | null  // set while on a break
  break_seconds: number            // total of finished breaks that day
  status: 'present' | 'absent' | 'late' | 'on_leave'
  half_day_session: HalfDaySession | null  // set when half of this day is approved leave
  notes: string | null
}

export const STATUS_COLORS: Record<AttendanceRecord['status'], { bg: string; text: string }> = {
  present:  { bg: '#dcfce7', text: '#166534' },
  late:     { bg: '#fef9c3', text: '#854d0e' },
  absent:   { bg: '#fee2e2', text: '#991b1b' },
  on_leave: { bg: '#ede9fe', text: '#5b21b6' },
}

export type LeaveRequest = {
  id: string
  employee_id: string
  start_date: string
  end_date: string
  duration: 'full' | 'half'
  half_day_session: HalfDaySession | null  // only for half days (start_date = end_date)
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  requested_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  cancelled_at: string | null
  cancelled_after_approval: boolean
  cancel_seen_at: string | null    // when an admin dismissed the in-app cancellation alert
}

export const STATUS_LABELS: Record<AttendanceRecord['status'], string> = {
  present:  'Present',
  late:     'Late',
  absent:   'Absent',
  on_leave: 'On Leave',
}
