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
  joining_date: string | null     // leave accrues from this month; null = full year
  deleted_at: string | null       // set while in the bin; purged 6 months later
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
  paid_leave: number               // part of the day covered by paid leave (0, 0.5, 1)
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
  leave_type: LeaveTypeCode
  days: number | null              // working days (Sundays/holidays excluded), set by the server
  paid_days: number | null         // set on approval
  lop_days: number | null          // set on approval: days beyond the balance
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

export type AttendanceCorrection = {
  id: string
  employee_id: string
  date: string
  requested_check_in: string | null   // null = keep the recorded time
  requested_check_out: string | null
  reason: string
  original_check_in: string | null    // record at the time of the request
  original_check_out: string | null
  status: 'pending' | 'approved' | 'rejected'
  approved_check_in: string | null    // what the admin applied
  approved_check_out: string | null
  admin_note: string | null
  requested_at: string
  reviewed_by: string | null
  reviewed_at: string | null
}

export type LeaveTypeCode = 'casual' | 'sick' | 'earned' | 'lop'

export type LeaveType = {
  code: LeaveTypeCode
  name: string
  is_paid: boolean
  yearly_quota: number
  carry_forward_cap: number
  sort_order: number
}

/** One row of leave_balances(): a type's balance in the current leave year. */
export type LeaveBalance = {
  leave_type: LeaveTypeCode
  name: string
  is_paid: boolean
  yearly_quota: number
  carried: number
  accrued: number
  adjusted: number
  used: number
  pending: number
  available: number | null         // null for Loss of Pay
}

export type LeaveAdjustment = {
  id: string
  employee_id: string
  leave_type: LeaveTypeCode
  leave_year: number
  days: number
  reason: string
  created_by: string | null
  created_at: string
}
