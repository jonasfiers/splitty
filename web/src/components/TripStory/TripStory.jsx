import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react'
import Icon from '../Icon/Icon.jsx'
import { photoSrc, PhotoViewer } from '../TripPhotos/TripPhotos.jsx'
import { formatDay, formatDateRange, daysBetween, dayOf, timeOf, itemIcon, describe } from '../../utils/trip.js'
import { tripIcon } from '../../utils/icons.js'
import StoryMap, { LEG_MS } from './StoryMap.jsx'
import './TripStory.css'

// A finished trip as a slideshow (2026-11-25), what a follow link opens on
// once the trip has ended. One map stays under every slide and travels with
// the trip, stop by stop: each journey is drawn from where it starts to where
// it ends, each place (an activity, the town of a stay) is flown in to, and
// the photos taken there follow as cards over the map, which shows where each
// was taken (and opens it full screen on request). A title card opens it; the end
// card shows the whole route. Swipe, tap the sides or use the arrow keys; Play
// moves on by itself until someone touches it. Everything shown is what the
// follow view already gives (api/followService.js).

const STOP_MS = 3500
const PHOTO_MS = 5000

// The two ways to see a trip that has been: Journey (this slideshow) and Day
// by day (the follow page's list), always offered as a pair.
export function ViewSwitch({ current, onJourney, onDays, dark = false }) {
  return (
    <div className={`view-switch${dark ? ' dark' : ''}`} role="group" aria-label="How to see the trip">
      <button type="button" aria-pressed={current === 'journey'} onClick={current === 'journey' ? undefined : onJourney}>
        <Icon name="play" /> Journey
      </button>
      <button type="button" aria-pressed={current === 'days'} onClick={current === 'days' ? undefined : onDays}>
        <Icon name="list" /> Day by day
      </button>
    </div>
  )
}

const plural = (n, word) => `${n.toLocaleString('en')} ${word}${n !== 1 ? 's' : ''}`
// "16 days · 9 towns · 3,100 km · 412 photos"
export const summaryLine = s => (s
  ? [plural(s.days, 'day'), s.towns > 1 && plural(s.towns, 'town'), s.km >= 100 && `${s.km.toLocaleString('en')} km`, s.photos > 0 && plural(s.photos, 'photo')]
      .filter(Boolean).join(' · ')
  : '')

// In trip order; a start without a time sorts as the timeline draws it (a stay
// from mid-afternoon, anything else from the start of its day).
const sortKey = item => (timeOf(item.start) ? item.start : `${dayOf(item.start)}T${item.kind === 'stay' ? '15:00' : '00:00'}`)

// The trip as stops: a journey between two places on the map (a leg), or a
// place (one or more activities or a stay there in a row). Each photo goes
// with the stop or journey under way when it was taken.
export function buildSteps({ items, places, photos }) {
  const byId = new Map(places.filter(p => p.lat != null && p.lon != null).map(p => [p.id, p]))
  const segs = []
  for (const item of items.filter(i => dayOf(i.start)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
    const at = sortKey(item)
    if (item.kind === 'transport') {
      const from = byId.get(item.fromPlaceId), to = byId.get(item.toPlaceId)
      if (from && to && from.id !== to.id) segs.push({ kind: 'leg', item, at, from, to, places: [from, to] })
      continue
    }
    const place = byId.get(item.placeId)
    if (!place) continue
    const prev = segs[segs.length - 1]
    if (prev?.kind === 'stop' && prev.place.id === place.id) { prev.items.push(item); continue }
    segs.push({ kind: 'stop', item, items: [item], at, place, places: [place] })
  }
  const shots = segs.map(() => [])
  const loose = []
  let k = 0
  for (const p of photos) {
    if (!p.at) continue
    while (k + 1 < segs.length && segs[k + 1].at <= p.at) k++
    if (segs.length) shots[k].push(p)
    else loose.push(p)
  }
  const steps = [{ kind: 'title', key: 'title' }]
  segs.forEach((seg, i) => {
    steps.push({ kind: seg.kind, key: `${seg.kind}-${seg.item.id}`, seg, segIndex: i })
    for (const photo of shots[i]) steps.push({ kind: 'photo', key: `photo-${photo.album}-${photo.id}`, seg, segIndex: i, photo })
  })
  for (const photo of loose) steps.push({ kind: 'photo', key: `photo-${photo.album}-${photo.id}`, photo })
  steps.push({ kind: 'end', key: 'end' })
  return { steps, segs }
}

// The places of segment k and what came before it since the day before: the
// stretch just travelled, never what is still to come.
function around(segs, k) {
  if (!segs.length) return []
  const upto = Math.min(k, segs.length - 1)
  const day = dayOf(segs[upto].at)
  return segs.slice(0, upto + 1).filter(g => daysBetween(dayOf(g.at), day) <= 1).flatMap(g => g.places)
}

// What the map shows at a step: the journeys travelled so far, the places
// reached (the current one marked), the journey under way, where a photo was
// taken, what to frame. `overview` (while scrubbing): a loose frame of the
// stretch just travelled (since the day before), which glides along; so
// the long flights home don't shrink the rest of the trip to a dot.
function sceneOf({ steps, segs }, at, animate, overview = false) {
  const s = steps[at]
  const upto = s.kind === 'title' ? 0 : s.kind === 'end' ? segs.length - 1 : s.segIndex ?? segs.length - 1
  const shown = segs.slice(0, upto + 1)
  const current = s.kind === 'end' || s.kind === 'title' ? null : s.seg
  const legOf = seg => ({ id: seg.item.id, from: seg.from, to: seg.to, icon: itemIcon(seg.item) })
  const under = s.kind === 'leg' ? s.seg : null
  const pins = new Map()
  for (const g of shown) {
    if (s.kind === 'title') break
    if (g.kind === 'leg') {
      for (const p of [g.from, g.to]) if (!pins.has(p.id)) pins.set(p.id, { place: p, icon: 'map-pin', kind: '' })
    } else {
      const stay = g.items.find(i => i.kind === 'stay')
      pins.set(g.place.id, { place: g.place, icon: itemIcon(stay || g.item), kind: stay ? 'stay' : g.item.kind })
    }
  }
  if (current) for (const p of current.places) { const pin = pins.get(p.id); if (pin) pins.set(p.id, { ...pin, current: true }) }
  const everywhere = segs.flatMap(g => g.places)
  // A photo with a location: shown where it was taken, framed with its stop.
  const shot = s.kind === 'photo' && s.photo.lat != null && s.photo.lon != null
    ? { lat: s.photo.lat, lon: s.photo.lon, src: photoSrc(s.photo.thumb) }
    : null
  const focus = s.kind === 'end' ? everywhere : current ? current.places : (segs[0]?.places ?? everywhere)
  return {
    pins: [...pins.values()],
    drawn: s.kind === 'title' ? [] : shown.filter(g => g.kind === 'leg' && g !== under).map(legOf),
    leg: under ? legOf(under) : null,
    animate: animate && s.kind !== 'title' && s.kind !== 'end',
    photo: shot,
    focus: overview ? (s.kind === 'end' ? everywhere : [...around(segs, s.segIndex ?? 0), ...(shot ? [shot] : [])]) : shot ? [...(current ? focus : []), shot] : focus,
    glide: overview,
  }
}

export default function TripStory({ view, onAllDays, home }) {
  const built = useMemo(() => buildSteps(view), [view])
  const { steps } = built
  // `forward`: arrived by one step on, so the map travels there.
  const [pos, setPos] = useState({ at: 0, forward: false })
  const { at } = pos
  const [playing, setPlaying] = useState(false)
  const last = steps.length - 1
  const go = useCallback((by, byHand = true) => {
    if (byHand) setPlaying(false)
    setPos(p => ({ at: Math.min(Math.max(p.at + by, 0), last), forward: by === 1 }))
  }, [last])
  const jump = (to, forward = to === 1) => setPos({ at: to, forward })
  // Play's speed (the bottom bar): 1×, 2×, ½×; the map's flying and drawing follow.
  const [speed, setSpeed] = useState(1)
  const speedRef = useRef(speed)
  speedRef.current = speed
  const nextSpeed = () => setSpeed(v => (v === 1 ? 2 : v === 2 ? 0.5 : 1))
  // Scrubbing: where the bar would land while it is dragged; it jumps there on release.
  const [scrub, setScrub] = useState(null)
  const step = steps[at]
  const { trip, sharer, summary } = view
  const placeName = useCallback(id => view.places.find(p => p.id === id)?.name, [view.places])
  const scrubbing = scrub != null
  const scene = useMemo(
    () => (scrubbing ? sceneOf(built, scrub, false, true) : sceneOf(built, at, pos.forward)),
    [built, at, pos.forward, scrubbing, scrub],
  )

  // The panels over the map are measured before the map frames (its effect
  // runs after this one), so it keeps what they cover free.
  // A photo's card lies along the bottom, or on the right of a wide screen
  // (TripStory.css, the same aspect ratio).
  const top = useRef(null)
  const bottom = useRef(null)
  const card = useRef(null)
  const insetRef = useRef({ top: 0, bottom: 0, left: 0, right: 0 })
  useLayoutEffect(() => {
    const wide = window.matchMedia('(min-aspect-ratio: 5/4)').matches
    // Scrubbing: only the bar and its label (with a photo's thumbnail) lie over the map.
    if (scrubbing) { insetRef.current = { top: 56, bottom: 190, left: 0, right: 0 }; return }
    insetRef.current = {
      top: top.current ? top.current.offsetHeight + 72 : 56,
      bottom: bottom.current ? bottom.current.offsetHeight + 72 : card.current && !wide ? card.current.offsetHeight + 62 : 40,
      left: 0,
      right: card.current && wide ? card.current.offsetWidth + 24 : 0,
    }
  }, [at, scrubbing])
  // A photo opened full screen (the trip page's viewer); the slideshow waits.
  const [full, setFull] = useState(null)

  // Play: on to the next step after a while; a video moves on when it ends.
  // It waits while the bar is dragged, and goes on from where it is let go.
  useEffect(() => {
    if (!playing || scrubbing || at >= last || step.photo?.play) return
    const t = setTimeout(() => go(1, false), (step.kind === 'leg' ? LEG_MS : step.kind === 'stop' ? STOP_MS : PHOTO_MS) / speed)
    return () => clearTimeout(t)
  }, [playing, scrubbing, at, last, step, go, speed])

  useEffect(() => {
    const key = e => {
      if (full || e.target.closest?.('input')) return // the viewer, or the scrub bar, has the keys
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1)
      else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'Escape') onAllDays()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [go, onAllDays, full])

  // The next two photos load while this step shows.
  useEffect(() => {
    for (const n of [at + 1, at + 2]) {
      const s = steps[n]
      if (s?.kind === 'photo' && !s.photo.play) new Image().src = photoSrc(s.photo.preview)
    }
  }, [at, steps])

  // A swipe moves one step; a tap on the left third goes back, elsewhere on.
  const down = useRef(null)
  const onPointerDown = e => {
    down.current = e.target.closest('button, a, video, input, .story-controls') ? null : { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = e => {
    const s = down.current
    down.current = null
    if (!s) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) go(e.clientX < window.innerWidth / 3 ? -1 : 1)
  }

  const play = () => { if (at === 0 || at === last) jump(1); setPlaying(true) }
  const cover = view.photos[0]
  // How long Play takes, roughly.
  const minutes = Math.max(1, Math.round(steps.reduce((ms, s) => ms + (s.kind === 'leg' ? LEG_MS : s.kind === 'stop' ? STOP_MS : s.kind === 'photo' ? PHOTO_MS : 0), 0) / 60000))
  // "Day 4 · Thu 12 Nov · 14:30"
  const when = moment => [
    `Day ${daysBetween(trip.startDate, dayOf(moment)) + 1}`, formatDay(dayOf(moment)), timeOf(moment),
  ].filter(Boolean).join(' · ')
  // For the scrub bar: "Day 4 · Taroko Gorge".
  const labelOf = s => (s.kind === 'title' ? 'Start' : s.kind === 'end' ? 'The whole route'
    : `Day ${daysBetween(trip.startDate, dayOf(s.photo?.at || s.seg.item.start)) + 1} · ${s.seg ? titleOf(s.seg) : 'Photo'}`)
  const titleOf = seg => (seg.kind === 'stop' ? seg.items.map(i => i.title).join(' · ') : seg.item.title)
  // Where, unless the title says it already ("Stay in Hualien").
  const described = step.seg && (step.kind === 'leg' || step.kind === 'stop') ? describe(step.seg.item, placeName) : ''
  const where = described && !titleOf(step.seg).includes(described) ? described : ''

  return (
    <div className={`story${scrubbing ? ' scrubbing' : ''}`} role="region" aria-roledescription="slideshow" aria-label={`${trip.title}, as a slideshow`}
      onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <StoryMap scene={scene} insetRef={insetRef} speedRef={speedRef} />

      <div className="story-stage" key={step.key}>
        {step.kind === 'title' && (
          <div className="story-title">
            {cover && <img className="story-cover" src={photoSrc(cover.preview)} alt="" />}
            <div className="story-title-text">
              <p className="story-kicker">{sharer}’s trip</p>
              <h1><Icon name={tripIcon(trip)} /> {trip.title}</h1>
              {/* While still on (a kept link), the end is not given away. */}
              <p>{trip.endDate ? formatDateRange(trip.startDate, trip.endDate) : `Since ${formatDay(trip.startDate)}`}</p>
              <p className="story-summary">{summaryLine(summary)}</p>
              <div className="story-choices">
                <button type="button" className="story-choice primary" onClick={play}>
                  <span className="story-choice-name"><Icon name="play" /> Watch the journey</span>
                  <span>The route on a map, stop by stop, with the photos · about {minutes} min</span>
                </button>
                <button type="button" className="story-choice" onClick={onAllDays}>
                  <span className="story-choice-name"><Icon name="list" /> Day by day</span>
                  <span>Every day with its times and places, at your own pace</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {(step.kind === 'leg' || step.kind === 'stop') && (
          <div className="story-panel story-panel-top" ref={top}>
            <p className="story-when">{when(step.seg.item.start)}</p>
            <p className="story-what"><Icon name={itemIcon(step.seg.item)} /> {titleOf(step.seg)}</p>
            {where && <p className="story-where">{where}</p>}
          </div>
        )}

        {step.kind === 'photo' && (
          // Sized from the photo's own shape, so it can be measured before it loads.
          <figure className="story-card" ref={card} style={{ '--r': step.photo.ratio || 1.5 }}>
            <div className="story-card-frame">
              {step.photo.play ? (
                <video src={photoSrc(step.photo.play)} poster={photoSrc(step.photo.preview)} controls autoPlay muted playsInline
                  onEnded={() => { if (playing) go(1, false) }} />
              ) : (
                <img src={photoSrc(step.photo.preview)} alt="" />
              )}
              {!step.photo.play && (
                <button type="button" className="story-card-full" onClick={() => { setPlaying(false); setFull(step.photo) }} aria-label="Full screen">
                  <Icon name="maximize" />
                </button>
              )}
            </div>
            <figcaption>{[step.seg && titleOf(step.seg), when(step.photo.at)].filter(Boolean).join(' · ')}</figcaption>
          </figure>
        )}

        {step.kind === 'end' && (
          <>
            <div className="story-panel story-panel-top" ref={top}>
              <h2><Icon name={tripIcon(trip)} /> {trip.title}</h2>
              <p className="story-where">{summaryLine(summary)}</p>
            </div>
            <div className="story-panel story-panel-bottom" ref={bottom}>
              <div className="story-actions">
                <button type="button" className="btn btn-primary" onClick={() => { setPlaying(false); jump(0) }}><Icon name="rotate-ccw" /> Watch again</button>
                <button type="button" className="btn btn-ghost" onClick={onAllDays}><Icon name="list" /> Day by day</button>
              </div>
              <p className="story-foot">Shared with <a href={home}>Splitty</a></p>
            </div>
          </>
        )}
      </div>

      {step.kind !== 'title' && (
        <div className="story-controls">
          <button type="button" className="story-speed" onClick={nextSpeed} aria-label={`Speed ${speed}×, change`}>
            {speed === 0.5 ? '½' : speed}×
          </button>
          <div className="story-scrub">
            {scrubbing && (
              <span className="story-scrub-label" style={{ left: `clamp(80px, ${(scrub / last) * 100}%, calc(100% - 80px))` }}>
                {steps[scrub].kind === 'photo' && <img src={photoSrc(steps[scrub].photo.thumb)} alt="" />}
                <span>{labelOf(steps[scrub])}</span>
              </span>
            )}
            <input
              type="range" min={0} max={last} step={1} value={scrub ?? at}
              aria-label="Where in the trip" aria-valuetext={labelOf(steps[scrub ?? at])}
              onChange={e => setScrub(Number(e.target.value))}
              onPointerUp={() => { if (scrub != null) { jump(scrub, false); setScrub(null) } }}
              onKeyUp={() => { if (scrub != null) { jump(scrub, false); setScrub(null) } }}
              onBlur={() => setScrub(null)}
            />
          </div>
        </div>
      )}
      <div className="story-top">
        {step.kind === 'title' ? <span /> : <ViewSwitch current="journey" onDays={onAllDays} dark />}
        {step.kind !== 'title' && step.kind !== 'end' && (
          <button type="button" className="story-btn" onClick={() => (playing ? setPlaying(false) : play())} aria-label={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
        )}
      </div>
      {full && <PhotoViewer photos={[full]} index={0} onClose={() => setFull(null)} />}
      {at > 0 && <button type="button" className="story-nav prev" onClick={() => go(-1)} aria-label="Previous"><Icon name="chevron-left" /></button>}
      {at < last && <button type="button" className="story-nav next" onClick={() => go(1)} aria-label="Next"><Icon name="chevron-right" /></button>}
    </div>
  )
}
