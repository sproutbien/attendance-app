import { useAuth } from '../contexts/AuthContext'
import { useAttendance } from '../hooks/useAttendance'
import AppLayout from '../components/AppLayout'
import CheckInButton from '../components/CheckInButton'
import MonthlyHistory from '../components/MonthlyHistory'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

export default function DashboardPage() {
  const { employee } = useAuth()
  const { todayRecord, monthRecords, isSubmitting, error, checkIn, checkOut } = useAttendance()

  const now = new Date()
  const todayLabel = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const monthLabel = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`
  const firstName = employee?.full_name.split(' ')[0] ?? ''

  return (
    <AppLayout>
      {/* Check-in card */}
      <div style={{
        background: '#fff',
        borderRadius: 16,
        padding: '2rem',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        marginBottom: '1.5rem',
        textAlign: 'center',
      }}>
        <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0 0 0.25rem' }}>{todayLabel}</p>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 2rem', color: '#1e293b' }}>
          Good {greeting()}, {firstName}
        </h2>

        <CheckInButton
          record={todayRecord}
          isSubmitting={isSubmitting}
          onCheckIn={checkIn}
          onCheckOut={checkOut}
        />

        {error && (
          <p style={{ marginTop: '1rem', color: '#ef4444', fontSize: '0.875rem', margin: '1rem 0 0' }}>
            {error}
          </p>
        )}
      </div>

      {/* Monthly history card */}
      <div style={{
        background: '#fff',
        borderRadius: 16,
        padding: '1.5rem',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
          {monthLabel}
        </h3>
        <MonthlyHistory records={monthRecords} />
      </div>
    </AppLayout>
  )
}
