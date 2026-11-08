import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ConfirmProvider } from './components/Confirm/ConfirmProvider.jsx'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import Layout from './components/Layout'

const LoginPage             = lazy(() => import('./pages/LoginPage'))
const RegisterPage          = lazy(() => import('./pages/RegisterPage'))
const GroupsPage            = lazy(() => import('./pages/GroupsPage'))
const GroupDetailPage       = lazy(() => import('./pages/GroupDetailPage'))
const ExpenseFormPage       = lazy(() => import('./pages/ExpenseFormPage'))
const ExpenseDetailPage     = lazy(() => import('./pages/ExpenseDetailPage'))
const CurrenciesPage        = lazy(() => import('./pages/CurrenciesPage'))
const CategoriesPage        = lazy(() => import('./pages/CategoriesPage'))
const AdminPage             = lazy(() => import('./pages/AdminPage'))
const PrivacyPage           = lazy(() => import('./pages/PrivacyPage'))
const ProfilePage           = lazy(() => import('./pages/ProfilePage'))
const ActivityPage          = lazy(() => import('./pages/ActivityPage'))
const FriendsPage           = lazy(() => import('./pages/FriendsPage'))
const InsightsPage          = lazy(() => import('./pages/InsightsPage'))
const TripsPage             = lazy(() => import('./pages/TripsPage'))
const TripDetailPage        = lazy(() => import('./pages/TripDetailPage'))
const TripItemFormPage      = lazy(() => import('./pages/TripItemFormPage'))
const TripItemDetailPage    = lazy(() => import('./pages/TripItemDetailPage'))
const TripRoutePage         = lazy(() => import('./pages/TripRoutePage'))
const TripDocumentsPage     = lazy(() => import('./pages/TripDocumentsPage'))
const FileViewerPage        = lazy(() => import('./pages/FileViewerPage'))
const OfflineDocumentsPage  = lazy(() => import('./pages/OfflineDocumentsPage'))
const InvitePage            = lazy(() => import('./pages/InvitePage'))
const ForgotPasswordPage    = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage     = lazy(() => import('./pages/ResetPasswordPage'))
const VerifyEmailPage       = lazy(() => import('./pages/VerifyEmailPage'))
const VerifyEmailChangePage = lazy(() => import('./pages/VerifyEmailChangePage'))

export default function App() {
  return (
    <ThemeProvider>
    <ConfirmProvider>
    <AuthProvider>
      <BrowserRouter>
        <Suspense>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/verify-email-change" element={<VerifyEmailChangePage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          {/* Kept on this device: offline and signed out too (utils/offlineDocs.js). */}
          <Route path="/offline-documents" element={<OfflineDocumentsPage />} />
          <Route path="/offline-documents/:fileId" element={<FileViewerPage />} />
          <Route element={<ProtectedRoute />}>
            {/* Full screen, outside the Layout: no sidebar, no bottom bar. */}
            <Route path="/trips/:tripId/items/:itemId/files/:fileId" element={<FileViewerPage />} />
            <Route path="/trips/:tripId/documents/:fileId" element={<FileViewerPage />} />
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/groups" replace />} />
              <Route path="/groups" element={<GroupsPage />} />
              <Route path="/groups/:id" element={<GroupDetailPage />} />
              <Route path="/groups/:groupId/expenses/:id" element={<ExpenseDetailPage />} />
              <Route path="/groups/:groupId/expenses/new" element={<ExpenseFormPage />} />
              <Route path="/groups/:groupId/expenses/:id/edit" element={<ExpenseFormPage />} />
              <Route path="/trips" element={<TripsPage />} />
              <Route path="/trips/:id" element={<TripDetailPage />} />
              <Route path="/trips/:tripId/items/new" element={<TripItemFormPage />} />
              <Route path="/trips/:tripId/route" element={<TripRoutePage />} />
              <Route path="/trips/:tripId/documents" element={<TripDocumentsPage />} />
              <Route path="/trips/:tripId/items/:itemId" element={<TripItemDetailPage />} />
              <Route path="/trips/:tripId/items/:itemId/edit" element={<TripItemFormPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/admin/currencies" element={<CurrenciesPage />} />
                <Route path="/admin/categories" element={<CategoriesPage />} />
              </Route>
              <Route path="/currencies" element={<Navigate to="/admin/currencies" replace />} />
              <Route path="/categories" element={<Navigate to="/admin/categories" replace />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </ConfirmProvider>
    </ThemeProvider>
  )
}