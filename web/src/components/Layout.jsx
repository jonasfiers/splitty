import { useState, useRef } from 'react'
import { Outlet, NavLink, Link, useLocation } from 'react-router'
import { markPageOpened } from '../utils/pageStart.js'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import { useOffline } from '../utils/connection.js'
import { useHistoryTracker } from '../utils/history.js'
import { useOfflineTrips, keptLabel } from '../utils/useOfflineDocs.js'
import { useAuth } from '../context/AuthContext'
import { Avatar } from './Avatar.jsx'
import CatAvatar from './CatAvatar/CatAvatar'

const NAV_ITEMS = [
  { to: '/groups',     end: true, label: 'Home',       icon: HomeIcon       },
  { to: '/trips',                label: 'Trips',      icon: TripsIcon      },
  { to: '/activity',             label: 'Activity',   icon: ActivityIcon   },
  { to: '/insights',             label: 'Insights',   icon: InsightsIcon   },
]

function HomeIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )
}

function TripsIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="13" rx="2"/>
      <path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/>
      <line x1="3" y1="13" x2="21" y2="13"/>
    </svg>
  )
}

function ActivityIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )
}

function InsightsIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  )
}

function CollapseIcon({ collapsed }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      {collapsed ? <polyline points="13 10 15 12 13 14" /> : <polyline points="15 10 13 12 15 14" />}
    </svg>
  )
}

// The sidebar folds to a rail of icons. It starts folded where space is
// short (a tablet, an opened Fold) and open on a wider screen; once toggled,
// the choice is kept on this device (a convenience: it may be forgotten).
const COLLAPSE_KEY = 'splitty.sidebarCollapsed'
function useSidebarCollapsed() {
  const roomy = useMediaQuery('(min-width: 1180px)')
  const [pref, setPref] = useState(() => {
    try { const v = localStorage.getItem(COLLAPSE_KEY); return v === null ? null : v === '1' } catch { return null }
  })
  const collapsed = pref ?? !roomy
  const toggle = () => {
    const next = !collapsed
    setPref(next)
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* private mode: just this visit */ }
  }
  return [collapsed, toggle]
}

function AdminIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>
    </svg>
  )
}

export default function Layout() {
  useHistoryTracker()
  // Marked while rendering, before the new page's own parts mount.
  const { pathname } = useLocation()
  const lastPath = useRef(pathname)
  if (lastPath.current !== pathname) { lastPath.current = pathname; markPageOpened() }
  const offline = useOffline()
  const kept = keptLabel(useOfflineTrips())
  const { currentUser, isAdmin } = useAuth()
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>

      {/* ── SIDEBAR (desktop) ── */}
      <aside className="app-sidebar">
        <Link to="/groups" className="sidebar-logo" aria-label="Splitty, home">
          <CatAvatar className="sidebar-logo-icon" />
          <span>Split<span className="sidebar-logo-accent">ty</span></span>
        </Link>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}
              title={collapsed ? label : undefined}
            >
              <Icon size={18} />
              <span className="sidebar-label">{label}</span>
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => 'sidebar-nav-item sidebar-nav-admin' + (isActive ? ' active' : '')} title={collapsed ? 'Admin' : undefined}>
              <AdminIcon size={18} />
              <span className="sidebar-label">Admin</span>
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <Link to="/profile" className="sidebar-user" title={collapsed ? currentUser?.name : undefined} aria-label={collapsed ? `Profile, ${currentUser?.name ?? ''}` : undefined}>
            <Avatar name={currentUser?.name} size={28} colorIndex={currentUser?.avatarColor} />
            <span className="sidebar-user-name sidebar-label">{currentUser?.name ?? ''}</span>
          </Link>
          <button type="button" className="sidebar-collapse" onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} aria-expanded={!collapsed}
            title={collapsed ? 'Expand' : 'Collapse'}>
            <CollapseIcon collapsed={collapsed} />
          </button>
        </div>
      </aside>

      {/* ── CONTENT ── */}
      <main className="app-content">
        {offline && (
          <div className="offline-bar" role="status">
            <span>You’re offline. Nothing new can load.</span>
            {kept && <Link to="/offline-documents">Offline: {kept} ›</Link>}
          </div>
        )}
        <div className="page-wrap">
          <Outlet />
        </div>
      </main>

      {/* ── BOTTOM NAV (mobile) ── */}
      <nav className="bottom-nav">
        {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
          >
            <Icon size={22} />
            <span className="nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>

    </div>
  )
}
