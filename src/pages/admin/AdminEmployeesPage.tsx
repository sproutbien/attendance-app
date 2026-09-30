import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useEmployeeManagement } from '../../hooks/useEmployeeManagement'
import type { EmployeeFormData } from '../../hooks/useEmployeeManagement'
import type { Employee } from '../../types'

// ── Types ────────────────────────────────────────────────────

type ModalMode = { type: 'add' } | { type: 'edit'; employee: Employee }
type ConfirmMode = { type: 'bin' | 'purge'; employee: Employee }

// ── Helpers ──────────────────────────────────────────────────

/** "+91 98765 43210" / "9876543210" → "919876543210"; null if blank, undefined if invalid */
function normalizePhone(input: string): string | null | undefined {
  const digits = input.replace(/\D/g, '')
  if (digits === '') return null
  const full = digits.length === 10 ? `91${digits}` : digits // bare 10-digit = Indian mobile
  return /^[1-9][0-9]{7,14}$/.test(full) ? full : undefined
}

function fmtPhone(phone: string) {
  return phone.startsWith('91') && phone.length === 12
    ? `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`
    : `+${phone}`
}

/** Binned employees are permanently deleted this long after deletion (see migration 018) */
const BIN_MONTHS = 6

function purgeDate(deletedAt: string) {
  const d = new Date(deletedAt)
  d.setMonth(d.getMonth() + BIN_MONTHS)
  return d
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function initials(name: string) {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
}

const COLUMNS = ['Employee', 'Designation', 'Department', 'Role', '']

const ROLE_COLORS = {
  admin:    { bg: '#ede9fe', text: '#5b21b6' },
  employee: { bg: '#f0f9ff', text: '#0369a1' },
}

// ── Page ─────────────────────────────────────────────────────

export default function AdminEmployeesPage() {
  const { employee: me } = useAuth()
  const {
    employees, loading, saving, error, setError, addEmployee, updateEmployee, toggleStatus,
    binEmployee, restoreEmployee, purgeEmployee,
  } = useEmployeeManagement()
  const [modal, setModal] = useState<ModalMode | null>(null)
  const [confirm, setConfirm] = useState<ConfirmMode | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [showBin, setShowBin] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const binned   = employees.filter(e => e.deleted_at)
  const active   = employees.filter(e => !e.deleted_at && e.status === 'active')
  const inactive = employees.filter(e => !e.deleted_at && e.status === 'inactive')
  const designations = [...new Set(employees.map(e => e.designation).filter((d): d is string => !!d))].sort()

  async function handleSave(data: EmployeeFormData) {
    if (modal?.type === 'add') {
      const ok = await addEmployee(data)
      if (ok) {
        setModal(null)
        setSuccessMsg(`${data.full_name} added successfully.`)
        setTimeout(() => setSuccessMsg(null), 4000)
      }
    } else if (modal?.type === 'edit') {
      const ok = await updateEmployee(modal.employee.id, {
        full_name:      data.full_name.trim(),
        role:           data.role,
        department:     data.department.trim() || null,
        designation:    data.designation.trim() || null,
        monthly_salary: data.monthly_salary,
        phone:          data.phone,
        joining_date:   data.joining_date,
      })
      if (ok) {
        setModal(null)
        setSuccessMsg(`${data.full_name} updated.`)
        setTimeout(() => setSuccessMsg(null), 4000)
      }
    }
  }

  function flash(msg: string) {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 4000)
  }

  function askConfirm(type: ConfirmMode['type'], employee: Employee) {
    setConfirmError(null)
    setConfirm({ type, employee })
  }

  async function handleConfirm() {
    if (!confirm) return
    const { type, employee } = confirm
    const err = type === 'bin' ? await binEmployee(employee.id) : await purgeEmployee(employee.id)
    if (err) { setConfirmError(err); return }
    setConfirm(null)
    flash(type === 'bin'
      ? `${employee.full_name} moved to the bin.`
      : `${employee.full_name} permanently deleted.`)
  }

  async function handleRestore(employee: Employee) {
    const err = await restoreEmployee(employee.id)
    flash(err ?? `${employee.full_name} restored.`)
  }

  function openEdit(employee: Employee) {
    setError(null)
    setModal({ type: 'edit', employee })
  }

  function openAdd() {
    setError(null)
    setModal({ type: 'add' })
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>Employees</h1>
          {!loading && !showBin && (
            <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: '0.8125rem', fontWeight: 600, padding: '2px 10px', borderRadius: 99 }}>
              {active.length} active
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {showBin ? (
            <button onClick={() => setShowBin(false)} style={ghostBtn}>← Back to employees</button>
          ) : (
            <>
              <button onClick={() => setShowBin(true)} style={ghostBtn}>Bin ({binned.length})</button>
              <button onClick={openAdd} style={primaryBtn}>+ Add Employee</button>
            </>
          )}
        </div>
      </div>

      {successMsg && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#166534', fontSize: '0.875rem' }}>
          {successMsg}
        </div>
      )}

      {loading ? (
        <div style={{ ...card, color: '#94a3b8', padding: '2rem' }}>Loading…</div>
      ) : showBin ? (
        <BinList
          employees={binned}
          saving={saving}
          onRestore={handleRestore}
          onPurge={e => askConfirm('purge', e)}
        />
      ) : (
        <>
          {/* Active employees */}
          <div style={card}>
            <h2 style={sectionHeading}>Active ({active.length})</h2>
            {active.length === 0 ? (
              <p style={{ color: '#94a3b8', margin: 0 }}>No active employees yet.</p>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                    {COLUMNS.map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {active.map(e => (
                    <EmployeeRow
                      key={e.id}
                      employee={e}
                      onEdit={() => openEdit(e)}
                      onToggle={() => toggleStatus(e)}
                      onDelete={e.id === me?.id ? undefined : () => askConfirm('bin', e)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Inactive employees */}
          {inactive.length > 0 && (
            <div style={{ ...card, marginTop: '1.5rem' }}>
              <h2 style={sectionHeading}>Inactive ({inactive.length})</h2>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                    {COLUMNS.map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inactive.map(e => (
                    <EmployeeRow
                      key={e.id}
                      employee={e}
                      onEdit={() => openEdit(e)}
                      onToggle={() => toggleStatus(e)}
                      onDelete={e.id === me?.id ? undefined : () => askConfirm('bin', e)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modal */}
      {modal && (
        <EmployeeModal
          mode={modal}
          designations={designations}
          saving={saving}
          error={error}
          onSave={handleSave}
          onClose={() => { setModal(null); setError(null) }}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.type === 'bin' ? 'Delete employee?' : 'Delete permanently?'}
          confirmLabel={confirm.type === 'bin' ? 'Move to bin' : 'Delete forever'}
          saving={saving}
          error={confirmError}
          onConfirm={handleConfirm}
          onClose={() => setConfirm(null)}
        >
          {confirm.type === 'bin' ? (
            <>
              <strong>{confirm.employee.full_name}</strong> will be moved to the bin and can no longer log in.
              You can restore them from the bin within {BIN_MONTHS} months; after that they are deleted permanently.
            </>
          ) : (
            <>
              <strong>{confirm.employee.full_name}</strong> and all of their attendance, leave and correction
              records will be deleted permanently. This cannot be undone.
            </>
          )}
        </ConfirmModal>
      )}
    </div>
  )
}

// ── Bin ───────────────────────────────────────────────────────

function BinList({ employees, saving, onRestore, onPurge }: {
  employees: Employee[]
  saving: boolean
  onRestore: (e: Employee) => void
  onPurge: (e: Employee) => void
}) {
  return (
    <div style={card}>
      <h2 style={{ ...sectionHeading, marginBottom: '0.25rem' }}>Bin ({employees.length})</h2>
      <p style={{ ...hintStyle, margin: '0 0 1.25rem', fontSize: '0.8125rem' }}>
        Deleted employees stay here for {BIN_MONTHS} months, then are deleted permanently with all their records.
      </p>
      {employees.length === 0 ? (
        <p style={{ color: '#94a3b8', margin: 0 }}>The bin is empty.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              {['Employee', 'Deleted on', 'Deleted permanently on', ''].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map(e => {
              const purge = purgeDate(e.deleted_at!)
              const daysLeft = Math.max(0, Math.ceil((purge.getTime() - Date.now()) / 86_400_000))
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9375rem' }}>{e.full_name}</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>{e.email}</div>
                  </td>
                  <td style={{ ...tdStyle, color: '#64748b' }}>{fmtDate(new Date(e.deleted_at!))}</td>
                  <td style={{ ...tdStyle, color: '#64748b' }}>
                    {fmtDate(purge)} <span style={{ color: '#94a3b8' }}>({daysLeft} day{daysLeft === 1 ? '' : 's'} left)</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => onRestore(e)} disabled={saving} style={{ ...ghostBtn, color: '#16a34a', borderColor: '#bbf7d0' }}>Restore</button>
                    <button onClick={() => onPurge(e)} disabled={saving} style={{ ...ghostBtn, marginLeft: '0.5rem', color: '#dc2626', borderColor: '#fecaca' }}>Delete forever</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ConfirmModal({ title, confirmLabel, saving, error, onConfirm, onClose, children }: {
  title: string
  confirmLabel: string
  saving: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ ...modalStyle, maxWidth: 420 }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>{title}</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#475569', lineHeight: 1.5 }}>{children}</p>
        {error && (
          <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" onClick={onClose} style={{ ...ghostBtn, padding: '0.625rem 1.25rem' }}>Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            style={{ ...primaryBtn, background: '#dc2626', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Employee table row ────────────────────────────────────────

function EmployeeRow({ employee: e, onEdit, onToggle, onDelete }: {
  employee: Employee
  onEdit: () => void
  onToggle: () => void
  onDelete?: () => void             // absent for the signed-in admin's own row
}) {
  const roleColor = ROLE_COLORS[e.role as keyof typeof ROLE_COLORS] ?? ROLE_COLORS.employee
  const isActive = e.status === 'active'

  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9', opacity: isActive ? 1 : 0.6 }}>
      <td style={tdStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: isActive ? '#dcfce7' : '#f1f5f9',
            color: isActive ? '#166534' : '#94a3b8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0,
          }}>
            {initials(e.full_name)}
          </div>
          <div>
            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9375rem' }}>{e.full_name}</div>
            <div style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>
              {e.email}
              {e.phone
                ? <> · <span title="WhatsApp">{fmtPhone(e.phone)}</span></>
                : e.role === 'employee' && <> · <span style={{ color: '#d97706' }}>no WhatsApp number</span></>}
            </div>
          </div>
        </div>
      </td>
      <td style={tdStyle}>
        {e.designation
          ? <span style={{ color: '#1e293b', fontWeight: 500 }}>{e.designation}</span>
          : <button onClick={onEdit} style={{ ...ghostBtn, padding: '0.125rem 0.5rem', fontSize: '0.75rem', color: '#d97706', borderColor: '#fde68a' }}>+ Assign</button>}
      </td>
      <td style={{ ...tdStyle, color: '#64748b' }}>{e.department ?? '—'}</td>
      <td style={tdStyle}>
        <span style={{ padding: '2px 10px', borderRadius: 99, background: roleColor.bg, color: roleColor.text, fontWeight: 600, fontSize: '0.8125rem' }}>
          {e.role === 'admin' ? 'Admin' : 'Employee'}
        </span>
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        <button onClick={onEdit} style={ghostBtn}>Edit</button>
        <button
          onClick={onToggle}
          style={{ ...ghostBtn, marginLeft: '0.5rem', color: isActive ? '#dc2626' : '#16a34a', borderColor: isActive ? '#fecaca' : '#bbf7d0' }}
        >
          {isActive ? 'Deactivate' : 'Reactivate'}
        </button>
        {onDelete && (
          <button onClick={onDelete} style={{ ...ghostBtn, marginLeft: '0.5rem', color: '#dc2626', borderColor: '#fecaca' }}>
            Delete
          </button>
        )}
      </td>
    </tr>
  )
}

// ── Add / Edit modal ──────────────────────────────────────────

function EmployeeModal({ mode, designations, saving, error, onSave, onClose }: {
  mode: ModalMode
  designations: string[]            // already in use, offered as suggestions
  saving: boolean
  error: string | null
  onSave: (data: EmployeeFormData) => void
  onClose: () => void
}) {
  const isEdit = mode.type === 'edit'
  const existing = isEdit ? mode.employee : null

  const [fullName,   setFullName]   = useState(existing?.full_name  ?? '')
  const [email,      setEmail]      = useState(existing?.email       ?? '')
  const [password,   setPassword]   = useState('')
  const [role,       setRole]       = useState<'employee' | 'admin'>(existing?.role ?? 'employee')
  const [department, setDepartment] = useState(existing?.department  ?? '')
  const [designation, setDesignation] = useState(existing?.designation ?? '')
  const [salary,     setSalary]     = useState(existing?.monthly_salary != null ? String(existing.monthly_salary) : '')
  const [phone,      setPhone]      = useState(existing?.phone ? `+${existing.phone}` : '')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [joiningDate, setJoiningDate] = useState(existing?.joining_date ?? '')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizePhone(phone)
    if (normalized === undefined) {
      setPhoneError('Enter a valid number with country code, e.g. +91 98765 43210')
      return
    }
    setPhoneError(null)
    onSave({ full_name: fullName, email, password, role, department, designation, monthly_salary: salary === '' ? null : Number(salary), phone: normalized, joining_date: joiningDate || null })
  }

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' }}>
            {isEdit ? 'Edit Employee' : 'Add Employee'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <Field label="Full name">
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} required style={inputStyle} />
          </Field>

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              readOnly={isEdit}
              style={{ ...inputStyle, background: isEdit ? '#f8fafc' : '#fff', color: isEdit ? '#94a3b8' : '#1e293b' }}
            />
            {isEdit && <p style={hintStyle}>Email cannot be changed after account creation.</p>}
          </Field>

          {!isEdit && (
            <Field label="Temporary password">
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} style={inputStyle} />
              <p style={hintStyle}>The employee will use this to log in for the first time.</p>
            </Field>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Field label="Role">
              <select value={role} onChange={e => setRole(e.target.value as 'employee' | 'admin')} style={inputStyle}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Department">
              <input type="text" value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. Engineering" style={inputStyle} />
            </Field>
          </div>

          <Field label="Designation">
            <input
              type="text"
              value={designation}
              onChange={e => setDesignation(e.target.value)}
              list="designation-options"
              placeholder="e.g. Senior Designer"
              maxLength={80}
              style={inputStyle}
            />
            <datalist id="designation-options">
              {designations.map(d => <option key={d} value={d} />)}
            </datalist>
          </Field>

          <Field label="Monthly Gross Salary (optional)">
            <input
              type="number"
              value={salary}
              onChange={e => setSalary(e.target.value)}
              min="0"
              step="1"
              placeholder="e.g. 50000"
              style={inputStyle}
            />
            <p style={hintStyle}>Used for payroll calculations on the Reports page.</p>
          </Field>

          <Field label="Joining date (optional)">
            <input
              type="date"
              value={joiningDate}
              onChange={e => setJoiningDate(e.target.value)}
              style={inputStyle}
            />
            <p style={hintStyle}>Paid leave is credited from this month. Leave empty for staff who joined before this leave year (1 April).</p>
          </Field>

          <Field label="WhatsApp number (optional)">
            <input
              type="tel"
              value={phone}
              onChange={e => { setPhone(e.target.value); setPhoneError(null) }}
              placeholder="+91 98765 43210"
              style={{ ...inputStyle, borderColor: phoneError ? '#fca5a5' : '#d1d5db' }}
            />
            <p style={{ ...hintStyle, color: phoneError ? '#dc2626' : hintStyle.color }}>
              {phoneError ?? 'Leave approval / rejection notifications are sent here. A 10-digit number is treated as Indian (+91).'}
            </p>
          </Field>

          {error && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem', color: '#374151' }}>{label}</label>
      {children}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────

const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }
const sectionHeading: CSSProperties = { margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }
const thStyle: CSSProperties = { textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }
const tdStyle: CSSProperties = { padding: '0.875rem 0.75rem', verticalAlign: 'middle' }
const primaryBtn: CSSProperties = { padding: '0.5rem 1.125rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }
const ghostBtn: CSSProperties = { padding: '0.375rem 0.75rem', background: '#fff', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.8125rem', cursor: 'pointer', fontWeight: 500 }
const inputStyle: CSSProperties = { width: '100%', padding: '0.625rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.9375rem', outline: 'none', boxSizing: 'border-box', color: '#1e293b', fontFamily: 'inherit' }
const overlayStyle: CSSProperties = { position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }
const modalStyle: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.75rem', width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }
const hintStyle: CSSProperties = { margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }
