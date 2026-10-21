import { useEffect, useRef } from 'react'
import { dayOf, timeOf } from '../../utils/trip.js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { itemIcon } from '../../utils/trip.js'

// Places numbered in the order the trip reaches them: walk the items by start
// time and number each place the first time it comes up (a journey reaches its
// origin before its destination).
// A start without a time sorts like the timeline draws it: a stay from
// mid-afternoon, anything else from the start of the day.
const sortKey = item => (timeOf(item.start) ? item.start : `${dayOf(item.start)}T${item.kind === 'stay' ? '15:00' : '00:00'}`)

function visitOrder(items) {
  const order = new Map()
  const visit = id => { if (id && !order.has(id)) order.set(id, order.size + 1) }
  for (const item of [...items].filter(i => dayOf(i.start)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
    if (item.kind === 'transport') { visit(item.fromPlaceId); visit(item.toPlaceId) } else visit(item.placeId)
  }
  return order
}

// The map is not stored anywhere: it is the trip's Place nodes that have
// coordinates, one pin per place however many items happen there, and a line
// for every transport whose two ends are both on the map.
//
// `highlight` (item ids) marks those items' pins and journeys and fades the
// rest; `onHover` reports the items under the pointer, so the timeline can do
// the same. Both are applied without rebuilding the map.
function TripMap({ places, items, onOpenItem, highlight = null, onHover = () => {} }) {
  const el = useRef(null)
  const pins = useRef(new Map())   // placeId -> { marker, itemIds }
  const lines = useRef(new Map())  // itemId -> { line, arrow }
  const hover = useRef(onHover)
  hover.current = onHover

  useEffect(() => {
    const located = places.filter(p => p.lat != null && p.lon != null)
    if (!el.current || located.length === 0) return

    const map = L.map(el.current, { scrollWheelZoom: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)

    const byId = new Map(located.map(p => [p.id, p]))
    const itemsAt = placeId => items.filter(i => [i.placeId, i.fromPlaceId, i.toPlaceId].includes(placeId))
    const order = visitOrder(items)
    const numbered = located.length > 1
    pins.current.clear()
    lines.current.clear()

    for (const place of located) {
      const here = itemsAt(place.id)
      // A hotel pin reads as a hotel; anything else shows how much happens there.
      const stay = here.find(i => i.kind === 'stay')
      const marker = L.marker([place.lat, place.lon], {
        icon: L.divIcon({
          className: '',
          html: `<div class="trip-pin">${stay ? itemIcon(stay) : here.length > 1 ? here.length : here[0] ? itemIcon(here[0]) : '📍'}${numbered && order.has(place.id) ? `<span class="trip-pin-n">${order.get(place.id)}</span>` : ''}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
        title: place.name,
      }).addTo(map)

      // Built as DOM nodes, not an HTML string: names are user input.
      const popup = document.createElement('div')
      popup.className = 'trip-popup'
      const name = document.createElement('strong')
      name.textContent = place.name
      popup.append(name)
      for (const item of here) {
        const link = document.createElement('button')
        link.type = 'button'
        link.textContent = `${itemIcon(item)} ${item.title}`
        link.onclick = () => onOpenItem(item)
        popup.append(link)
      }
      marker.bindPopup(popup)
      marker.on('mouseover', () => hover.current(here.map(i => i.id)))
      marker.on('mouseout', () => hover.current(null))
      pins.current.set(place.id, { marker, itemIds: here.map(i => i.id) })
    }

    // Each journey is a gentle arc bending to the right of its direction, so a
    // trip out and back draws two separate lines, with an arrow at the middle.
    // The arc is computed in Leaflet's zoom-0 pixel space; Web Mercator keeps
    // angles, so the arrow's rotation is right at every zoom level.
    const legs = items
      .filter(i => i.kind === 'transport' && byId.get(i.fromPlaceId) && byId.get(i.toPlaceId) && i.fromPlaceId !== i.toPlaceId)
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''))
    legs.forEach((item, n) => {
      const from = byId.get(item.fromPlaceId), to = byId.get(item.toPlaceId)
      const a = map.project([from.lat, from.lon], 0), b = map.project([to.lat, to.lon], 0)
      const d = b.subtract(a)
      const length = Math.hypot(d.x, d.y)
      // Screen y points down, so (-dy, dx) is the right-hand side of travel.
      const control = a.add(b).divideBy(2).add(L.point(-d.y, d.x).multiplyBy(0.18))
      const at = t => a.multiplyBy((1 - t) ** 2).add(control.multiplyBy(2 * (1 - t) * t)).add(b.multiplyBy(t ** 2))
      const curve = Array.from({ length: 33 }, (_, i) => map.unproject(at(i / 32), 0))
      const line = L.polyline(curve, { color: '#E8603A', weight: 2.5, opacity: .8, dashArray: '6 7' }).addTo(map)

      // At t = 0.5 the curve's tangent is parallel to b - a.
      const angle = length ? (Math.atan2(d.y, d.x) * 180) / Math.PI : 0
      const arrow = L.marker(map.unproject(at(0.5), 0), {
        icon: L.divIcon({
          className: '',
          html: `<div class="trip-leg"><svg viewBox="0 0 24 24" style="transform: rotate(${angle}deg)"><path d="M5 12h13M13 6l6 6-6 6" /></svg></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
        title: `${legs.length > 1 ? `${n + 1}. ` : ''}${itemIcon(item)} ${item.title}: ${from.name} → ${to.name}`,
        zIndexOffset: -100,
      }).addTo(map)
      arrow.on('click', () => onOpenItem(item))
      arrow.on('mouseover', () => hover.current([item.id]))
      arrow.on('mouseout', () => hover.current(null))
      lines.current.set(item.id, { line, arrow })
    })

    const bounds = L.latLngBounds(located.map(p => [p.lat, p.lon]))
    if (located.length === 1) map.setView(bounds.getCenter(), 13)
    else map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 })

    return () => map.remove()
  }, [places, items, onOpenItem])

  useEffect(() => {
    const on = highlight?.length ? new Set(highlight) : null
    for (const { marker, itemIds } of pins.current.values()) {
      const pin = marker.getElement()?.querySelector('.trip-pin')
      const hit = on && itemIds.some(id => on.has(id))
      pin?.classList.toggle('active', !!hit)
      pin?.classList.toggle('faded', !!on && !hit)
      marker.setZIndexOffset(hit ? 1000 : 0)
    }
    for (const [itemId, { line, arrow }] of lines.current) {
      const hit = on?.has(itemId)
      line.setStyle({ opacity: on && !hit ? .25 : .9, weight: hit ? 4 : 2.5 })
      arrow.getElement()?.querySelector('.trip-leg')?.classList.toggle('faded', !!on && !hit)
    }
  }, [highlight, places, items])

  if (!places.some(p => p.lat != null && p.lon != null)) {
    return (
      <div className="empty-state" style={{ padding: '32px 24px' }}>
        <p style={{ color: 'var(--text-3)', fontSize: 14 }}>
          Nothing to show yet. Add a place to an item and pick it from the search results to put it on the map.
        </p>
      </div>
    )
  }

  return <div ref={el} className="trip-map" />
}

export default TripMap
