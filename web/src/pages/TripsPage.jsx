import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import client from '../api/client'
import FabButton from '../components/FabButton/FabButton.jsx'
import Loading from '../components/Loading.jsx'
import TripList, { TripCards } from '../components/TripForm/TripList.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import TripFormSheet from '../components/TripForm/TripFormSheet.jsx'
import { today } from '../utils/trip.js'
import TabHeader from '../components/PageHeader/TabHeader.jsx'

import { useOfflineDocs } from '../utils/useOfflineDocs.js'

export default function TripsPage() {
  const offline = useOfflineDocs()
  const navigate = useNavigate()
  const [trips, setTrips] = useState([])
  const [groups, setGroups] = useState([])
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([client.get('/trips'), client.get('/groups')])
      .then(([tr, gr]) => {
        setTrips(tr.data.trips || [])
        setGroups(gr.data.groups || [])
      })
      .catch(err => setError(navigator.onLine === false || !err?.response
        ? 'No connection, so your trips cannot load. Documents kept on this device still open.'
        : 'Failed to load trips. Please refresh the page.'))
      .finally(() => setLoading(false))
  }, [])

  // From tablet width up, trips are shown as cards.
  const cards = useMediaQuery('(min-width: 768px)')


  const now = today()
  const upcoming = trips.filter(t => t.endDate >= now)
  // Most recent first: the trip you just came back from is the one you still open.
  const past = trips.filter(t => t.endDate < now).reverse()

  return (
    <>
      <TabHeader title="Trips" />

      {/* Before the error on purpose: offline, this is what still works. */}
      {offline?.length > 0 && (
        <Link to="/offline-documents" className="offline-docs-link">
          <span className="offline-docs-link-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><polyline points="7.5 10 10.5 13 16.5 7" /><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></svg>
          </span>
          <span>
            <strong>Offline documents</strong>
            <span className="offline-docs-link-sub">{offline.length} on this device · open without a connection</span>
          </span>
          <span className="offline-docs-link-chevron" aria-hidden="true">›</span>
        </Link>
      )}

      {error && <p className="error">{error}</p>}
      {/* Below the offline documents: they must not wait for the trips. */}
      {loading && <Loading />}

      {!loading && trips.length === 0 && !error && (
        <div className="empty-state">
          <img src="/cat-empty.svg" alt="" style={{ width: 80, height: 80 }} />
          <p className="empty-state-title">No trips yet</p>
          <p className="empty-state-sub">
            {groups.length === 0
              ? 'A trip is planned with a group. Create a group first.'
              : 'Plan the transport, the stays and the things to do, and split what they cost.'}
          </p>
        </div>
      )}

      {upcoming.length > 0 && <>
        <div className="section-label">Upcoming</div>
        {cards ? <TripCards trips={upcoming} /> : <TripList trips={upcoming} showGroup />}
      </>}

      {past.length > 0 && <>
        <div className="section-label">Past</div>
        {cards ? <TripCards trips={past} past /> : <TripList trips={past} showGroup />}
      </>}

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
