import { useEffect } from 'react'
import { Link } from 'react-router'
import { ListRow } from '../components/List/List.jsx'
import { useAuth } from '../context/AuthContext'
import Loading from '../components/Loading.jsx'
import { useOfflineTrips } from '../utils/useOfflineDocs.js'
import { asOf, syncOfflineTrips } from '../utils/offlineTrips.js'
import { formatDateRange } from '../utils/trip.js'
import '../components/TripDocuments/TripDocuments.css'

// The trips kept on this device (utils/offlineTrips.js): the way in when the
// rest of the app can't load. Each opens as usual, from the device's copy:
// the trip, its items with their files, its documents. The files are where
// they are in the trip, not listed here.
export default function OfflineDocumentsPage() {
  const { token } = useAuth()
  const trips = useOfflineTrips()

  // Online: bring the copy up to date.
  useEffect(() => { syncOfflineTrips() }, [])

  return (
    <div className="privacy-page">
      <article className="privacy offline-docs">
        <Link to={token ? '/trips' : '/login'} className="privacy-back">‹ {token ? 'Trips' : 'Sign in'}</Link>
        <h1>Offline</h1>
        <p className="privacy-updated">
          Current and coming trips, with their files, on this device. They open without a connection, and stay
          until a few days after the trip. Signing out removes them.
        </p>

        {!token ? (
          <p>Sign in to see the trips kept on this device.</p>
        ) : trips === null ? (
          <Loading />
        ) : trips.length === 0 ? (
          <p>No trips on this device yet. They come by themselves while you are online (Profile › Keep trips offline).</p>
        ) : (
          <section className="offline-docs-trip">
            <div className="list">
              {trips.map(t => (
                <ListRow
                  key={t.id}
                  to={`/trips/${t.id}`}
                  chevron
                  icon={t.icon || '🧳'}
                  title={t.title}
                  meta={[formatDateRange(t.startDate, t.endDate), asOf(t.savedAt)].filter(Boolean).join(' · ')}
                />
              ))}
            </div>
          </section>
        )}
      </article>
    </div>
  )
}
