import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useEmployeeManagement, useEmployeeOptions } from '../../hooks/useEmployeeManagement'
import { useShifts } from '../../hooks/useShifts'
import type { EmployeeFormData } from '../../hooks/useEmployeeManagement'
import {
  BLOCKED_STATUSES, EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABELS, TRACKED_STATUSES, fmtDate, fmtPhone,
} from '../../lib/employees'
import EmployeeAvatar from '../../components/employees/EmployeeAvatar'
import StatusBadge from '../../components/employees/StatusBadge'
import EmployeeFormModal from '../../components/employees/EmployeeFormModal'
import EmployeeListsModal from '../../components/employees/EmployeeListsModal'
import ShiftsModal from '../../components/employees/ShiftsModal'
import {
  card, dangerBtn, errorBox, ghostBtn, hintStyle, inputStyle, modalStyle, overlayStyle, primaryBtn,
  sectionHeading, successBox, tableStyle, tdStyle, thStyle,
} from '../../components/employees/styles'
import type { Employee, EmployeeStatus, Shift } from '../../types'

/** Binned employees are permanently deleted this long after deletion (see migration 018) */
const BIN_MONTHS = 6

function purgeDate(deletedAt: string) {
  const d = new Date(deletedAt)
  d.setMonth(d.getMonth() + BIN_MONTHS)
  return d
}

type StatusFilter = 'current' | 'former' | 'all' | EmployeeStatus

const ROLE_COLORS = {
  admin:    { bg: '#ede9fe', text: '#5b21b6' },
  employee: { bg: '#f0f9ff', text: '#0369a1' },
}

// ── Page ─────────────────────────────────────────────────────

export default function AdminEmployeesPage() {
  const { employee: me } = useAuth()
  const navigate = useNavigate()
  const mgmt = useEmployeeManagement()
  const { employees, loading, saving, error, setError, addEmployee, binEmployee, restoreEmployee, purgeEmployee } = mgmt
  const lists = useEmployeeOptions()
  const shifts = useShifts()
  const [showShifts, setShowShifts] = useState(false)

  const [adding, setAdding] = useState(false)
  const [showLists, setShowLists] = useState(false)
  const [confirm, setConfirm] = useState<{ type: 'bin' | 'purge'; employee: Employee } | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [showBin, setShowBin] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('current')
  const [deptFilter, setDeptFilter] = useState('')

  const binned  = employees.filter(e => e.deleted_at)
  const present = employees.filter(e => !e.deleted_at)
  const current = present.filter(e => TRACKED_STATUSES.includes(e.status))
  const designations = [...new Set(employees.map(e => e.designation).filter((d): d is string => !!d))].sort()
  const departments = [...new Set(present.map(e => e.department).filter((d): d is string => !!d))].sort()
  const byId = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])

  const visible = present.filter(e => {
    if (statusFilter === 'current' && !TRACKED_STATUSES.includes(e.status)) return false
    if (statusFilter === 'former' && !BLOCKED_STATUSES.includes(e.status)) return false
    if (statusFilter !== 'current' && statusFilter !== 'former' && statusFilter !== 'all' && e.status !== statusFilter) return false
    if (deptFilter && e.department !== deptFilter) return false
    const q = query.trim().toLowerCase()
    if (q && ![e.full_name, e.email, e.employee_code, e.designation ?? '', e.phone ?? ''].some(v => v.toLowerCase().includes(q))) return false
    return true
  })

  function flash(msg: string) {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 4000)
  }

  async function handleAdd(data: EmployeeFormData) {
    const id = await addEmployee(data)
    if (!id) return
    setAdding(false)
    const err = data.shift ? await shifts.assign(id, data.shift.id, data.shift.from) : null
    flash(err ? `${data.full_name} added, but the shift wasn't set: ${err}` : `${data.full_name} added.`)
  }

  async function handleConfirm() {
    if (!confirm) return
    const { type, employee } = confirm
    const err = type === 'bin' ? await binEmployee(employee.id) : await purgeEmployee(employee.id)
    if (err) { setConfirmError(err); return }
    setConfirm(null)
    flash(type === 'bin' ? `${employee.full_name} moved to the bin.` : `${employee.full_name} permanently deleted.`)
  }

  async function handleRestore(employee: Employee) {
    const err = await restoreEmployee(employee.id)
    flash(err ?? `${employee.full_name} restored.`)
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>Employees</h1>
          {!loading && !showBin && (
            <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: '0.8125rem', fontWeight: 600, padding: '2px 10px', borderRadius: 99 }}>
              {current.length} current
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {showBin ? (
            <button onClick={() => setShowBin(false)} style={ghostBtn}>← Back to employees</button>
          ) : (
            <>
              <button onClick={() => setShowShifts(true)} style={ghostBtn}>Shifts</button>
              <button onClick={() => setShowLists(true)} style={ghostBtn}>Lists</button>
              <button onClick={() => setShowBin(true)} style={ghostBtn}>Bin ({binned.length})</button>
              <button onClick={() => { setError(null); setAdding(true) }} style={primaryBtn}>+ Add Employee</button>
            </>
          )}
        </div>
      </div>

      {successMsg && <div style={successBox}>{successMsg}</div>}

      {loading ? (
        <div style={{ ...card, color: '#94a3b8', padding: '2rem' }}>Loading…</div>
      ) : showBin ? (
        <BinList employees={binned} saving={saving} onRestore={handleRestore} onPurge={e => { setConfirmError(null); setConfirm({ type: 'purge', employee: e }) }} />
      ) : (
        <div style={card}>
          {/* Filters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            <div style={{ position: 'relative', flex: '1 1 240px' }}>
              <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="search" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search name, ID, email, phone…" aria-label="Search employees"
                style={{ ...inputStyle, paddingLeft: 32, fontSize: '0.875rem', padding: '0.5rem 0.75rem 0.5rem 32px' }}
              />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} aria-label="Status" style={filterSelect}>
              <option value="current">Current staff</option>
              <option value="former">Former / inactive</option>
              <option value="all">All statuses</option>
              <optgroup label="Status">
                {EMPLOYEE_STATUSES.map(s => <option key={s} value={s}>{EMPLOYEE_STATUS_LABELS[s]}</option>)}
              </optgroup>
            </select>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} aria-label="Department" style={filterSelect}>
              <option value="">All departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {visible.length === 0 ? (
            <p style={{ color: '#94a3b8', margin: '1rem 0 0' }}>
              {present.length === 0 ? 'No employees yet.' : 'No employees match these filters.'}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="rt" style={tableStyle}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                    {['Employee', 'Job', 'Reports to', 'Status', 'Role'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visible.map(e => (
                    <EmployeeRow
                      key={e.id}
                      employee={e}
                      manager={e.reporting_manager_id ? byId.get(e.reporting_manager_id) ?? null : null}
                      shift={shifts.shiftOn(e.id)}
                      onOpen={() => navigate(`/admin/employees/${e.id}`)}
                      onDelete={e.id === me?.id ? undefined : () => { setConfirmError(null); setConfirm({ type: 'bin', employee: e }) }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {adding && (
        <EmployeeFormModal
          existing={null}
          isSelf={false}
          employees={employees}
          options={{ department: lists.byKind('department'), work_location: lists.byKind('work_location'), employment_type: lists.byKind('employment_type') }}
          shifts={shifts.shifts}
          currentShift={shifts.defaultShift}
          upcomingShift={null}
          designations={designations}
          saving={saving}
          error={error}
          onSave={handleAdd}
          onClose={() => { setAdding(false); setError(null) }}
        />
      )}

      {showShifts && (
        <ShiftsModal shifts={shifts} employeeIds={current.map(e => e.id)} onClose={() => setShowShifts(false)} />
      )}

      {showLists && (
        <EmployeeListsModal lists={lists} employees={present} onChanged={mgmt.refetch} onClose={() => setShowLists(false)} />
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
              To record that someone left, set their status to Resigned or Terminated instead.
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

// ── Employee table row ────────────────────────────────────────

function EmployeeRow({ employee: e, manager, shift, onOpen, onDelete }: {
  employee: Employee
  manager: Employee | null
  shift: Shift | null
  onOpen: () => void
  onDelete?: () => void             // absent for the signed-in admin's own row
}) {
  const roleColor = ROLE_COLORS[e.role]
  const former = BLOCKED_STATUSES.includes(e.status)
  const job = [e.employment_type, e.work_location, shift && `${shift.name} shift`].filter(Boolean).join(' · ')

  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9', opacity: former ? 0.65 : 1 }}>
      <td style={tdStyle} className="emp-cell">
        <button onClick={onOpen} style={rowLink} aria-label={`Open ${e.full_name}'s profile`}>
          <EmployeeAvatar employee={e} dim={former} />
          <div>
            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9375rem' }}>{e.full_name}</div>
            <div style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>
              <span style={{ fontWeight: 600, color: '#64748b' }}>{e.employee_code}</span> · {e.email}
              {e.phone && <> · {fmtPhone(e.phone)}</>}
            </div>
          </div>
        </button>
        {/* Shown on hover (mouse) or always (touch) — see .emp-actions in index.css */}
        <div className="emp-actions">
          <button type="button" onClick={onOpen} className="emp-action">View profile</button>
          {onDelete && <>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={onDelete} className="emp-action is-danger">Delete</button>
          </>}
        </div>
      </td>
      <td style={tdStyle}>
        <div style={{ color: '#1e293b', fontWeight: 500 }}>{e.designation ?? <span style={{ color: '#d97706' }}>No designation</span>}</div>
        <div style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>{[e.department, job].filter(Boolean).join(' · ') || '—'}</div>
      </td>
      <td style={{ ...tdStyle, color: '#64748b' }}>{manager?.full_name ?? '—'}</td>
      <td style={tdStyle}>
        <StatusBadge status={e.status} />
        {e.last_working_day && (
          <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: 4 }}>Last day {fmtDate(e.last_working_day)}</div>
        )}
      </td>
      <td style={tdStyle}>
        <span style={{ padding: '2px 10px', borderRadius: 99, background: roleColor.bg, color: roleColor.text, fontWeight: 600, fontSize: '0.8125rem' }}>
          {e.role === 'admin' ? 'Admin' : 'Employee'}
        </span>
      </td>
    </tr>
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
        <table className="rt" style={tableStyle}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              {['Employee', 'Deleted on', 'Deleted permanently on', ''].map(h => <th key={h} style={thStyle}>{h}</th>)}
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
                    <div style={{ color: '#94a3b8', fontSize: '0.8125rem' }}>{e.employee_code} · {e.email}</div>
                  </td>
                  <td style={{ ...tdStyle, color: '#64748b' }}>{fmtDate(new Date(e.deleted_at!))}</td>
                  <td style={{ ...tdStyle, color: '#64748b' }}>
                    {fmtDate(purge)} <span style={{ color: '#94a3b8' }}>({daysLeft} day{daysLeft === 1 ? '' : 's'} left)</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => onRestore(e)} disabled={saving} style={{ ...ghostBtn, color: '#16a34a', borderColor: '#bbf7d0' }}>Restore</button>
                    <button onClick={() => onPurge(e)} disabled={saving} style={{ ...dangerBtn, marginLeft: '0.5rem' }}>Delete forever</button>
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
        {error && <div style={errorBox}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" onClick={onClose} style={{ ...ghostBtn, padding: '0.625rem 1.25rem' }}>Cancel</button>
          <button
            type="button" onClick={onConfirm} disabled={saving}
            style={{ ...primaryBtn, background: '#dc2626', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

const filterSelect: React.CSSProperties = { ...inputStyle, width: 'auto', flex: '0 1 200px', fontSize: '0.875rem', padding: '0.5rem 0.75rem' }
const rowLink: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'none', border: 'none', padding: 0,
  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
}
