import { List, ListRow } from './List/List.jsx'
import { itemIcon } from '../utils/trip.js'
import Icon from './Icon/Icon.jsx'

// The map without a connection (no map tiles): the trip's places as a list,
// in the order they are first visited, each opening the first item there.
export default function OfflinePlaces({ places, items, onOpenItem }) {
  const firstAt = new Map()
  for (const item of [...items].sort((a, b) => String(a.start ?? '').localeCompare(String(b.start ?? '')))) {
    for (const placeId of [item.fromPlaceId, item.placeId, item.toPlaceId]) {
      if (placeId && !firstAt.has(placeId)) firstAt.set(placeId, item)
    }
  }
  const ordered = [...places].sort((a, b) => {
    const ia = firstAt.get(a.id), ib = firstAt.get(b.id)
    if (!ia || !ib) return ia ? -1 : ib ? 1 : a.name.localeCompare(b.name)
    return String(ia.start ?? '').localeCompare(String(ib.start ?? ''))
  })

  return (
    <>
      <p className="field-note">The map needs a connection. The trip's places:</p>
      {ordered.length === 0 ? (
        <p className="field-note">No places in this trip.</p>
      ) : (
        <List>
          {ordered.map(p => {
            const item = firstAt.get(p.id)
            return (
              <ListRow
                key={p.id}
                icon={<Icon name={item ? itemIcon(item) : 'map-pin'} />}
                title={p.name}
                meta={p.address || undefined}
                {...(item && { onClick: () => onOpenItem(item), chevron: true })}
              />
            )
          })}
        </List>
      )}
    </>
  )
}
