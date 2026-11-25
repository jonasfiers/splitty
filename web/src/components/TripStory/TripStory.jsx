import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react'
import Icon from '../Icon/Icon.jsx'
import Loading from '../Loading.jsx'
import { EntryRow } from '../TripDay/TripDay.jsx'
import { photosByDay, photoSrc } from '../TripPhotos/TripPhotos.jsx'
import { buildTimeline, formatDay, formatDateRange, daysBetween, timeOf } from '../../utils/trip.js'
import { tripIcon } from '../../utils/icons.js'
import './TripStory.css'

const TripMap = lazy(() => import('../TripMap/TripMap.jsx'))

// A finished trip as a slideshow (2026-11-25), what a follow link opens on
// once the trip has ended: a title card, then day by day a card with the
// day's map and what happened, followed by that day's photos full screen, and
// an end card with the whole route. Swipe, tap the sides or use the arrow
// keys; Play moves on by itself until someone touches it. Everything shown is
// what the follow view already gives (api/followService.js).

const PHOTO_MS = 5000
const DAY_MS = 6000

const plural = (n, word) => `${n.toLocaleString('en')} ${word}${n !== 1 ? 's' : ''}`
// "16 days · 9 towns · 3,100 km · 412 photos"
export const summaryLine = s => (s
  ? [plural(s.days, 'day'), s.towns > 1 && plural(s.towns, 'town'), s.km >= 100 && `${s.km.toLocaleString('en')} km`, s.photos > 0 && plural(s.photos, 'photo')]
      .filter(Boolean).join(' · ')
  : '')

// Where a day was spent: the town slept in that night ("Stay in Hualien").
const townOf = day => day.sleepingAt.map(s => s.title.replace(/^Stay in /, '')).find(t => t && t !== 'Stay') || ''

// What a day's map shows: its own entries and where it ended, nothing else.
function dayMap(day, places) {
  const items = [...new Map([...day.entries.map(e => e.item), ...day.sleepingAt].map(i => [i.id, i])).values()]
  const ids = new Set(items.flatMap(i => [i.placeId, i.fromPlaceId, i.toPlaceId]).filter(Boolean))
  return { items, places: places.filter(p => ids.has(p.id) && p.lat != null) }
}

// Days with nothing to show (no journey, no photos) are skipped.
export function buildSlides({ trip, items, places, photos }) {
  const byDay = photosByDay(photos)
  const slides = [{ kind: 'title', key: 'title' }]
  for (const d of buildTimeline({ startDate: trip.startDate, endDate: trip.endDate }, items)) {
    if (d.outsideTrip) continue
    const dayPhotos = byDay[d.day] || []
    const moved = d.entries.some(e => e.item.kind === 'transport')
    if (!moved && !dayPhotos.length) continue
    const base = { d, n: daysBetween(trip.startDate, d.day) + 1, town: townOf(d) }
    slides.push({ kind: 'day', key: `day-${d.day}`, ...base, map: dayMap(d, places) })
    for (const photo of dayPhotos) slides.push({ kind: 'photo', key: `photo-${photo.album}-${photo.id}`, ...base, photo })
  }
  slides.push({ kind: 'end', key: 'end' })
  return slides
}

const noop = () => {}

// The height of an element, kept up to date.
function useHeight() {
  const [el, setEl] = useState(null)
  const [h, setH] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => setH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, h]
}

// A full-screen map with panels over its top and bottom; the map frames its
// places in the space between them. Not to be panned: a swipe over it moves
// the slideshow instead.
function MapSlide({ places, items, top, bottom, className = '' }) {
  const [topRef, topH] = useHeight()
  const [bottomRef, bottomH] = useHeight()
  // The panels' own room plus their distance from the screen's edges.
  const inset = useMemo(() => ({ top: topH ? topH + 72 : 0, bottom: bottomH ? bottomH + 24 : 0 }), [topH, bottomH])
  return (
    <div className={`story-mapslide ${className}`}>
      {places.length > 0 && (
        <div className="story-map">
          <Suspense fallback={<Loading />}>
            <TripMap places={places} items={items} onOpenItem={noop} forFollowers inset={inset} />
          </Suspense>
        </div>
      )}
      {top && <div className="story-panel story-panel-top" ref={topRef}>{top}</div>}
      {bottom && <div className="story-panel story-panel-bottom" ref={bottomRef}>{bottom}</div>}
    </div>
  )
}

export default function TripStory({ view, onAllDays, home }) {
  const slides = useMemo(() => buildSlides(view), [view])
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const last = slides.length - 1
  // Moving by hand stops Play.
  const go = useCallback((by, byHand = true) => {
    if (byHand) setPlaying(false)
    setAt(i => Math.min(Math.max(i + by, 0), last))
  }, [last])
  const slide = slides[at]
  const { trip, sharer, summary } = view
  const placeName = useCallback(id => view.places.find(p => p.id === id)?.name, [view.places])

  // Play: on to the next slide after a while; a video moves on when it ends.
  useEffect(() => {
    if (!playing || at >= last || slide.photo?.play) return
    const t = setTimeout(() => go(1, false), slide.kind === 'day' ? DAY_MS : PHOTO_MS)
    return () => clearTimeout(t)
  }, [playing, at, last, slide, go])

  useEffect(() => {
    const key = e => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1)
      else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'Escape') onAllDays()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [go, onAllDays])

  // The next two photos load while this one shows.
  useEffect(() => {
    for (const n of [at + 1, at + 2]) {
      const s = slides[n]
      if (s?.kind === 'photo' && !s.photo.play) new Image().src = photoSrc(s.photo.preview)
    }
  }, [at, slides])

  // A swipe moves one slide; a tap on the left third goes back, elsewhere on.
  const down = useRef(null)
  const onPointerDown = e => {
    down.current = e.target.closest('button, a, video') ? null : { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = e => {
    const s = down.current
    down.current = null
    if (!s) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) go(e.clientX < window.innerWidth / 3 ? -1 : 1)
  }

  const play = () => { setAt(i => (i === 0 || i === last ? 1 : i)); setPlaying(true) }
  const located = view.places.filter(p => p.lat != null)
  const cover = view.photos[0]
  const caption = s => [`Day ${s.n}`, formatDay(s.d.day), s.town].filter(Boolean).join(' · ')

  return (
    <div className="story" role="region" aria-roledescription="slideshow" aria-label={`${trip.title}, as a slideshow`}
      onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="story-progress" aria-hidden="true"><span style={{ width: `${(at / last) * 100}%` }} /></div>
      <div className="story-top">
        <button type="button" className="story-btn" onClick={onAllDays}><Icon name="list" /> All days</button>
        {(slide.kind === 'day' || slide.kind === 'photo') && (
          <button type="button" className="story-btn" onClick={() => (playing ? setPlaying(false) : play())} aria-label={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
        )}
      </div>

      <div className="story-stage" key={slide.key}>
        {slide.kind === 'title' && (
          <div className="story-title">
            {cover && <img className="story-cover" src={photoSrc(cover.preview)} alt="" />}
            <div className="story-title-text">
              <p className="story-kicker">{sharer}’s trip</p>
              <h1><Icon name={tripIcon(trip)} /> {trip.title}</h1>
              <p>{formatDateRange(trip.startDate, trip.endDate)}</p>
              <p className="story-summary">{summaryLine(summary)}</p>
              <div className="story-actions">
                <button type="button" className="btn btn-primary" onClick={play}><Icon name="play" /> Play</button>
                <button type="button" className="btn story-ghost" onClick={onAllDays}>See all days</button>
              </div>
            </div>
          </div>
        )}

        {slide.kind === 'day' && (
          <MapSlide
            className="story-day"
            places={slide.map.places}
            items={slide.map.items}
            top={(
              <div className="story-day-head">
                <span className="story-day-n">Day {slide.n}</span>
                <span>{[formatDay(slide.d.day), slide.town].filter(Boolean).join(' · ')}</span>
              </div>
            )}
            bottom={slide.d.entries.length > 0 && (
              <div className="list list-tight entry-list story-entries">
                {slide.d.entries.map(entry => (
                  <EntryRow key={`${entry.item.id}-${entry.phase}`} entry={entry} placeName={placeName} />
                ))}
              </div>
            )}
          />
        )}

        {slide.kind === 'photo' && (
          <figure className="story-photo">
            <img className="story-backdrop" src={photoSrc(slide.photo.thumb)} alt="" aria-hidden="true" />
            {slide.photo.play ? (
              <video src={photoSrc(slide.photo.play)} poster={photoSrc(slide.photo.preview)} controls autoPlay muted playsInline
                onEnded={() => { if (playing) go(1, false) }} />
            ) : (
              <img src={photoSrc(slide.photo.preview)} alt="" />
            )}
            <figcaption>{caption(slide)}{timeOf(slide.photo.at) && ` · ${timeOf(slide.photo.at)}`}</figcaption>
          </figure>
        )}

        {slide.kind === 'end' && (
          <MapSlide
            className="story-end"
            places={located}
            items={view.items}
            top={(
              <>
                <h2><Icon name={tripIcon(trip)} /> {trip.title}</h2>
                <p className="story-summary">{summaryLine(summary)}</p>
              </>
            )}
            bottom={(
              <>
                <div className="story-actions">
                  <button type="button" className="btn btn-primary" onClick={() => { setPlaying(false); setAt(0) }}><Icon name="rotate-ccw" /> Watch again</button>
                  <button type="button" className="btn btn-ghost" onClick={onAllDays}>See all days</button>
                </div>
                <p className="story-foot">Shared with <a href={home}>Splitty</a></p>
              </>
            )}
          />
        )}
      </div>

      {at > 0 && <button type="button" className="story-nav prev" onClick={() => go(-1)} aria-label="Previous"><Icon name="chevron-left" /></button>}
      {at < last && <button type="button" className="story-nav next" onClick={() => go(1)} aria-label="Next"><Icon name="chevron-right" /></button>}
    </div>
  )
}
