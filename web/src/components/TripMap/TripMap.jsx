import { useContext, useEffect, useRef, useState } from 'react'
import { dayOf, timeOf } from '../../utils/trip.js'
import { ExpandedContext } from '../Expandable/Expandable.jsx'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { itemIcon, linkTarget, mapsLink } from '../../utils/trip.js'
import { iconSvg } from '../../utils/icons.js'
import Icon from '../Icon/Icon.jsx'
import '../TripPhotos/TripPhotos.css'
import { addBasemap, arcBetween, arrowIcon, arrowsAlong, keepFramed, mapOptions } from './mapParts.js'

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

// The places that belong to `day`: everything on that day, both ends of a
// journey, and the hotel you are in (a stay counts from check-in to check-out).
function placesOn(items, day) {
  const ids = new Set()
  for (const item of items) {
    const from = dayOf(item.start), to = dayOf(item.end) || from
    if (!from || from > day || to < day) continue
    for (const id of [item.placeId, item.fromPlaceId, item.toPlaceId]) if (id) ids.add(id)
  }
  return ids
}

// The map is not stored anywhere: it is the trip's Place nodes that have
// coordinates, one pin per place however many items happen there, and a line
// for every transport whose two ends are both on the map.
//
// `highlight` (item ids) marks those items' pins and journeys and fades the
// rest; `onHover` reports the items under the pointer, so the timeline can do
// the same. Both are applied without rebuilding the map.
//
// `today` (a day, only while the trip is on) opens the map on that day's
// places instead of the whole trip, with a button to switch between the two.
//
// `photos` (TripPhotos.jsx, those with a location) are drawn as thumbnails,
// nearby ones bundled into one per PHOTO_CELL px at the current zoom; a tap
// calls `onOpenPhotos(list, index)`. They don't change the framing: the map
// stays on the plan.
const PHOTO_CELL = 56
const escapeAttr = v => String(v).replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c])
function TripMap({ places, items, onOpenItem, highlight = null, onHover = () => {}, today = null, photos = [], onOpenPhotos = null }) {
  const el = useRef(null)
  const pins = useRef(new Map())   // placeId -> { marker, itemIds }
  const lines = useRef(new Map())  // itemId -> { line, arrows (layer group) }
  const highlightRef = useRef(highlight)
  highlightRef.current = highlight
  const hover = useRef(onHover)
  hover.current = onHover
  const expanded = useContext(ExpandedContext)
  // 'today' or 'trip'; null when there is no today to choose (nothing of it on the map).
  const [framing, setFraming] = useState(null)
  const framingRef = useRef(null)
  const frameRef = useRef(() => {})
  const mapRef = useRef(null)
  const [mapGen, setMapGen] = useState(0) // bumped when the map is rebuilt, for the photo layer
  const [showPhotos, setShowPhotos] = useState(true)

  useEffect(() => {
    const located = places.filter(p => p.lat != null && p.lon != null)
    if (!el.current) return

    // In the page the wheel scrolls the page until the map is clicked; full
    // screen there is nothing else to scroll.
    const map = L.map(el.current, { ...mapOptions(), scrollWheelZoom: expanded })
    if (!expanded) {
      map.on('click', () => map.scrollWheelZoom.enable())
      map.on('mouseout', () => map.scrollWheelZoom.disable())
    }
    const removeBasemap = addBasemap(map)
    mapRef.current = map
    setMapGen(n => n + 1)

    const byId = new Map(located.map(p => [p.id, p]))
    const itemsAt = placeId => items.filter(i => [i.placeId, i.fromPlaceId, i.toPlaceId].includes(placeId))
    const order = visitOrder(items)
    const numbered = located.length > 1
    pins.current.clear()
    lines.current.clear()

    for (const place of located) {
      const here = itemsAt(place.id)
      // A hotel pin reads as a hotel. Otherwise the pin shows the items' icon,
      // or how many items there are when their icons differ.
      const stay = here.find(i => i.kind === 'stay')
      const icons = new Set(here.map(i => itemIcon(i)))
      // Its colour (index.css --kind-*): a stay's if there is one (like the
      // icon), else the items' kind when they share one, else neutral.
      const kinds = new Set(here.map(i => i.kind))
      const pinKind = stay ? 'stay' : kinds.size === 1 ? [...kinds][0] : kinds.size ? 'mixed' : ''
      const marker = L.marker([place.lat, place.lon], {
        icon: L.divIcon({
          className: '',
          html: `<div class="trip-pin${pinKind ? ` kind-${pinKind}` : ''}">${stay ? iconSvg(itemIcon(stay)) : icons.size === 1 ? iconSvg([...icons][0]) : here.length > 1 ? here.length : iconSvg('map-pin')}${numbered && order.has(place.id) ? `<span class="trip-pin-n">${order.get(place.id)}</span>` : ''}</div>`,
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
      const maps = mapsLink(place)
      const nav = document.createElement('a')
      nav.className = 'trip-popup-nav'
      nav.href = maps.url
      if (linkTarget(maps.url)) nav.target = linkTarget(maps.url)
      nav.rel = 'noopener noreferrer'
      nav.innerHTML = iconSvg('navigation', { size: 14 })
      nav.append(` ${maps.label}`)
      popup.append(nav)
      for (const item of here) {
        const link = document.createElement('button')
        link.type = 'button'
        link.innerHTML = iconSvg(itemIcon(item), { size: 14 })
        link.append(` ${item.title}`)
        link.onclick = () => onOpenItem(item)
        popup.append(link)
      }
      marker.bindPopup(popup)
      marker.on('mouseover', () => hover.current(here.map(i => i.id)))
      marker.on('mouseout', () => hover.current(null))
      pins.current.set(place.id, { marker, itemIds: here.map(i => i.id) })
    }

    // Each journey is a gentle arc with arrows along it (mapParts.js).
    const legs = items
      .filter(i => i.kind === 'transport' && byId.get(i.fromPlaceId) && byId.get(i.toPlaceId) && i.fromPlaceId !== i.toPlaceId)
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''))
    legs.forEach((item, n) => {
      const from = byId.get(item.fromPlaceId), to = byId.get(item.toPlaceId)
      const curve = arcBetween(map, from, to)
      const line = L.polyline(curve, { className: 'trip-line', weight: 2.5, opacity: .8, dashArray: '6 7' }).addTo(map)

      const arrows = L.layerGroup().addTo(map)
      const title = `${legs.length > 1 ? `${n + 1}. ` : ''}${item.title}: ${from.name} → ${to.name}`
      lines.current.set(item.id, { item, curve, line, arrows, title })
    })

    // Arrows are placed in screen pixels, so they are redone after every zoom
    // or pan (and resize); the highlight is reapplied to the new ones.
    const placeArrows = () => {
      for (const { item, curve, arrows, title } of lines.current.values()) {
        arrows.clearLayers()
        for (const { latLng, angle } of arrowsAlong(map, curve)) {
          const arrow = L.marker(latLng, { icon: arrowIcon(angle), title, zIndexOffset: -100 })
          arrow.on('click', () => onOpenItem(item))
          arrow.on('mouseover', () => hover.current([item.id]))
          arrow.on('mouseout', () => hover.current(null))
          arrows.addLayer(arrow)
        }
      }
      applyHighlight.current(highlightRef.current)
    }
    map.on('zoomend moveend resize', placeArrows)

    const fit = list => {
      // Nothing placed yet: the world, waiting for the first pin.
      if (!list.length) map.setView([30, 10], 2)
      else if (list.length === 1) map.setView([list[0].lat, list[0].lon], 13)
      else map.fitBounds(L.latLngBounds(list.map(p => [p.lat, p.lon])), { padding: [36, 36], maxZoom: 14 })
    }
    const todays = today ? located.filter(p => placesOn(items, today).has(p.id)) : []
    // Only worth a choice when today is a smaller view than the whole trip.
    const choice = todays.length > 0 && todays.length < located.length
    framingRef.current = choice ? (framingRef.current || 'today') : null
    setFraming(framingRef.current)
    const frame = () => fit(framingRef.current === 'today' ? todays : located)
    frameRef.current = frame
    frame()
    placeArrows()

    // Framed again whenever the box changes size, until the user moves the map.
    const unframe = keepFramed(map, el.current, frame)

    return () => { unframe(); removeBasemap(); mapRef.current = null; map.remove() }
  }, [places, items, onOpenItem, expanded, today])

  // Photos: their own layer, redrawn when the zoom changes (bundling is in
  // screen pixels), without touching the plan's pins and lines.
  const located = photos.filter(p => p.lat != null && p.lon != null)
  const openPhotos = useRef(onOpenPhotos)
  openPhotos.current = onOpenPhotos
  useEffect(() => {
    const map = mapRef.current
    if (!map || !showPhotos || located.length === 0) return
    const layer = L.layerGroup().addTo(map)
    const draw = () => {
      layer.clearLayers()
      const cells = new Map()
      for (const p of located) {
        const pt = map.project([p.lat, p.lon], map.getZoom())
        const key = `${Math.floor(pt.x / PHOTO_CELL)}:${Math.floor(pt.y / PHOTO_CELL)}`
        if (!cells.has(key)) cells.set(key, [])
        cells.get(key).push(p)
      }
      for (const group of cells.values()) {
        const first = group[0]
        const lat = group.reduce((t, p) => t + p.lat, 0) / group.length
        const lon = group.reduce((t, p) => t + p.lon, 0) / group.length
        const marker = L.marker([lat, lon], {
          icon: L.divIcon({
            className: '',
            html: `<div class="photo-pin"><img src="/api${escapeAttr(first.thumb)}" alt="" loading="lazy">${group.length > 1 ? `<span class="photo-pin-n">${group.length}</span>` : ''}</div>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20],
          }),
          zIndexOffset: -200,
          keyboard: true,
          title: `${group.length} photo${group.length !== 1 ? 's' : ''}`,
        })
        marker.on('click', () => openPhotos.current?.(group, 0))
        layer.addLayer(marker)
      }
    }
    draw()
    map.on('zoomend', draw)
    return () => { map.off('zoomend', draw); layer.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapGen, photos, showPhotos])

  const applyHighlight = useRef(() => {})
  applyHighlight.current = current => {
    const on = current?.length ? new Set(current) : null
    for (const { marker, itemIds } of pins.current.values()) {
      const pin = marker.getElement()?.querySelector('.trip-pin')
      const hit = on && itemIds.some(id => on.has(id))
      pin?.classList.toggle('active', !!hit)
      pin?.classList.toggle('faded', !!on && !hit)
      marker.setZIndexOffset(hit ? 1000 : 0)
    }
    for (const [itemId, { line, arrows }] of lines.current) {
      const hit = on?.has(itemId)
      line.setStyle({ opacity: on && !hit ? .25 : .9, weight: hit ? 4 : 2.5 })
      arrows.eachLayer(arrow => arrow.getElement()?.querySelector('.trip-leg')?.classList.toggle('faded', !!on && !hit))
    }
  }
  useEffect(() => { applyHighlight.current(highlight) }, [highlight, places, items])

  // An empty map is still a map: the places come with the first items.
  const empty = !places.some(p => p.lat != null && p.lon != null)
  return (
    <div className="trip-map-wrap">
      <div ref={el} className="trip-map" />
      {empty && <p className="trip-map-hint">Places you add show up here</p>}
      {located.length > 0 && (
        <button type="button" className="trip-map-photos" onClick={() => setShowPhotos(v => !v)} aria-pressed={showPhotos}>
          <Icon name="images" /> {showPhotos ? 'Hide photos' : `Show ${located.length} photo${located.length !== 1 ? 's' : ''}`}
        </button>
      )}
      {framing && (
        <button
          type="button"
          className="trip-map-frame"
          onClick={() => {
            framingRef.current = framing === 'today' ? 'trip' : 'today'
            setFraming(framingRef.current)
            frameRef.current()
          }}
        >
          {framing === 'today' ? 'Whole trip' : 'Today'}
        </button>
      )}
    </div>
  )
}

export default TripMap
