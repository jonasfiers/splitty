import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { swr } from '../utils/cache.js'
import LoadFailed from '../components/LoadFailed.jsx'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import FollowLinks from '../components/FollowLinks/FollowLinks.jsx'
import Icon from '../components/Icon/Icon.jsx'
import { tripIcon } from '../utils/icons.js'

// A trip's follow links on their own page (2026-11-25), reached from the
// "Follow links" chip under the trip's title (TripDetailPage). Needs a
// connection: links are made and changed on the server.
export default function TripFollowPage() {
  const { tripId } = useParams()
  const [trip, setTrip] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setError(null); setTrip(null); setAttempt(n => n + 1) }, [])

  useEffect(() => {
    let shown = false
    const { cached, fresh } = swr([[`/trips/${tripId}`]], ([tripRes]) => { shown = true; setTrip(tripRes.data.trip) }, { fresh: attempt > 0 })
    fresh.catch(err => { if (!shown && !cached) setError(err) })
  }, [tripId, attempt])

  const bare = <PageHeader compact crumbs={[{ to: '/trips', label: 'Trips' }]} name="Follow links" />
  if (error?.response?.status === 404) return <>{bare}<p className="error">This trip no longer exists.</p></>
  if (error) return <>{bare}<LoadFailed error={error} what="this trip" onRetry={retry} /></>
  if (!trip) return <>{bare}<Loading /></>

  return (
    <>
      <PageHeader
        crumbs={[{ to: '/trips', label: 'Trips' }, { to: `/trips/${tripId}`, label: trip.title }]}
        title="Follow links"
        name="Follow links"
      >
        <Icon name={tripIcon(trip)} /> {trip.title}
      </PageHeader>
      <FollowLinks tripId={tripId} tripTitle={trip.title} />
    </>
  )
}
