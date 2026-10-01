import AppLayout from '../components/AppLayout'
import StatsView from '../components/stats/StatsView'
import { useAuth } from '../contexts/AuthContext'

/** Employee: their own statistics (the dashboard's This Month chevron opens this). */
export default function ReportsPage() {
  const { employee } = useAuth()
  return (
    <AppLayout wide>
      <div className="sb-container">
        {employee && <StatsView employee={employee} title="My Statistics" />}
      </div>
    </AppLayout>
  )
}
