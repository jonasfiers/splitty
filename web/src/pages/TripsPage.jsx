import { useState, useEffect, useCallback } from 'react'
import LoadFailed from '../components/LoadFailed.jsx'
import { Link, useNavigate } from 'react-router'
import FabButton from '../components/FabButton/FabButton.jsx'
import Loading from '../components/Loading.jsx'
import TripList, { TripCards } from '../components/TripForm/TripList.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import TripFormSheet from '../components/TripForm/TripFormSheet.jsx'
import { today, formatDateRange } from '../utils/trip.js'
import { List, ListRow } from '../components/List/List.jsx'
import TabHeader from '../components/PageHeader/TabHeader.jsx'

import { useOfflineTrips, keptLabel } from '../utils/useOfflineDocs.js'
import EmptyState from '../components/EmptyState/EmptyState.jsx'
import NextTrip from '../components/TripForm/NextTrip.jsx'
import { PageGate } from '../utils/pageGate.jsx'
import { swr } from '../utils/cache.js'

export default function TripsPage() {
  const offline = keptLabel(useOfflineTrips())
  const navigate = useNavigate()
  const [trips, setTrips] = useState([])
  const [groups, setGroups] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setError(null); setLoading(true); setAttempt(n => n + 1) }, [])

  // The last state at once, then fresh (utils/cache.js); "Try again" asks the server only.
  useEffect(() => {
    const { cached, fresh } = swr([['/trips'], ['/groups']], ([tr, gr]) => {
      setTrips(tr.data.trips || [])
      setGroups(gr.data.groups || [])
    }, { fresh: attempt > 0 })
    if (cached) setLoading(false)
    fresh
      .catch(err => { if (!cached) setError(err) })
      .finally(() => setLoading(false))
  }, [attempt])

  // From tablet width up, trips are shown as cards.
  const cards = useMediaQuery('(min-width: 768px)')


  const now = today()
  const upcoming = trips.filter(t => t.endDate >= now)
  // The one that is on, or the soonest: shown large, with what comes first.
  const [nextTrip, ...later] = upcoming
  // Most recent first: the trip you just came back from is the one you still open.
  const past = trips.filter(t => t.endDate < now).reverse()

  return (
    <>
      {/* Offline documents: a plain link by the title, still the first thing
          on the page (before the error on purpose: offline, this is what works). */}
      <TabHeader
        title="Trips"
        aside={offline && (
          <Link to="/offline-documents" className="offline-link">
            <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="7.5 10 10.5 13 16.5 7" /><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></svg>
            {offline} offline
          </Link>
        )}
      />

      {error && <LoadFailed error={error} what="your trips" onRetry={retry} docs={false} />}
      {/* Below the offline documents: they must not wait for the trips. */}
      {loading && <Loading />}

      {!loading && trips.length === 0 && !error && (
        <EmptyState title="No trips yet">
          {groups.length === 0
            ? 'A trip is planned with a group. Create a group first.'
            : 'Plan the transport, the stays and the things to do, and split what they cost.'}
        </EmptyState>
      )}

      {/* Only once the list is in: a gate opened before the Next up card
          existed would have nothing to wait for (utils/pageGate.jsx). */}
      {!loading && <PageGate>
      {nextTrip && <NextTrip trip={nextTrip} />}

      {later.length > 0 && <>
        <div className="section-label">Later</div>
        {cards ? <TripCards trips={later} /> : <TripList trips={later} showGroup />}
      </>}

      {/* For looking back: plain rows, not cards. */}
      {past.length > 0 && <List label="Past" className="trips-past">
        {past.map(t => (
          <ListRow
            key={t.id}
            to={`/trips/${t.id}`}
            icon={t.icon || '🧳'}
            title={t.title}
            meta={<>{formatDateRange(t.startDate, t.endDate)}{t.groupTitle ? ` · ${t.groupTitle}` : ''}</>}
            value={`${t.itemCount} item${t.itemCount !== 1 ? 's' : ''}`}
            chevron
          />
        ))}
      </List>}
      </PageGate>}

      {groups.length > 0 && <FabButton onClick={() => setShowNew(true)} label="New trip" />}

      {showNew && (
        <TripFormSheet
          groups={groups}
          onClose={() => setShowNew(false)}
          onSaved={id => navigate(`/trips/${id}`)}
        />
      )}
    </>
  )
}
