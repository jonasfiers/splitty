import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useParams } from 'react-router'
import Loading from '../components/Loading.jsx'
import Icon from '../components/Icon/Icon.jsx'
import Expandable from '../components/Expandable/Expandable.jsx'
import { DayHead, EntryRow } from '../components/TripDay/TripDay.jsx'
import { photosByDay, DayPhotos, PhotoViewer } from '../components/TripPhotos/TripPhotos.jsx'
import { buildTimeline, formatDay } from '../utils/trip.js'
import { setTripKinds } from '../utils/tripKinds.js'
import { tripIcon } from '../utils/icons.js'

// Splitty itself: on follow.<domain> that is splitty.<domain>.
const appHome = () => (window.location.hostname.startsWith('follow.') ? `https://${window.location.hostname.replace(/^follow\./, 'splitty.')}/` : '/login')

const TripMap = lazy(() => import('../components/TripMap/TripMap.jsx'))

// Public, no login: "Follow Jonas's trip" (api/followService.js). The server
// has already left out everything private (later days, hotels' names and
// exact places, bookings, money, other members), so this page only lays out
// what it gets: the newest day first, the map, and the photos.
export default function FollowPage() {
  const { token } = useParams()
  const [view, setView] = useState(null)
  const [failed, setFailed] = useState(null)
  const [viewer, setViewer] = useState(null)
  const openPhotos = useCallback((list, index) => setViewer({ list, index }), [])
  const noop = useCallback(() => {}, [])

  useEffect(() => {
    // Plain fetch, not the app's client: a follower has no account, and the
    // client's sign-in handling must not kick in here.
    fetch(`/api/follow/${encodeURIComponent(token)}`, { credentials: 'omit' })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(v => { setView(v); setTripKinds(v.kinds) })
      .catch(status => setFailed(status === 404 ? 'gone' : 'error'))
  }, [token])

  useEffect(() => {
    if (view) document.title = `${view.sharer}'s trip · ${view.trip.title}`
  }, [view])

  if (failed) {
    return (
      <div className="privacy-page">
        <article className="privacy follow">
          <h1>Trip not found</h1>
          <p>{failed === 'gone' ? 'This link does not work (any more). Ask the person who sent it for a new one.' : 'Something went wrong. Try again in a moment.'}</p>
        </article>
      </div>
    )
  }
  if (!view) return <div className="privacy-page"><Loading /></div>

  const { trip, items, places, photos, today, sharer } = view
  const placeName = id => places.find(p => p.id === id)?.name
  const days = view.started
    ? buildTimeline({ startDate: trip.startDate, endDate: trip.endDate || today }, items).filter(d => d.day <= today && d.day >= trip.startDate).reverse()
    : []
  const dayPhotos = photosByDay(photos)
  const located = places.some(p => p.lat != null)

  return (
    <div className="privacy-page">
      <article className="privacy follow">
        <p className="follow-kicker">Follow {sharer}’s trip</p>
        <h1><Icon name={tripIcon(trip)} /> {trip.title}</h1>
        <p className="privacy-updated">
          {!view.started ? 'Not started yet'
            : trip.endDate ? `${formatDay(trip.startDate)} – ${formatDay(trip.endDate)}`
            : `Since ${formatDay(trip.startDate)} · day ${days.length}`}
        </p>

        {!view.started && <p>{sharer}’s trip hasn’t started yet. Check back once it has: each day appears here as it comes.</p>}

        {located && (
          <div className="follow-map">
            {/* As on the trip page: a full-screen button, and while the trip is
                on, framed on today's places with a switch to the whole trip. */}
            <Suspense fallback={<Loading />}>
              <Expandable label={`${trip.title} · Map`}>
                <TripMap places={places} items={items} onOpenItem={noop} photos={photos} onOpenPhotos={openPhotos} today={view.started && !trip.endDate ? today : null} />
              </Expandable>
            </Suspense>
          </div>
        )}

        {days.map(d => (
          <section key={d.day} className={`trip-day${d.day === today ? ' today' : ''}`}>
            <DayHead trip={trip} day={d} />
            {d.entries.length > 0 ? (
              <div className="list list-tight entry-list">
                {d.entries.map(entry => (
                  <EntryRow key={`${entry.item.id}-${entry.phase}`} entry={entry} state={d.day < today ? 'past' : null} placeName={placeName} />
                ))}
              </div>
            ) : <div className="trip-day-empty">{d.sleepingAt.length ? 'A day around town' : 'Nothing planned'}</div>}
            <DayPhotos photos={dayPhotos[d.day]} onOpen={openPhotos} />
          </section>
        ))}

        <p className="follow-foot">
          Shared with <a href={appHome()}>Splitty</a>. Only past days and today are shown; where {sharer} stays is shown by town only.
        </p>
      </article>
      {viewer && <PhotoViewer photos={viewer.list} index={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}
