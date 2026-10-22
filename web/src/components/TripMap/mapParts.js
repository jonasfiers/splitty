import L from 'leaflet'

// The pieces both maps draw with — the trip map and the route finder's —
// so a journey looks the same on either: OpenStreetMap tiles, journeys as
// gentle arcs, and bare arrowheads along them showing the direction.

export function addTiles(map) {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)
}

// A gentle arc from `from` to `to` ({lat, lon}), bending to the right of its
// direction, so a trip out and back draws two separate lines. It is computed
// in Leaflet's zoom-0 pixel space; Web Mercator keeps angles, so an arrow's
// rotation along it is right at every zoom level.
export function arcBetween(map, from, to) {
  const a = map.project([from.lat, from.lon], 0), b = map.project([to.lat, to.lon], 0)
  const d = b.subtract(a)
  // Screen y points down, so (-dy, dx) is the right-hand side of travel.
  const control = a.add(b).divideBy(2).add(L.point(-d.y, d.x).multiplyBy(0.18))
  const at = t => a.multiplyBy((1 - t) ** 2).add(control.multiplyBy(2 * (1 - t) * t)).add(b.multiplyBy(t ** 2))
  return Array.from({ length: 33 }, (_, i) => map.unproject(at(i / 32), 0))
}

// Direction arrows along each journey: every ARROW_SPACING px on screen, kept
// ARROW_END_GAP px clear of the pins at both ends; a short journey gets one in
// the middle. Only arrows within ARROW_MARGIN px of the view are placed.
const ARROW_SPACING = 140
const ARROW_END_GAP = 28
const ARROW_MARGIN = 80
export const arrowIcon = angle => L.divIcon({
  className: '',
  html: `<div class="trip-leg"><svg viewBox="0 0 24 24" style="transform: rotate(${angle}deg)"><path d="M5 5 L20 12 L5 19 L9 12 Z" /></svg></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

// Points every `spacing` px along a polyline given in screen pixels, each with
// the direction of travel there (degrees, screen y pointing down).
function pointsAlong(pts, spacing, gap) {
  const segs = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const len = pts[i - 1].distanceTo(pts[i])
    segs.push({ a: pts[i - 1], b: pts[i], from: total, len })
    total += len
  }
  if (total === 0) return []
  const usable = total - 2 * gap
  const distances = usable < spacing
    ? [total / 2]
    : Array.from({ length: Math.floor(usable / spacing) + 1 }, (_, k) => gap + (usable % spacing) / 2 + k * spacing)
  return distances.map(dist => {
    const seg = segs.find(sg => dist <= sg.from + sg.len) ?? segs[segs.length - 1]
    const f = seg.len ? (dist - seg.from) / seg.len : 0
    return {
      point: seg.a.add(seg.b.subtract(seg.a).multiplyBy(f)),
      angle: (Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x) * 180) / Math.PI,
    }
  })
}

// Where the arrows along `curve` go at the map's current zoom and position:
// [{ latLng, angle }], only those in or near the view. Placed in screen
// pixels, so they are redone after every zoom, pan or resize.
export function arrowsAlong(map, curve) {
  const size = map.getSize()
  const inView = p => {
    const c = map.layerPointToContainerPoint(p)
    return c.x > -ARROW_MARGIN && c.y > -ARROW_MARGIN && c.x < size.x + ARROW_MARGIN && c.y < size.y + ARROW_MARGIN
  }
  const pts = curve.map(ll => map.latLngToLayerPoint(ll))
  return pointsAlong(pts, ARROW_SPACING, ARROW_END_GAP)
    .filter(({ point }) => inView(point))
    .map(({ point, angle }) => ({ latLng: map.layerPointToLatLng(point), angle }))
}

// Leaflet only measures its box once. When the box changes size (a full
// screen layout settling, the window resizing, a hidden map being shown) it
// is told so, and `frame` is applied again until the user has moved the map
// themselves. Returns the cleanup.
export function keepFramed(map, el, frame) {
  let moved = false
  for (const event of ['mousedown', 'touchstart', 'wheel']) el.addEventListener(event, () => { moved = true }, { once: true, passive: true })
  const resized = new ResizeObserver(() => {
    map.invalidateSize()
    if (!moved) frame()
  })
  resized.observe(el)
  return () => resized.disconnect()
}
