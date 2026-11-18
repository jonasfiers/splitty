import client from '../api/client'

// Trip entry kinds → expense categories (api crudService TRIP_KIND_KEYS),
// set by admins under Admin → Trip categories. Two uses:
//
// - Colours: a kind takes its category's colour. Applied by pointing the
//   --kind-* CSS variables (index.css) at that colour's variables, so every
//   trip screen (timeline, day view, map, entry page) follows without knowing
//   about it, and a theme switch still works. An unlinked kind keeps the
//   fallback in index.css.
// - The category of an expense made from a trip entry (categoryFor).
//
// Kept on this device too, so trips kept for offline use keep their colours
// on a cold start without a connection. Losing it only means the fallback
// colours until the next load.
const STORE = 'splitty.tripKinds'
const KINDS = ['stay', 'transport', 'activity']
let links = {} // key -> { categoryId, colour, name }

// A kind's colour: its own category's, else the one colour its modes'
// categories share (transport linked only per mode), else none.
function colourOf(kind) {
  if (links[kind]?.colour) return links[kind].colour
  const modes = new Set(Object.entries(links).filter(([k]) => k.startsWith(`${kind}:`)).map(([, v]) => v.colour).filter(Boolean))
  return modes.size === 1 ? [...modes][0] : null
}

function apply() {
  const root = document.documentElement.style
  for (const kind of KINDS) {
    const c = colourOf(kind)
    if (c) {
      root.setProperty(`--kind-${kind}`, `var(--cat-${c})`)
      root.setProperty(`--kind-${kind}-bg`, `var(--tint-${c}-bg)`)
      root.setProperty(`--kind-${kind}-fg`, `var(--tint-${c}-fg)`)
    } else {
      for (const suffix of ['', '-bg', '-fg']) root.removeProperty(`--kind-${kind}${suffix}`)
    }
  }
}

export function setTripKinds(list) {
  links = Object.fromEntries((list || []).map(k => [k.key, k]))
  apply()
  try { localStorage.setItem(STORE, JSON.stringify(list || [])) } catch { /* this visit only */ }
}

// At start-up: the copy on this device at once, then the server's.
export function loadTripKinds() {
  try {
    const kept = JSON.parse(localStorage.getItem(STORE) || '[]')
    links = Object.fromEntries(kept.map(k => [k.key, k]))
    apply()
  } catch { /* none kept */ }
  return client.get('/categories/trip-kinds')
    .then(r => setTripKinds(r.data.kinds))
    .catch(() => { /* offline: keep what we have */ })
}

// The category an expense for this entry starts with: its transport mode's,
// else its kind's, else none.
export function categoryFor(item) {
  const mode = item?.kind === 'transport' && item.mode ? links[`transport:${item.mode}`] : null
  return (mode ?? links[item?.kind])?.categoryId ?? null
}
