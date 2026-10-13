import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom'
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

export default function Layout() {
  const { currentUser, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="app-shell">

      {/* ── SIDEBAR (desktop) ── */}
      <aside className="app-sidebar">
        <Link to="/groups" className="sidebar-logo">
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
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <Link to="/profile" className="sidebar-user">
            <Avatar name={currentUser?.name} size={28} colorIndex={currentUser?.avatarColor} emoji={currentUser?.avatarEmoji} />
            <span className="sidebar-user-name">{currentUser?.name ?? ''}</span>
          </Link>
        </div>
      </aside>

      {/* ── HEADER (mobile) ── */}
      <header className="app-header" >
        <Link to="/groups" className="app-logo">
            <CatAvatar className="app-logo-icon" />
            <span>Split<span className="app-logo-accent">ty</span></span></Link>
        <Link to="/profile" className="app-avatar">
          <Avatar name={currentUser?.name} size={28} colorIndex={currentUser?.avatarColor} emoji={currentUser?.avatarEmoji} />
        </Link>
      </header>

      {/* ── CONTENT ── */}
      <main className="app-content">
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
