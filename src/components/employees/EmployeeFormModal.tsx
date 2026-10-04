import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import {
  EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABELS, LEAVING_STATUSES, BLOCKED_STATUSES, fmtDate, normalizePhone,
} from '../../lib/employees'
import type { EmployeeFormData } from '../../hooks/useEmployeeManagement'
import { localDate } from '../../lib/calendar'
import { shiftHours } from '../../lib/shifts'
import type { Employee, EmployeeOption, EmployeeStatus, Shift } from '../../types'
import { errorBox, ghostBtn, hintStyle, inputStyle, modalStyle, overlayStyle, primaryBtn } from './styles'

/** Add / edit an employee's full profile. */
export default function EmployeeFormModal({ existing, prefill, isSelf, employees, options, shifts, currentShift, upcomingShift, designations, saving, error, onSave, onClose }: {
  existing: Employee | null         // null = add
  prefill?: Partial<Pick<Employee, 'full_name' | 'email' | 'phone' | 'designation' | 'status'>>   // add: start from these (e.g. a hired candidate)
  isSelf: boolean                   // the signed-in admin's own record: status and role are locked
  employees: Employee[]             // reporting-manager choices
  options: { department: EmployeeOption[]; work_location: EmployeeOption[]; employment_type: EmployeeOption[] }
  shifts: Shift[]
  currentShift: Shift | null        // today's (default shift for a new employee)
  upcomingShift: { shift: Shift; from: string } | null   // a change already scheduled
  designations: string[]            // already in use, offered as suggestions
  saving: boolean
  error: string | null
  onSave: (data: EmployeeFormData) => void
  onClose: () => void
}) {
  const isEdit = existing !== null
  const s = (v: string | null | undefined) => v ?? ''

  const [f, setF] = useState({
    employee_code:  s(existing?.employee_code),
    full_name:      s(existing?.full_name ?? prefill?.full_name),
    email:          s(existing?.email ?? prefill?.email),
    password:       '',
    role:           existing?.role ?? 'employee',
    status:         existing?.status ?? prefill?.status ?? 'active' as EmployeeStatus,
    last_working_day: s(existing?.last_working_day),
    employment_type: s(existing?.employment_type),
    department:     s(existing?.department),
    designation:    s(existing?.designation ?? prefill?.designation),
    work_location:  s(existing?.work_location),
    reporting_manager_id: s(existing?.reporting_manager_id),
    joining_date:   s(existing?.joining_date),
    salary:         existing?.monthly_salary != null ? String(existing.monthly_salary) : '',
    phone:          existing?.phone ? `+${existing.phone}` : prefill?.phone ?? '',
    ec_name:        s(existing?.emergency_contact_name),
    ec_relation:    s(existing?.emergency_contact_relation),
    ec_phone:       s(existing?.emergency_contact_phone),
    probation_end:  s(existing?.probation_end_date),
  })
  const [startOnboarding, setStartOnboarding] = useState(true)
  // Shift changes start tomorrow by default (today's attendance keeps today's shift); new staff start today
  const initialShiftId = upcomingShift?.shift.id ?? currentShift?.id ?? ''
  const initialShiftFrom = upcomingShift?.from ?? (isEdit ? tomorrow() : localDate())
  const [shiftId, setShiftId] = useState(initialShiftId)
  const [shiftFrom, setShiftFrom] = useState(initialShiftFrom)
  const shiftChanged = shiftId !== initialShiftId || (!!upcomingShift && shiftFrom !== initialShiftFrom)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF(prev => ({ ...prev, [key]: e.target.value }))

  const leaving = LEAVING_STATUSES.includes(f.status)
  const managers = employees.filter(e => e.id !== existing?.id && !e.deleted_at && !BLOCKED_STATUSES.includes(e.status))

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const phone = normalizePhone(f.phone)
    if (phone === undefined) {
      setPhoneError('Enter a valid number with country code, e.g. +91 98765 43210')
      return
    }
    setPhoneError(null)
    const t = (v: string) => v.trim() || null
    onSave({
      employee_code:  t(f.employee_code),
      full_name:      f.full_name.trim(),
      email:          f.email,
      password:       f.password,
      role:           f.role,
      status:         f.status,
      last_working_day: leaving ? t(f.last_working_day) : null,
      employment_type: t(f.employment_type),
      department:     t(f.department),
      designation:    t(f.designation),
      work_location:  t(f.work_location),
      reporting_manager_id: t(f.reporting_manager_id),
      joining_date:   t(f.joining_date),
      monthly_salary: f.salary === '' ? null : Number(f.salary),
      phone,
      shift: shiftId && shiftChanged ? { id: shiftId, from: isEdit ? shiftFrom : localDate() } : null,
      emergency_contact_name:     t(f.ec_name),
      emergency_contact_relation: t(f.ec_relation),
      emergency_contact_phone:    t(f.ec_phone),
      probation_end_date: f.status === 'probation' ? t(f.probation_end) : existing?.probation_end_date ?? null,
      startOnboarding: isEdit ? undefined : startOnboarding,
    })
  }

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ ...modalStyle, maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>
            {isEdit ? 'Edit Employee' : 'Add Employee'}
          </h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <Section title="Basic details">
            <Grid>
              <Field label="Employee ID">
                <input type="text" value={f.employee_code} onChange={set('employee_code')} placeholder={isEdit ? '' : 'Auto (next SB number)'} maxLength={20} style={inputStyle} />
                {!isEdit && <p style={hintStyle}>Leave blank to assign the next number.</p>}
              </Field>
              <Field label="Full name">
                <input type="text" value={f.full_name} onChange={set('full_name')} required style={inputStyle} />
              </Field>
            </Grid>
            <Grid>
              <Field label="Email">
                <input
                  type="email" value={f.email} onChange={set('email')} required readOnly={isEdit}
                  style={{ ...inputStyle, background: isEdit ? '#f8fafc' : '#fff', color: isEdit ? '#94a3b8' : '#1e293b' }}
                />
                {isEdit && <p style={hintStyle}>Email can't be changed after the account is created.</p>}
              </Field>
              {isEdit ? (
                <Field label="WhatsApp / phone number">
                  <PhoneInput value={f.phone} error={phoneError} onChange={v => { setF(p => ({ ...p, phone: v })); setPhoneError(null) }} />
                </Field>
              ) : (
                <Field label="Temporary password">
                  <input type="password" value={f.password} onChange={set('password')} required minLength={6} style={inputStyle} />
                  <p style={hintStyle}>They use this to log in the first time.</p>
                </Field>
              )}
            </Grid>
            {!isEdit && (
              <Field label="WhatsApp / phone number (optional)">
                <PhoneInput value={f.phone} error={phoneError} onChange={v => { setF(p => ({ ...p, phone: v })); setPhoneError(null) }} />
              </Field>
            )}
          </Section>

          <Section title="Job">
            <Grid>
              <Field label="Employment type">
                <OptionSelect value={f.employment_type} onChange={set('employment_type')} options={options.employment_type} />
              </Field>
              <Field label="Department">
                <OptionSelect value={f.department} onChange={set('department')} options={options.department} />
              </Field>
            </Grid>
            <Grid>
              <Field label="Designation">
                <input type="text" value={f.designation} onChange={set('designation')} list="designation-options" placeholder="e.g. Senior Designer" maxLength={80} style={inputStyle} />
                <datalist id="designation-options">
                  {designations.map(d => <option key={d} value={d} />)}
                </datalist>
              </Field>
              <Field label="Work location">
                <OptionSelect value={f.work_location} onChange={set('work_location')} options={options.work_location} />
              </Field>
            </Grid>
            <Grid>
              <Field label="Reporting manager">
                <select value={f.reporting_manager_id} onChange={set('reporting_manager_id')} style={inputStyle}>
                  <option value="">— None —</option>
                  {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}{m.designation ? ` (${m.designation})` : ''}</option>)}
                </select>
              </Field>
              <Field label="Date of joining">
                <input type="date" value={f.joining_date} onChange={set('joining_date')} style={inputStyle} />
                <p style={hintStyle}>Paid leave is credited from this month. Before this date they can log in but not check in, and aren't marked Absent.</p>
              </Field>
            </Grid>
            <Grid>
              <Field label="Shift">
                <select value={shiftId} onChange={e => setShiftId(e.target.value)} style={inputStyle}>
                  {shifts.map(s => <option key={s.id} value={s.id}>{s.name} · {shiftHours(s)}{s.is_default ? ' (default)' : ''}</option>)}
                </select>
                {upcomingShift && !shiftChanged && (
                  <p style={hintStyle}>Moves to {upcomingShift.shift.name} on {fmtDate(upcomingShift.from)}.</p>
                )}
              </Field>
              {isEdit && (shiftChanged || upcomingShift) && (
                <Field label="Shift starts on">
                  <input type="date" value={shiftFrom} min={localDate()} onChange={e => setShiftFrom(e.target.value)} required style={inputStyle} />
                  <p style={hintStyle}>Days before this keep the current shift's rules.</p>
                </Field>
              )}
            </Grid>
            <Field label="Monthly gross salary (optional)">
              <input type="number" value={f.salary} onChange={set('salary')} min="0" step="1" placeholder="e.g. 50000" style={inputStyle} />
              <p style={hintStyle}>Used for payroll on the Reports page.</p>
            </Field>
          </Section>

          <Section title="Status & access">
            <Grid>
              <Field label="Employment status">
                <select value={f.status} onChange={set('status')} disabled={isSelf} style={inputStyle}>
                  {EMPLOYEE_STATUSES.map(st => <option key={st} value={st}>{EMPLOYEE_STATUS_LABELS[st]}</option>)}
                </select>
                <p style={{ ...hintStyle, color: BLOCKED_STATUSES.includes(f.status) ? '#dc2626' : hintStyle.color }}>
                  {isSelf ? "You can't change your own status." : STATUS_HINTS[f.status]}
                </p>
              </Field>
              <Field label="Role / permission level">
                <select value={f.role} onChange={set('role')} disabled={isSelf} style={inputStyle}>
                  <option value="employee">Employee</option>
                  <option value="admin">Admin</option>
                </select>
                <p style={hintStyle}>{isSelf ? "You can't change your own role." : 'Admins manage everything in the admin panel.'}</p>
              </Field>
            </Grid>
            {f.status === 'probation' && (
              <Field label="Probation ends (optional)">
                <input type="date" value={f.probation_end} onChange={set('probation_end')} min={f.joining_date || undefined} style={inputStyle} />
                <p style={hintStyle}>You're reminded on the Employees page two weeks before, with a button to make them Active.</p>
              </Field>
            )}
            {leaving && (
              <Field label="Last working day">
                <input type="date" value={f.last_working_day} onChange={set('last_working_day')} required={f.status === 'on_notice'} style={inputStyle} />
                <p style={hintStyle}>
                  {f.status === 'on_notice'
                    ? 'The day after this they become Resigned automatically and can no longer log in.'
                    : 'They stay in payroll up to this day.'}
                </p>
              </Field>
            )}
          </Section>

          <Section title="Emergency contact">
            <Grid>
              <Field label="Name">
                <input type="text" value={f.ec_name} onChange={set('ec_name')} style={inputStyle} />
              </Field>
              <Field label="Relationship">
                <input type="text" value={f.ec_relation} onChange={set('ec_relation')} placeholder="e.g. Father" style={inputStyle} />
              </Field>
            </Grid>
            <Field label="Phone">
              <input type="tel" value={f.ec_phone} onChange={set('ec_phone')} placeholder="+91 98765 43210" style={inputStyle} />
            </Field>
          </Section>

          {!isEdit && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', margin: '0 0 1rem', fontSize: '0.875rem', color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={startOnboarding} onChange={e => setStartOnboarding(e.target.checked)}
                style={{ width: 16, height: 16, marginTop: 2, accentColor: '#16a34a' }} />
              <span>
                Start the onboarding checklist
                <span style={{ display: 'block', ...hintStyle }}>They'll see their steps (documents to upload and so on) on their Dashboard.</span>
              </span>
            </label>
          )}

          {error && <div style={errorBox}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
            <button type="button" onClick={onClose} style={{ ...ghostBtn, padding: '0.625rem 1.25rem' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function tomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return localDate(d)
}

const STATUS_HINTS: Record<EmployeeStatus, string> = {
  active:        'Works normally.',
  probation:     'Works normally.',
  on_notice:     'Works normally until the last working day.',
  on_long_leave: "Can log in; days off aren't marked Absent.",
  resigned:      "Can't log in. Left out of attendance and leave.",
  terminated:    "Can't log in. Left out of attendance and leave.",
  inactive:      "Can't log in. Left out of attendance and leave.",
}

/** Dropdown from an admin-managed list; keeps an old value that's no longer in the list. */
function OptionSelect({ value, onChange, options }: {
  value: string
  onChange: (e: { target: { value: string } }) => void
  options: EmployeeOption[]
}) {
  const names = options.map(o => o.name)
  return (
    <select value={value} onChange={onChange} style={inputStyle}>
      <option value="">— Not set —</option>
      {value && !names.includes(value) && <option value={value}>{value}</option>}
      {names.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  )
}

function PhoneInput({ value, error, onChange }: { value: string; error: string | null; onChange: (v: string) => void }) {
  return (
    <>
      <input
        type="tel" value={value} onChange={e => onChange(e.target.value)} placeholder="+91 98765 43210"
        style={{ ...inputStyle, borderColor: error ? '#fca5a5' : '#d1d5db' }}
      />
      <p style={{ ...hintStyle, color: error ? '#dc2626' : hintStyle.color }}>
        {error ?? 'Leave notifications go here on WhatsApp.'}
      </p>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '0 0 0.5rem' }}>
      <legend style={legend}>{title}</legend>
      {children}
    </fieldset>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: '1rem' }}>{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem', color: '#374151' }}>{label}</label>
      {children}
    </div>
  )
}

const legend: CSSProperties = {
  padding: 0, marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#16a34a',
  textTransform: 'uppercase', letterSpacing: '0.06em',
}
