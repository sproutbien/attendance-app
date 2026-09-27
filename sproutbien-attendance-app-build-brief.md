# Sproutbien Attendance Tracker — Build Brief for Claude Code

Scale: under 15 employees. Check-in/out: simple button click (honor system, no geolocation/photo). Includes leave management. Stack: React frontend, Supabase (Postgres + Auth), hosted on Vercel.

---

## 1. Data Model

### `employees`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | matches Supabase auth user id |
| full_name | text | |
| email | text, unique | |
| role | text | `employee` or `admin` |
| department | text | optional |
| status | text | `active` / `inactive` |
| created_at | timestamptz | default now() |

### `attendance_records`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| employee_id | uuid, FK → employees.id | |
| date | date | one row per employee per day |
| check_in_time | timestamptz | nullable until they check in |
| check_out_time | timestamptz | nullable until they check out |
| status | text | `present`, `absent`, `late`, `on_leave` — computed or set |
| notes | text | optional admin edit note |

### `leave_requests`
| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| employee_id | uuid, FK → employees.id | |
| start_date | date | |
| end_date | date | |
| reason | text | |
| status | text | `pending`, `approved`, `rejected` |
| requested_at | timestamptz | default now() |
| reviewed_by | uuid, FK → employees.id | nullable, admin who actioned it |
| reviewed_at | timestamptz | nullable |

**Rule to implement:** when a leave request is approved, auto-generate `attendance_records` rows with `status = on_leave` for each date in the range, so the admin dashboard and reports reflect it automatically without manual entry.

---

## 2. Screens

### Employee side
1. **Login** — email/password via Supabase Auth.
2. **Home / Check-in dashboard**
   - Big "Check In" button (becomes "Check Out" once they've checked in that day)
   - Shows today's status and time
   - Shows their attendance history for the current month (simple table or calendar)
3. **Leave request page**
   - Form: start date, end date, reason
   - List of their own past requests with status

### Admin side
4. **Admin login** — same auth, routed by `role = admin`
5. **Admin dashboard (main view)**
   - Table/grid of all employees' attendance for a selected date or date range
   - Filters: by employee, by department, by date range, by status (present/absent/late/on leave)
   - Summary counts at the top (present today / absent today / on leave today)
6. **Leave approval queue**
   - List of pending leave requests with Approve/Reject buttons
7. **Employee management**
   - Add/edit/deactivate employees (name, email, role, department)
8. **Reports / export**
   - Monthly summary per employee (days present, absent, on leave, late)
   - CSV export button for payroll use

---

## 3. Build order (give this to Claude Code one step at a time)

1. Scaffold the React app + connect Supabase project (auth + the three tables above with row-level security so employees can only read/write their own records, and admins can read/write all).
2. Build employee login + check-in/check-out screen first — get this fully working end to end before moving on.
3. Build employee leave request form + their own request history.
4. Build admin dashboard (attendance grid + filters + summary counts).
5. Build admin leave approval queue, wired to auto-create attendance records on approval.
6. Build employee management screen (add/edit/deactivate).
7. Build reports/CSV export.
8. Seed with 5–10 test employees, run a full test week of check-ins/leave requests, then deploy to Vercel.

---

## 4. Notes for Claude Code prompts
- Ask for Supabase row-level security (RLS) policies explicitly — don't skip this, since employees should never be able to read each other's attendance directly through the API.
- Keep the employee UI to one main screen (check-in + own history) so it stays fast to use daily — most attendance apps fail because the daily-use screen is too cluttered.
- Build and test one screen at a time rather than asking for the whole app in one prompt.
