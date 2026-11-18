import { Link } from 'react-router'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import Icon from '../components/Icon/Icon.jsx'

const SECTIONS = [
  { to: '/admin/categories', icon: 'tag', title: 'Categories', sub: 'The expense categories everyone picks from' },
  { to: '/admin/trip-categories', icon: 'compass', title: 'Trip categories', sub: 'Which category trip entries belong to, and their colour' },
  { to: '/admin/currencies', icon: 'coins', title: 'Currencies', sub: 'The currencies groups and expenses can use' },
  { to: '/admin/admins', icon: 'shield', title: 'Admins', sub: 'Who can manage these settings' },
]

export default function AdminPage() {
  return (
    <>
      <PageHeader crumbs={[{ to: '/profile', label: 'Profile' }]} title="Admin" name="Admin" />
      <p className="admin-intro">Shared settings for every Splitty user. Only admins see this.</p>
      <div className="admin-list">
        {SECTIONS.map(s => (
          <Link key={s.to} to={s.to} className="admin-card">
            <span className="admin-card-icon" aria-hidden="true"><Icon name={s.icon} /></span>
            <span className="admin-card-text">
              <span className="admin-card-title">{s.title}</span>
              <span className="admin-card-sub">{s.sub}</span>
            </span>
            <svg className="admin-card-chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
          </Link>
        ))}
      </div>
    </>
  )
}
