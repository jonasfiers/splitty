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
// focus: [{ lat, lon }] (what to frame) }. A leg: { id, from, to, icon }.
// `insetRef.current`: { top, bottom }, px kept free for the panels over the
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
function frame(map, focus, inset, animate) {
  if (!focus.length) return
  const { top = 0, bottom = 0 } = inset || {}
  const bounds = focus.length === 1
    ? L.latLng(focus[0].lat, focus[0].lon).toBounds(2500)
    : L.latLngBounds(focus.map(p => [p.lat, p.lon]))
  const opts = { paddingTopLeft: [40, 40 + top], paddingBottomRight: [40, 40 + bottom], maxZoom: focus.length === 1 ? 14 : 13 }
  if (animate) map.flyToBounds(bounds, { ...opts, duration: FLY_S })
  else map.fitBounds(bounds, { ...opts, animate: false })
}

export default function StoryMap({ scene, insetRef }) {
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
    map.attributionControl.setPosition('bottomleft')
    const removeBasemap = addBasemap(map)
    layers.current = { lines: L.layerGroup().addTo(map), pins: L.layerGroup().addTo(map), moving: L.layerGroup().addTo(map) }
    mapRef.current = map
    map.setView([30, 10], 2)
    // A new size (a phone turned): the same view, framed again.
    const refit = () => frame(map, sceneRef.current.focus, insetRef.current, false)
    map.on('resize', refit)
    return () => { map.off('resize', refit); removeBasemap(); map.remove(); mapRef.current = null }
  }, [insetRef])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const { lines, pins, moving } = layers.current
    const still = reduced()
    let cancelled = false
    const timers = []
    map.stop()
    moving.clearLayers()

    lines.clearLayers()
    for (const leg of scene.drawn) L.polyline(arcBetween(map, leg.from, leg.to), { className: 'story-line', weight: 3, interactive: false }).addTo(lines)
    pins.clearLayers()
    for (const pin of scene.pins) L.marker([pin.place.lat, pin.place.lon], { icon: pinIcon(pin), interactive: false, zIndexOffset: pin.current ? 500 : 0 }).addTo(pins)

    const { leg } = scene
    if (!leg) {
      frame(map, scene.focus, insetRef.current, !still && scene.animate)
    } else if (still || !scene.animate) {
      L.polyline(arcBetween(map, leg.from, leg.to), { className: 'story-line', weight: 3, interactive: false }).addTo(moving)
      frame(map, scene.focus, insetRef.current, false)
    } else {
      // Out to both ends, then the journey drawn from its start.
      frame(map, scene.focus, insetRef.current, true)
      const curve = arcBetween(map, leg.from, leg.to)
      const line = L.polyline([curve[0]], { className: 'story-line', weight: 3, interactive: false }).addTo(moving)
      const head = L.marker(curve[0], { icon: headIcon(leg.icon), interactive: false, zIndexOffset: 1000 }).addTo(moving)
      timers.push(setTimeout(() => {
        const t0 = performance.now()
        const step = now => {
          if (cancelled) return
          const t = ease(Math.min(1, (now - t0) / DRAW_MS))
          const at = t * (curve.length - 1), i = Math.floor(at), f = at - i
          const a = curve[i], b = curve[Math.min(i + 1, curve.length - 1)]
          const tip = L.latLng(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f)
          line.setLatLngs([...curve.slice(0, i + 1), tip])
          head.setLatLng(tip)
          if (t < 1) requestAnimationFrame(step)
          else head.remove()
        }
        requestAnimationFrame(step)
      }, FLY_S * 1000 + 100))
    }
    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [scene, insetRef])

  return <div ref={el} className="story-map-canvas" />
}

// How long a journey takes to show, for Play.
export const LEG_MS = FLY_S * 1000 + DRAW_MS + 1200
