import { Link } from 'react-router'

export default function BackLink({ to, label = 'Back', className = 'sub-header-back' }) {
  return (
    <Link to={to} className={className}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      {label}
    </Link>
  )
}
