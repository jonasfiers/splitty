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
const AdminsPage            = lazy(() => import('./pages/AdminsPage'))
const TripCategoriesPage    = lazy(() => import('./pages/TripCategoriesPage'))
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
const SharePage             = lazy(() => import('./pages/SharePage'))
const TripDocumentsPage     = lazy(() => import('./pages/TripDocumentsPage'))
const FileViewerPage        = lazy(() => import('./pages/FileViewerPage'))
const OfflineDocumentsPage  = lazy(() => import('./pages/OfflineDocumentsPage'))
const InvitePage            = lazy(() => import('./pages/InvitePage'))
const ForgotPasswordPage    = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage     = lazy(() => import('./pages/ResetPasswordPage'))
const VerifyEmailPage       = lazy(() => import('./pages/VerifyEmailPage'))
const VerifyEmailChangePage = lazy(() => import('./pages/VerifyEmailChangePage'))
const FollowPage            = lazy(() => import('./pages/FollowPage'))

// follow.<domain> (follow-my-trip links, outside the installed app's scope)
// serves only the follow page, at /<token>.
const FOLLOW_HOST = typeof window !== 'undefined' && window.location.hostname.startsWith('follow.')

export default function App() {
  if (FOLLOW_HOST) {
    return (
      <ThemeProvider>
        <BrowserRouter>
          <Suspense>
            <Routes>
              <Route path="/:token" element={<FollowPage />} />
              <Route path="*" element={<FollowPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ThemeProvider>
    )
  }
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
          {/* Public, no login: a trip shared to follow (api/followService.js). */}
          <Route path="/follow/:token" element={<FollowPage />} />
          {/* Kept on this device: offline and signed out too (utils/offlineDocs.js). */}
          <Route path="/offline-documents" element={<OfflineDocumentsPage />} />
          <Route path="/offline-documents/:fileId" element={<FileViewerPage />} />
          <Route element={<ProtectedRoute />}>
            {/* Full screen, outside the Layout: no sidebar, no bottom bar. */}
            <Route path="/trips/:tripId/items/:itemId/files/:fileId" element={<FileViewerPage />} />
            <Route path="/trips/:tripId/documents/:fileId" element={<FileViewerPage />} />
            <Route path="/groups/:groupId/expenses/:expenseId/receipts/:fileId" element={<FileViewerPage />} />
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
              {/* A ticket shared from another app (manifest share_target, sw.js). */}
              <Route path="/share" element={<SharePage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/admin/currencies" element={<CurrenciesPage />} />
                <Route path="/admin/categories" element={<CategoriesPage />} />
                <Route path="/admin/admins" element={<AdminsPage />} />
                <Route path="/admin/trip-categories" element={<TripCategoriesPage />} />
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