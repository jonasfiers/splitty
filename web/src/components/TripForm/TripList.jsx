import { useNavigate } from 'react-router'
import { List, ListRow } from '../List/List.jsx'
import { formatDateRange, daysBetween, today } from '../../utils/trip.js'

const countdown = trip => {
  const now = today()
  if (trip.endDate < now) return 'Past'
  if (trip.startDate <= now) return 'Now'
  const days = daysBetween(now, trip.startDate)
  return days === 1 ? 'Tomorrow' : `In ${days} days`
}

function TripList({ trips, showGroup = false }) {
  return (
    <List>
      {trips.map(t => (
        <ListRow
          key={t.id}
          to={`/trips/${t.id}`}
          icon={t.icon || '🧳'}
          title={t.title}
          meta={<>{formatDateRange(t.startDate, t.endDate)}{showGroup && t.groupTitle ? ` · ${t.groupTitle}` : ''}</>}
          aside={<>
            <span className="list-row-amt" style={{ fontFamily: 'var(--font-body)', fontSize: 13 }}>{countdown(t)}</span>
            <span className="list-row-sub">{t.itemCount} item{t.itemCount !== 1 ? 's' : ''}</span>
          </>}
        />
      ))}
    </List>
  )
}

// Wider screens: the same trips as cards in a grid, with a bit more on each.
export function TripCards({ trips, past = false }) {
  const navigate = useNavigate()
  return (
    <div className="trip-cards">
      {trips.map(t => {
        const nights = daysBetween(t.startDate, t.endDate)
        const when = countdown(t)
        return (
          <button key={t.id} type="button" className={`trip-card${past ? ' past' : ''}`} onClick={() => navigate(`/trips/${t.id}`)}>
            <div className="trip-card-top">
              <span className="trip-card-icon">{t.icon || '🧳'}</span>
              <span className={`trip-card-when${when === 'Now' ? ' now' : ''}`}>{when}</span>
            </div>
            <div className="trip-card-title">{t.title}</div>
            <div className="trip-card-dates">
              {formatDateRange(t.startDate, t.endDate)}{nights > 0 && ` · ${nights} night${nights !== 1 ? 's' : ''}`}
            </div>
            <div className="trip-card-foot">
              <span>{t.groupIcon ? `${t.groupIcon} ` : ''}{t.groupTitle}</span>
              <span>{t.itemCount} item{t.itemCount !== 1 ? 's' : ''}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

export default TripList
