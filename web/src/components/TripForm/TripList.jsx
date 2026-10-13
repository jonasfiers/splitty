import { useNavigate } from 'react-router-dom'
import { formatDateRange, daysBetween, today } from '../../utils/trip.js'

const countdown = trip => {
  const now = today()
  if (trip.endDate < now) return 'Past'
  if (trip.startDate <= now) return 'Now'
  const days = daysBetween(now, trip.startDate)
  return days === 1 ? 'Tomorrow' : `In ${days} days`
}

function TripList({ trips, showGroup = false }) {
  const navigate = useNavigate()
  return (
    <div className="expense-list">
      {trips.map(t => (
        <div key={t.id} className="expense-item" onClick={() => navigate(`/trips/${t.id}`)}>
          <div className="expense-icon">{t.icon || '🧳'}</div>
          <div className="expense-info">
            <div className="expense-name">{t.title}</div>
            <div className="expense-meta">
              {formatDateRange(t.startDate, t.endDate)}
              {showGroup && t.groupTitle ? ` · ${t.groupTitle}` : ''}
            </div>
          </div>
          <div className="expense-amounts">
            <div className="expense-share" style={{ fontFamily: 'var(--font-body)', fontSize: 13 }}>{countdown(t)}</div>
            <div className="expense-total">{t.itemCount} item{t.itemCount !== 1 ? 's' : ''}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default TripList
