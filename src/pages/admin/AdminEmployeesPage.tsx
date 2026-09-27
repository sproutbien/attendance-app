import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useEmployeeManagement } from '../../hooks/useEmployeeManagement'
import type { EmployeeFormData } from '../../hooks/useEmployeeManagement'
import type { Employee } from '../../types'

// ── Types ────────────────────────────────────────────────────

type ModalMode = { type: 'add' } | { type: 'edit'; employee: Employee }

// ── Helpers ──────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
}

const ROLE_COLORS = {
  admin:    { bg: '#ede9fe', text: '#5b21b6' },
  employee: { bg: '#f0f9ff', text: '#0369a1' },
}

// ── Page ─────────────────────────────────────────────────────

export default function AdminEmployeesPage() {
  const { employees, loading, saving, error, setError, addEmployee, updateEmployee, toggleStatus } = useEmployeeManagement()
  const [modal, setModal] = useState<ModalMode | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const active   = employees.filter(e => e.status === 'active')
  const inactive = employees.filter(e => e.status === 'inactive')

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
        monthly_salary: data.monthly_salary,
      })
      if (ok) {
        setModal(null)
        setSuccessMsg(`${data.full_name} updated.`)
        setTimeout(() => setSuccessMsg(null), 4000)
      }
    }
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
          {!loading && (
            <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: '0.8125rem', fontWeight: 600, padding: '2px 10px', borderRadius: 99 }}>
              {active.length} active
            </span>
          )}
        </div>
        <button onClick={openAdd} style={primaryBtn}>+ Add Employee</button>
      </div>

      {successMsg && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#166534', fontSize: '0.875rem' }}>
          {successMsg}
        </div>
      )}

      {loading ? (
        <div style={{ ...card, color: '#94a3b8', padding: '2rem' }}>Loading…</div>
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
                    {['Employee', 'Department', 'Role', ''].map(h => (
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
                    {['Employee', 'Department', 'Role', ''].map(h => (
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
          saving={saving}
          error={error}
          onSave={handleSave}
          onClose={() => { setModal(null); setError(null) }}
        />
      )}
    </div>
  )
}

// ── Employee table row ────────────────────────────────────────

function EmployeeRow({ employee: e, onEdit, onToggle }: {
  employee: Employee
  onEdit: () => void
  onToggle: () => void
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
            <div style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>{e.email}</div>
          </div>
        </div>
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
      </td>
    </tr>
  )
}

// ── Add / Edit modal ──────────────────────────────────────────

function EmployeeModal({ mode, saving, error, onSave, onClose }: {
  mode: ModalMode
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
  const [salary,     setSalary]     = useState(existing?.monthly_salary != null ? String(existing.monthly_salary) : '')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSave({ full_name: fullName, email, password, role, department, monthly_salary: salary === '' ? null : Number(salary) })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(15,23,42,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#fff', borderRadius: 16,
        padding: '1.75rem', width: '100%', maxWidth: 480,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
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
const hintStyle: CSSProperties = { margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }
