import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import client from '../api/client'
import FabButton from '../components/FabButton/FabButton.jsx'
import Loading from '../components/Loading.jsx'
import TripList from '../components/TripForm/TripList.jsx'
import TripFormSheet from '../components/TripForm/TripFormSheet.jsx'
import { today } from '../utils/trip.js'

export default function TripsPage() {
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
      .catch(() => setError('Failed to load trips. Please refresh the page.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Loading />

  const now = today()
  const upcoming = trips.filter(t => t.endDate >= now)
  // Most recent first: the trip you just came back from is the one you still open.
  const past = trips.filter(t => t.endDate < now).reverse()

  return (
    <>
      <div className="page-header">
        <h1>Trips</h1>
      </div>

      {error && <p className="error">{error}</p>}

      {trips.length === 0 && !error && (
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
        <TripList trips={upcoming} showGroup />
      </>}

      {past.length > 0 && <>
        <div className="section-label">Past</div>
        <TripList trips={past} showGroup />
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
