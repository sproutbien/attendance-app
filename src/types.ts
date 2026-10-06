export type EmployeeStatus =
  | 'active' | 'probation' | 'on_notice' | 'on_long_leave'
  | 'resigned' | 'terminated' | 'inactive'

export type Employee = {
  id: string
  employee_code: string           // "SB001"; auto-assigned, editable by admins
  full_name: string
  email: string
  role: 'employee' | 'admin'
  department: string | null
  designation: string | null      // job title, e.g. "Senior Designer"
  status: EmployeeStatus
  monthly_salary: number | null
  phone: string | null            // WhatsApp number, digits with country code
  joining_date: string | null     // leave accrues from this month; null = full year
  photo_path: string | null       // object path in the 'avatars' storage bucket
  employment_type: string | null
  work_location: string | null
  reporting_manager_id: string | null
  last_working_day: string | null // on notice / resigned / terminated
  emergency_contact_name: string | null
  emergency_contact_relation: string | null
  emergency_contact_phone: string | null
  contact_updated_at: string | null  // employee last edited their contact details (migration 040)
  probation_end_date: string | null
  must_change_password: boolean   // still on the admin's temporary password (migration 033)
  selfie_rule: 'default' | 'always' | 'never'
  geofence_rule: 'default' | 'always' | 'never' // location check at check-in (migration 037)   // check-in selfie: follow the company setting or override
  deleted_at: string | null       // set while in the bin; purged 6 months later
  created_at: string
}

export type EmployeeOptionKind = 'department' | 'work_location' | 'employment_type'

export type EmployeeOption = {
  id: string
  kind: EmployeeOptionKind
  name: string
  // Office area for a work location (migration 037); all null = not checked
  lat?: number | null
  lng?: number | null
  radius_m?: number | null
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
  selfie_path: string | null           // check-in selfie in 'checkin-selfies' (deleted after 15 days)
  selfie_missing_reason: string | null // checked in without the required selfie, and why
  // Location check at check-in (migration 037); coordinates are cleared after 30 days
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_accuracy_m: number | null
  check_in_distance_m: number | null
  geofence_status: 'inside' | 'unsure' | 'outside' | 'no_location' | null
  geofence_location: string | null
  geofence_note: string | null
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
  reason: string                   // may be empty when there's a voice note
  voice_note_path: string | null   // object in the 'leave-voice-notes' bucket
  voice_note_seconds: number | null
  split_with_lop: boolean          // employee agreed: use what's left of the type, rest as LOP
  planned_paid_days: number | null // paid part of a split request, set by the server at request time
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  requested_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  cancelled_at: string | null
  cancelled_after_approval: boolean
  cancel_seen_at: string | null    // when an admin dismissed the in-app cancellation alert
}

export type LeaveDocument = {
  id: string
  leave_id: string
  employee_id: string
  path: string          // object in the 'leave-documents' bucket
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: string | null
  uploaded_at: string
}

export type CandidateStage = 'applied' | 'interview' | 'offer' | 'hired' | 'not_selected'

/** Someone applying for a job. See migration 030. */
export type Candidate = {
  id: string
  full_name: string
  role: string | null           // position applied for
  email: string | null
  phone: string | null
  source: string | null         // e.g. Referral, LinkedIn
  notes: string
  stage: CandidateStage
  stage_changed_at: string
  resume_path: string | null    // object in the 'candidate-resumes' bucket
  resume_name: string | null
  resume_type: string | null
  resume_size: number | null
  employee_id: string | null    // set when hired
  created_by: string | null
  created_at: string
}

/** Kinds of HR document kept per employee. Must match employee_document_category_ok() in migration 029. */
export type DocCategory = 'Offer letter' | 'ID proof' | 'PAN card' | 'Bank proof' | 'Certificates' | 'Other'

export type EmployeeDocument = {
  id: string
  employee_id: string
  category: DocCategory
  path: string          // object in the 'employee-documents' bucket
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: string | null
  uploaded_at: string
  resend_reason: string | null        // HR asked for it again (migration 039)
  resend_requested_at: string | null
}

/** HR passed an employee's onboarding documents (migration 039). */
export type OnboardingReview = {
  employee_id: string
  verified_at: string
  verified_by: string | null
  seen_at: string | null              // employee pressed Done on the notice
}

/** One step of an onboarding checklist (a template row has the same shape minus employee / done). */
export type OnboardingTask = {
  id: string
  employee_id: string
  title: string
  details: string | null
  assignee: 'admin' | 'employee'
  document_category: DocCategory | null   // done by uploading a document of this kind
  action: 'leave_policy' | null           // done by acknowledging the leave policy
  sort_order: number
  done_at: string | null
  done_by: string | null
  created_at: string
}

/** The admin's part of the leave policy (the rest comes from live settings). See migration 031. */
export type LeavePolicy = {
  additional_rules: string
  version: number            // times published to everyone; 0 = never
  published_at: string | null
  published_by: string | null
}

export type OnboardingTemplateTask = Pick<OnboardingTask, 'id' | 'title' | 'details' | 'assignee' | 'document_category' | 'sort_order'>

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

/** A holiday employees take on one of several dates (e.g. Onam: 27 or 28 Aug). See migration 027. */
export type HolidayChoice = {
  id: string
  name: string
  pick_count: number      // how many of the dates each employee takes
  choose_by: string       // last day employees can choose; the defaults apply after it
  opens_on: string | null // first day employees can choose and see it; null = straight away (migration 041)
  dates: HolidayChoiceDate[]
}

export type HolidayChoiceDate = {
  date: string
  is_default: boolean     // given to anyone who hasn't chosen by the deadline
  max_people: number | null
}

/** Admin-set limit on paid Casual + Earned days per employee in one month. See migration 026. */
export type LeaveMonthCap = {
  month: string        // first of the month, "YYYY-MM-01"
  max_days: number
  note: string | null
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

/** Times are "HH:MM:SS" (Asia/Kolkata, same day). See migration 020. */
export type Shift = {
  id: string
  name: string
  start_time: string
  end_time: string
  late_after: string       // check-in after this is Late
  half_day_after: string   // check-in after this makes the morning a half-day leave
  split_time: string       // morning / afternoon boundary
  min_break_minutes: number  // full days: at least this much break is deducted from worked hours
  is_default: boolean
}

export type EmployeeShift = {
  employee_id: string
  effective_from: string   // "YYYY-MM-DD"
  shift_id: string
}

export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

/** Work another shift on one day (migration 042). Approved ones drive shift_for(). */
export type ShiftChange = {
  id: string
  employee_id: string
  date: string
  shift_id: string
  from_shift_id: string | null
  reason: string
  status: RequestStatus
  admin_note: string | null
  requested_by: string | null
  requested_at: string
  reviewed_at: string | null
}

/** A few hours out on one day, made up the same day (migration 042). */
export type PermissionRequest = {
  id: string
  employee_id: string
  date: string
  start_time: string   // "14:00:00"
  end_time: string
  reason: string
  status: RequestStatus
  admin_note: string | null
  requested_at: string
  reviewed_at: string | null
}
