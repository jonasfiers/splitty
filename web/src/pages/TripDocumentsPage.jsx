import { useEffect, useState } from 'react'
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
  const [error, setError] = useState('')

  useEffect(() => {
    client.get(`/trips/${tripId}`)
      .then(({ data }) => setTrip(data.trip))
      .catch(err => setError(err.response?.status === 404 ? 'This trip no longer exists.' : 'Could not load the trip.'))
  }, [tripId])

  if (error) return <p className="error">{error}</p>
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
