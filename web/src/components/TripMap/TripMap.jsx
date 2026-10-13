import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { itemIcon } from '../../utils/trip.js'

// The map is not stored anywhere: it is the trip's Place nodes that have
// coordinates, one pin per place however many items happen there, and a line
// for every transport whose two ends are both on the map.
function TripMap({ places, items, onOpenItem }) {
  const el = useRef(null)

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

    for (const place of located) {
      const here = itemsAt(place.id)
      // A hotel pin reads as a hotel; anything else shows how much happens there.
      const stay = here.find(i => i.kind === 'stay')
      const marker = L.marker([place.lat, place.lon], {
        icon: L.divIcon({
          className: '',
          html: `<div class="trip-pin">${stay ? itemIcon(stay) : here.length > 1 ? here.length : here[0] ? itemIcon(here[0]) : '📍'}</div>`,
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
    }

    for (const item of items) {
      const from = byId.get(item.fromPlaceId), to = byId.get(item.toPlaceId)
      if (item.kind === 'transport' && from && to) {
        L.polyline([[from.lat, from.lon], [to.lat, to.lon]], { color: '#E8603A', weight: 2.5, opacity: .8, dashArray: '6 7' }).addTo(map)
      }
    }

    const bounds = L.latLngBounds(located.map(p => [p.lat, p.lon]))
    if (located.length === 1) map.setView(bounds.getCenter(), 13)
    else map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 })

    return () => map.remove()
  }, [places, items, onOpenItem])

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
