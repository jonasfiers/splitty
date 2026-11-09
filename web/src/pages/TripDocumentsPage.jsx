import { useCallback, useEffect, useState } from 'react'
import LoadFailed from '../components/LoadFailed.jsx'
import { useParams } from 'react-router'
import { swr } from '../utils/cache.js'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import TripDocuments from '../components/TripDocuments/TripDocuments.jsx'

// A trip's travel documents on their own page, reached from the "Documents"
// chip under the trip's title (TripDetailPage), so the trip page opens on
// its plan. The list itself is components/TripDocuments.
export default function TripDocumentsPage() {
  const { tripId } = useParams()
  const [trip, setTrip] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setError(null); setTrip(null); setAttempt(n => n + 1) }, [])

  // The trip (for its name) and its documents together, so the page shows once,
  // complete; usually both are in the cache already from the trip page
  // (utils/cache.js). The list below then finds the documents there at once.
  useEffect(() => {
    const { cached, fresh } = swr([[`/trips/${tripId}`], [`/trips/${tripId}/documents`]],
      ([tripRes]) => setTrip(tripRes.data.trip), { fresh: attempt > 0 })
    fresh.catch(err => { if (!cached) setError(err) })
  }, [tripId, attempt])

  const bare = <PageHeader compact crumbs={[{ to: '/trips', label: 'Trips' }]} name="Documents" />
  if (error?.response?.status === 404) return <>{bare}<p className="error">This trip no longer exists.</p></>
  if (error) return <>{bare}<LoadFailed error={error} what="this trip’s documents" onRetry={retry} /></>
  if (!trip) return <>{bare}<Loading /></>

  return (
    <>
      <PageHeader
        crumbs={[{ to: '/trips', label: 'Trips' }, { to: `/trips/${tripId}`, label: trip.title }]}
        title="Documents"
        name="Documents"
      >
        {trip.icon} {trip.title}
      </PageHeader>
      <TripDocuments tripId={tripId} tripTitle={trip.title} heading={false} />
    </>
  )
}
