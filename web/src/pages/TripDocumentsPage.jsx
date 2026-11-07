import { useCallback, useEffect, useState } from 'react'
import LoadFailed from '../components/LoadFailed.jsx'
import { useParams } from 'react-router'
import client from '../api/client'
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

  useEffect(() => {
    client.get(`/trips/${tripId}`)
      .then(({ data }) => setTrip(data.trip))
      .catch(err => setError(err))
  }, [tripId, attempt])

  if (error?.response?.status === 404) return <p className="error">This trip no longer exists.</p>
  if (error) return <LoadFailed error={error} what="this trip’s documents" onRetry={retry} />
  if (!trip) return <Loading />

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
