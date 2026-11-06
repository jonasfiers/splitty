import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../context/AuthContext'
import Loading from './Loading.jsx'

// Admin pages only. Non-admins are sent Home. This only hides the pages: the
// API refuses admin actions from anyone who is not an admin regardless.
export default function AdminRoute() {
  const { isAdmin } = useAuth()
  if (isAdmin === null) return <Loading />
  return isAdmin ? <Outlet /> : <Navigate to="/groups" replace />
}
