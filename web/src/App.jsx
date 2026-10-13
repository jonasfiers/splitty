import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

const LoginPage             = lazy(() => import('./pages/LoginPage'))
const RegisterPage          = lazy(() => import('./pages/RegisterPage'))
const GroupsPage            = lazy(() => import('./pages/GroupsPage'))
const GroupDetailPage       = lazy(() => import('./pages/GroupDetailPage'))
const ExpenseFormPage       = lazy(() => import('./pages/ExpenseFormPage'))
const ExpenseDetailPage     = lazy(() => import('./pages/ExpenseDetailPage'))
const CurrenciesPage        = lazy(() => import('./pages/CurrenciesPage'))
const CategoriesPage        = lazy(() => import('./pages/CategoriesPage'))
const ProfilePage           = lazy(() => import('./pages/ProfilePage'))
const ActivityPage          = lazy(() => import('./pages/ActivityPage'))
const FriendsPage           = lazy(() => import('./pages/FriendsPage'))
const InsightsPage          = lazy(() => import('./pages/InsightsPage'))
const TripsPage             = lazy(() => import('./pages/TripsPage'))
const TripDetailPage        = lazy(() => import('./pages/TripDetailPage'))
const TripItemFormPage      = lazy(() => import('./pages/TripItemFormPage'))
const TripItemDetailPage    = lazy(() => import('./pages/TripItemDetailPage'))
const InvitePage            = lazy(() => import('./pages/InvitePage'))
const ForgotPasswordPage    = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage     = lazy(() => import('./pages/ResetPasswordPage'))
const VerifyEmailPage       = lazy(() => import('./pages/VerifyEmailPage'))
const VerifyEmailChangePage = lazy(() => import('./pages/VerifyEmailChangePage'))

export default function App() {
  return (
    <ThemeProvider>
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
          <Route element={<ProtectedRoute />}>
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
              <Route path="/trips/:tripId/items/:itemId" element={<TripItemDetailPage />} />
              <Route path="/trips/:tripId/items/:itemId/edit" element={<TripItemFormPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route path="/currencies" element={<CurrenciesPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  )
}