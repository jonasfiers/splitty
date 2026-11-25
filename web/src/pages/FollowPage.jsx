import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useParams } from 'react-router'
import Loading from '../components/Loading.jsx'
import Icon from '../components/Icon/Icon.jsx'
import Expandable from '../components/Expandable/Expandable.jsx'
import { DayHead, EntryRow } from '../components/TripDay/TripDay.jsx'
import { photosByDay, DayPhotos, PhotoViewer } from '../components/TripPhotos/TripPhotos.jsx'
import { buildTimeline, formatDay } from '../utils/trip.js'
import { setTripKinds } from '../utils/tripKinds.js'
import { tripIcon } from '../utils/icons.js'
import TripStory, { summaryLine } from '../components/TripStory/TripStory.jsx'

// Splitty itself: on follow.<domain> that is splitty.<domain>.
const appHome = () => (window.location.hostname.startsWith('follow.') ? `https://${window.location.hostname.replace(/^follow\./, 'splitty.')}/` : '/login')

const TripMap = lazy(() => import('../components/TripMap/TripMap.jsx'))

// Public, no login: "Follow Jonas's trip" (api/followService.js). The server
// has already left out everything private (later days, hotels' names and
// exact places, bookings, money, other members), so this page only lays out
// what it gets: the newest day first, the map, and the photos. Once the trip
// has ended, or at once for a link kept to look back, it opens as a slideshow (TripStory); "All days" (#days) is this
// list, then from the first day on.
export default function FollowPage() {
  const { token } = useParams()
  const [view, setView] = useState(null)
  const [failed, setFailed] = useState(null)
  const [viewer, setViewer] = useState(null)
  // The list instead of the slideshow: #days, so Back returns to the slideshow.
  const [listed, setListed] = useState(() => window.location.hash === '#days')
  useEffect(() => {
    const changed = () => setListed(window.location.hash === '#days')
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  const fromStory = useRef(false)
  const showDays = useCallback(() => { fromStory.current = true; window.location.hash = 'days' }, [])
  const showStory = useCallback(() => {
    if (fromStory.current) window.history.back() // the hashchange shows it
    else { window.history.replaceState(null, '', window.location.pathname + window.location.search); setListed(false) }
  }, [])
  const openPhotos = useCallback((list, index) => setViewer({ list, index }), [])
  // A pin's item: the page scrolls to its day and the entry lights up a moment
  // (the map has left full screen first).
  const [flash, setFlash] = useState(null)
  const showItem = useCallback(item => {
    const day = (item.start || '').slice(0, 10)
    setFlash(item.id)
    setTimeout(() => setFlash(f => (f === item.id ? null : f)), 1800)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const row = document.querySelector(`.${CSS.escape(`follow-item-${item.id}`)}`)
      ;(row || document.getElementById(`day-${day}`))?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }))
  }, [])

  useEffect(() => {
    // Plain fetch, not the app's client: a follower has no account, and the
    // client's sign-in handling must not kick in here.
    fetch(`/api/follow/${encodeURIComponent(token)}`, { credentials: 'omit' })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(v => { setView(v); setTripKinds(v.kinds) })
      .catch(status => setFailed(status === 404 ? 'gone' : 'error'))
  }, [token])

  useEffect(() => {
    if (view) document.title = view.lookBack ? `${view.trip.title} · ${view.sharer}'s trip` : `${view.sharer}'s trip · ${view.trip.title}`
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

  if (view.lookBack && !listed) return <TripStory view={view} onAllDays={showDays} home={appHome()} />

  const { trip, items, places, photos, today, sharer } = view
  const placeName = id => places.find(p => p.id === id)?.name
  const days = view.started
    ? buildTimeline({ startDate: trip.startDate, endDate: trip.endDate || today }, items).filter(d => d.day <= today && d.day >= trip.startDate)
    : []
  // While on: the newest day first, past days greyed. Once ended: from the
  // first day, as a story, nothing greyed or marked as today.
  if (!view.lookBack) days.reverse()
  const dayPhotos = photosByDay(photos)
  const located = places.some(p => p.lat != null)

  return (
    <div className="privacy-page">
      <article className="privacy follow">
        <p className="follow-kicker">{view.lookBack ? `${sharer}’s trip` : `Follow ${sharer}’s trip`}</p>
        <h1><Icon name={tripIcon(trip)} /> {trip.title}</h1>
        <p className="privacy-updated">
          {!view.started ? 'Not started yet'
            : trip.endDate ? `${formatDay(trip.startDate)} – ${formatDay(trip.endDate)}`
            : `Since ${formatDay(trip.startDate)} · day ${days.length}`}
        </p>
        {view.lookBack && (
          <p className="follow-summary">
            {summaryLine(view.summary)}
            <button type="button" className="btn btn-ghost btn-sm" onClick={showStory}><Icon name="play" /> Slideshow</button>
          </p>
        )}

        {!view.started && <p>{sharer}’s trip hasn’t started yet. Check back once it has: each day appears here as it comes.</p>}

        {located && (
          <div className="follow-map">
            {/* As on the trip page: a full-screen button, and while the trip is
                on, framed on today's places with a switch to the whole trip. */}
            <Suspense fallback={<Loading />}>
              <Expandable label={`${trip.title} · Map`}>
                <TripMap places={places} items={items} onOpenItem={showItem} forFollowers photos={photos} onOpenPhotos={openPhotos} today={view.started && !trip.endDate ? today : null} />
              </Expandable>
            </Suspense>
          </div>
        )}

        {days.map(d => (
          <section key={d.day} id={`day-${d.day}`} className={`trip-day${d.day === today && !view.lookBack ? ' today' : ''}`}>
            <DayHead trip={trip} day={d} />
            {d.entries.length > 0 ? (
              <div className="list list-tight entry-list">
                {d.entries.map(entry => (
                  <EntryRow key={`${entry.item.id}-${entry.phase}`} entry={entry} state={d.day < today && !view.lookBack ? 'past' : null} placeName={placeName} className={`follow-item-${entry.item.id}${flash === entry.item.id ? ' flash' : ''}`} />
                ))}
              </div>
            ) : <div className="trip-day-empty">{d.sleepingAt.length ? 'A day around town' : 'Nothing planned'}</div>}
            <DayPhotos photos={dayPhotos[d.day]} onOpen={openPhotos} />
          </section>
        ))}

        <p className="follow-foot">
          Shared with <a href={appHome()}>Splitty</a>. {view.lookBack
            ? `Where ${sharer} stayed is shown by town only.`
            : `Only past days and today are shown; where ${sharer} stays is shown by town only.`}
        </p>
      </article>
      {viewer && <PhotoViewer photos={viewer.list} index={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}
