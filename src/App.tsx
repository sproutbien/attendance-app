import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import AdminLayout from './components/AdminLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import LeavePage from './pages/LeavePage'
import AdminAttendancePage from './pages/admin/AdminAttendancePage'
import AdminLeavePage from './pages/admin/AdminLeavePage'
import AdminEmployeesPage from './pages/admin/AdminEmployeesPage'
import AdminReportsPage from './pages/admin/AdminReportsPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Employee routes */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/leave"     element={<ProtectedRoute><LeavePage /></ProtectedRoute>} />

          {/* Admin routes — nested so AdminLayout wraps all sub-pages via <Outlet /> */}
          <Route
            path="/admin"
            element={<AdminRoute><AdminLayout /></AdminRoute>}
          >
            <Route index element={<Navigate to="/admin/attendance" replace />} />
            <Route path="attendance" element={<AdminAttendancePage />} />
            <Route path="leave"      element={<AdminLeavePage />} />
            <Route path="employees"  element={<AdminEmployeesPage />} />
            <Route path="reports"    element={<AdminReportsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
