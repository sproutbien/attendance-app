import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import AdminLayout from './components/AdminLayout'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import DashboardPage from './pages/DashboardPage'
import LeavePage from './pages/LeavePage'
import ReportsPage from './pages/ReportsPage'
import LeavePolicyPage from './pages/LeavePolicyPage'
import AdminAttendancePage from './pages/admin/AdminAttendancePage'
import AdminLeavePage from './pages/admin/AdminLeavePage'
import AdminEmployeesPage from './pages/admin/AdminEmployeesPage'
import AdminEmployeeProfilePage from './pages/admin/AdminEmployeeProfilePage'
import AdminEmployeeStatsPage from './pages/admin/AdminEmployeeStatsPage'
import AdminTeamStatsPage from './pages/admin/AdminTeamStatsPage'
import AdminReportsPage from './pages/admin/AdminReportsPage'
import AdminCalendarPage from './pages/admin/AdminCalendarPage'
import AdminCorrectionsPage from './pages/admin/AdminCorrectionsPage'
import AdminHiringPage from './pages/admin/AdminHiringPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Employee routes */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/leave"     element={<ProtectedRoute><LeavePage /></ProtectedRoute>} />
          <Route path="/reports"   element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
          <Route path="/leave-policy" element={<ProtectedRoute><LeavePolicyPage /></ProtectedRoute>} />

          {/* Admin routes — nested so AdminLayout wraps all sub-pages via <Outlet /> */}
          <Route
            path="/admin"
            element={<AdminRoute><AdminLayout /></AdminRoute>}
          >
            <Route index element={<Navigate to="/admin/attendance" replace />} />
            <Route path="attendance" element={<AdminAttendancePage />} />
            <Route path="leave"      element={<AdminLeavePage />} />
            <Route path="corrections" element={<AdminCorrectionsPage />} />
            <Route path="employees"  element={<AdminEmployeesPage />} />
            <Route path="employees/:id" element={<AdminEmployeeProfilePage />} />
            <Route path="employees/:id/stats" element={<AdminEmployeeStatsPage />} />
            <Route path="hiring"     element={<AdminHiringPage />} />
            <Route path="reports"    element={<AdminReportsPage />} />
            <Route path="team-stats" element={<AdminTeamStatsPage />} />
            <Route path="calendar"   element={<AdminCalendarPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
