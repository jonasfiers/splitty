import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { addBasemap, arcBetween, mapOptions } from '../TripMap/mapParts.js'
import { iconSvg } from '../../utils/icons.js'

// The slideshow's one map (TripStory.jsx): it stays put under every slide and
// travels. A journey is flown out to (both ends in view) and then drawn from
// start to end with its icon moving along; a place is flown in to. Journeys
// already travelled stay drawn, places reached stay pinned. Not to be panned
// or zoomed by hand: a swipe moves the slideshow.
//
// `scene`: { pins: [{ place, icon, kind, current }], drawn: [leg], leg (being
// travelled, or null), animate (draw it now rather than show it done),
// focus: [{ lat, lon }] (what to frame), photo: { lat, lon, src } (where the
// photo on show was taken, drawn as its thumbnail) }. A leg: { id, from, to, icon }.
// `insetRef.current`: { top, bottom, left, right }, px kept free for what lies over the
// map; measured by the slideshow before this map frames (a layout effect).

const FLY_S = 1.3
const DRAW_MS = 2200
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const pinIcon = ({ icon, kind, current }) => L.divIcon({
  className: '',
  html: `<div class="trip-pin${kind ? ` kind-${kind}` : ''}${current ? ' story-pin-current' : ''}">${iconSvg(icon)}</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
})
const headIcon = icon => L.divIcon({ className: '', html: `<div class="story-head">${iconSvg(icon)}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] })
const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

// Where the map should look: the places, clear of the panels; one place as a
// box of a few km around it.
// `animate`: true flies there, 'glide' moves there briefly (scrubbing), false jumps.
function frame(map, focus, inset, animate, speed = 1) {
  if (!focus.length) return
  const { top = 0, bottom = 0, left = 0, right = 0 } = inset || {}
  const bounds = focus.length === 1
    ? L.latLng(focus[0].lat, focus[0].lon).toBounds(2500)
    : L.latLngBounds(focus.map(p => [p.lat, p.lon]))
  const opts = { paddingTopLeft: [40 + left, 40 + top], paddingBottomRight: [40 + right, 40 + bottom], maxZoom: focus.length === 1 ? 14 : 13 }
  if (animate === 'glide') map.fitBounds(bounds, { ...opts, animate: true, duration: 0.35 })
  else if (animate) map.flyToBounds(bounds, { ...opts, duration: FLY_S / speed })
  else map.fitBounds(bounds, { ...opts, animate: false })
}

// `speedRef.current`: 1, 2 or 0.5; the flying and drawing take that much less (more) time.
// `creditRef.current`: an element (the slideshow's bottom bar) the map's
// credit (OpenStreetMap, Protomaps) is moved into, out of the map's corner.
export default function StoryMap({ scene, insetRef, speedRef, creditRef }) {
  const el = useRef(null)
  const mapRef = useRef(null)
  const layers = useRef(null)
  const sceneRef = useRef(scene)
  sceneRef.current = scene

  useEffect(() => {
    const map = L.map(el.current, {
      ...mapOptions(), zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      touchZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0.25,
    })
    // Leaflet keeps it up to date wherever it is (Protomaps, or the raster
    // tiles' credit when the map falls back); no "Leaflet" prefix, for room.
    map.attributionControl.setPrefix(false)
    if (creditRef?.current) creditRef.current.append(map.attributionControl.getContainer())
    const removeBasemap = addBasemap(map)
    layers.current = { lines: L.layerGroup().addTo(map), pins: L.layerGroup().addTo(map), moving: L.layerGroup().addTo(map) }
    mapRef.current = map
    map.setView([30, 10], 2)
    // A new size (a phone turned): the same view, framed again.
    const refit = () => frame(map, sceneRef.current.focus, insetRef.current, false)
    map.on('resize', refit)
    return () => { map.off('resize', refit); removeBasemap(); map.remove(); mapRef.current = null }
  }, [insetRef, creditRef])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const { lines, pins, moving } = layers.current
    const still = reduced()
    const speed = speedRef.current || 1
    let cancelled = false
    const timers = []
    map.stop()
    moving.clearLayers()

    lines.clearLayers()
    for (const leg of scene.drawn) L.polyline(arcBetween(map, leg.from, leg.to), { className: 'story-line', weight: 3, interactive: false }).addTo(lines)
    pins.clearLayers()
    for (const pin of scene.pins) L.marker([pin.place.lat, pin.place.lon], { icon: pinIcon(pin), interactive: false, zIndexOffset: pin.current ? 500 : 0 }).addTo(pins)
    if (scene.photo) {
      const img = document.createElement('img')
      img.src = scene.photo.src
      img.alt = ''
      const shot = document.createElement('div')
      shot.className = 'story-shot'
      shot.append(img)
      L.marker([scene.photo.lat, scene.photo.lon], { icon: L.divIcon({ className: '', html: shot, iconSize: [48, 48], iconAnchor: [24, 24] }), interactive: false, zIndexOffset: 2000 }).addTo(pins)
    }

    const { leg } = scene
    if (!leg) {
      frame(map, scene.focus, insetRef.current, still ? false : scene.glide ? 'glide' : scene.animate, speed)
    } else if (still || !scene.animate) {
      L.polyline(arcBetween(map, leg.from, leg.to), { className: 'story-line', weight: 3, interactive: false }).addTo(moving)
      frame(map, scene.focus, insetRef.current, false)
    } else {
      // Out to both ends, then the journey drawn from its start.
      frame(map, scene.focus, insetRef.current, true, speed)
      const curve = arcBetween(map, leg.from, leg.to)
      const line = L.polyline([curve[0]], { className: 'story-line', weight: 3, interactive: false }).addTo(moving)
      const head = L.marker(curve[0], { icon: headIcon(leg.icon), interactive: false, zIndexOffset: 1000 }).addTo(moving)
      timers.push(setTimeout(() => {
        const t0 = performance.now()
        const step = now => {
          if (cancelled) return
          const t = ease(Math.min(1, (now - t0) / (DRAW_MS / speed)))
          const at = t * (curve.length - 1), i = Math.floor(at), f = at - i
          const a = curve[i], b = curve[Math.min(i + 1, curve.length - 1)]
          const tip = L.latLng(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f)
          line.setLatLngs([...curve.slice(0, i + 1), tip])
          head.setLatLng(tip)
          if (t < 1) requestAnimationFrame(step)
          else head.remove()
        }
        requestAnimationFrame(step)
      }, (FLY_S * 1000) / speed + 100))
    }
    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [scene, insetRef, speedRef])

  return <div ref={el} className="story-map-canvas" />
}

// How long a journey takes to show, for Play.
export const LEG_MS = FLY_S * 1000 + DRAW_MS + 1200
