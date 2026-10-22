import { useContext, useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ExpandedContext } from '../Expandable/Expandable.jsx'
import { addTiles, arcBetween, arrowIcon, arrowsAlong, keepFramed } from '../TripMap/mapParts.js'
import { legIcon } from './ConnectionCard.jsx'

// A stop is where a vehicle is boarded or left; the same platform in several
// connections is one pin.
const stopKey = s => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`

// Stops numbered in the order a connection reaches them.
function journeyOrder(itinerary) {
  const order = new Map()
  for (const leg of itinerary.legs) {
    for (const key of [stopKey(leg.from), stopKey(leg.to)]) if (!order.has(key)) order.set(key, order.size + 1)
  }
  return order
}

// The connections of a route search, drawn like journeys on the trip map:
// stop to stop as arcs, from the stop positions the search already returned
// (no street or track geometry). Every connection is drawn faintly; the
// `highlight` one (an index) on top, with its stops numbered in journey order
// and arrows showing the direction. With nothing highlighted the stops are
// numbered in the order the list first reaches them.
//
// `onHover` / `onSelect` report the connection under the pointer or tapped, so
// the list can follow. `skip` (leg indexes, for a single connection) leaves
// those legs and the stops only they use off the map, keeping the numbering.
// Highlight and skip are applied without rebuilding the map.
function RouteMap({ itineraries, highlight = null, skip = null, onHover = () => {}, onSelect = () => {} }) {
  const el = useRef(null)
  const drawn = useRef(null) // { map, stops, lines, orders, globalOrder }
  const hover = useRef(onHover)
  hover.current = onHover
  const select = useRef(onSelect)
  select.current = onSelect
  const state = useRef({ highlight, skip })
  state.current = { highlight, skip }
  const expanded = useContext(ExpandedContext)

  useEffect(() => {
    if (!el.current || itineraries.length === 0) return

    const map = L.map(el.current, { scrollWheelZoom: expanded })
    if (!expanded) {
      map.on('click', () => map.scrollWheelZoom.enable())
      map.on('mouseout', () => map.scrollWheelZoom.disable())
    }
    addTiles(map)

    // A view first: Leaflet only draws the lines once the map has one.
    const bounds = L.latLngBounds(itineraries.flatMap(it => it.legs.flatMap(l => [[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]])))
    const frame = () => map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 })
    frame()

    const orders = itineraries.map(journeyOrder)
    const globalOrder = new Map()
    for (const order of orders) for (const key of order.keys()) if (!globalOrder.has(key)) globalOrder.set(key, globalOrder.size + 1)

    // Lines first, so the pins sit above them.
    const lines = []
    itineraries.forEach((it, i) => {
      it.legs.forEach((leg, n) => {
        if (stopKey(leg.from) === stopKey(leg.to)) return
        const curve = arcBetween(map, leg.from, leg.to)
        const line = L.polyline(curve, { color: '#E8603A', weight: 2.5, opacity: .6, dashArray: '6 7', interactive: false }).addTo(map)
        // A thin dashed line is hard to hit with a finger: an invisible wide
        // one on top takes the pointer.
        const hit = L.polyline(curve, { color: '#000', weight: 18, opacity: 0 }).addTo(map)
        hit.on('mouseover', () => hover.current(i))
        hit.on('mouseout', () => hover.current(null))
        hit.on('click', () => select.current(i))
        lines.push({ i, n, curve, line, hit, arrows: L.layerGroup().addTo(map) })
      })
    })

    const stops = new Map() // key -> { marker, conns: Set, legs: Set of `${i}:${n}` }
    itineraries.forEach((it, i) => {
      it.legs.forEach((leg, n) => {
        for (const [stop, icon] of [[leg.from, legIcon(leg)], [leg.to, legIcon(leg)]]) {
          const key = stopKey(stop)
          if (!stops.has(key)) {
            const marker = L.marker([stop.lat, stop.lon], {
              icon: L.divIcon({
                className: '',
                html: `<div class="trip-pin route-stop">${icon}<span class="trip-pin-n"></span></div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15],
              }),
              title: stop.name,
              interactive: false,
              keyboard: false,
            }).addTo(map)
            stops.set(key, { marker, conns: new Set(), legs: new Set() })
          }
          stops.get(key).conns.add(i)
          stops.get(key).legs.add(`${i}:${n}`)
        }
      })
    })

    drawn.current = { map, stops, lines, orders, globalOrder }
    const redraw = () => apply.current()
    map.on('zoomend moveend resize', redraw)

    redraw()
    const unframe = keepFramed(map, el.current, frame)

    return () => { unframe(); drawn.current = null; map.remove() }
  }, [itineraries, expanded])

  // Fading, numbering and arrows for the current highlight and skipped legs.
  const apply = useRef(() => {})
  apply.current = () => {
    const d = drawn.current
    if (!d) return
    const { highlight: h, skip: skipped } = state.current
    // A single connection (the confirm step) is always the highlighted one.
    const on = itineraries.length === 1 ? 0 : h
    const off = (i, n) => i === 0 && skipped?.includes(n)
    const order = on != null ? d.orders[on] : d.globalOrder

    for (const [key, { marker, conns, legs }] of d.stops) {
      const pin = marker.getElement()?.querySelector('.trip-pin')
      if (!pin) continue
      const hidden = [...legs].every(l => { const [i, n] = l.split(':').map(Number); return off(i, n) })
      const hit = on != null && conns.has(on)
      pin.classList.toggle('faded', on != null && !hit)
      pin.classList.toggle('route-stop-off', hidden)
      const number = pin.querySelector('.trip-pin-n')
      number.textContent = order.get(key) ?? ''
      number.style.display = order.has(key) && (on == null || hit) ? '' : 'none'
      marker.setZIndexOffset(hit ? 1000 : 0)
    }
    for (const { i, n, curve, line, hit, arrows } of d.lines) {
      const isOn = on === i
      const gone = off(i, n)
      line.setStyle({ opacity: gone ? 0 : on == null ? .6 : isOn ? .95 : .18, weight: isOn ? 4 : 2.5 })
      if (isOn) line.bringToFront()
      hit.setStyle({ weight: gone ? 0 : 18 })
      arrows.clearLayers()
      if (!isOn || gone) continue
      for (const { latLng, angle } of arrowsAlong(d.map, curve)) {
        arrows.addLayer(L.marker(latLng, { icon: arrowIcon(angle), interactive: false, keyboard: false, zIndexOffset: -100 }))
      }
    }
  }
  useEffect(() => { apply.current() }, [highlight, skip, itineraries])

  if (itineraries.length === 0) return null
  return <div ref={el} className="trip-map route-map" />
}

export default RouteMap
