// Trip documents kept on this device, to open without a connection (at a
// border, a gate, with roaming off). Stored in the browser's Cache Storage
// under /offline-docs/<id>, which the service worker (src/sw.js) answers
// from: a same-origin address, so the viewer, pdf.js and <img> load it like
// any file and the Content Security Policy needs nothing new.
//
//   /offline-docs/<id>         the file
//   /offline-docs/index.json   [{ id, filename, mimeType, size, tripId, tripTitle, savedAt }]
//
// Removed: by the user; when the document is no longer there for this user
// (deleted, made private by its owner) the next time the trip, its Documents
// page or the Offline documents page is opened online; and
// all of them on signing out or deleting the account (AuthContext.logout).
// Not on an expired session: the offline screen works signed out, so a trip's
// documents survive the session running out on the way.

const CACHE = 'splitty-offline-docs' // also src/sw.js
const INDEX = '/offline-docs/index.json'
const CHANGED = 'splitty-offline-docs-changed'

export const offlineSrc = id => `/offline-docs/${id}`
export const offlineSupported = () => typeof caches !== 'undefined' && 'serviceWorker' in navigator

const open = () => caches.open(CACHE)
async function readIndex(cache) {
  try { return (await (await cache.match(INDEX))?.json()) ?? [] } catch { return [] }
}
const writeIndex = (cache, list) =>
  cache.put(INDEX, new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }))
const changed = () => window.dispatchEvent(new Event(CHANGED))

// Calls `fn` whenever the kept documents change (in this tab). Returns the unsubscribe.
export function onOfflineDocsChange(fn) {
  window.addEventListener(CHANGED, fn)
  return () => window.removeEventListener(CHANGED, fn)
}

export async function listOffline() {
  if (!offlineSupported()) return []
  try { return await readIndex(await open()) } catch { return [] }
}

// doc: as from GET /trips/:id/documents (with its signed `url`).
export async function keepOffline(doc, trip) {
  const res = await fetch(`/api${doc.url}`, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const cache = await open()
  await cache.put(offlineSrc(doc.id), new Response(blob, {
    headers: { 'Content-Type': doc.mimeType, 'Content-Length': String(blob.size) },
  }))
  const list = (await readIndex(cache)).filter(d => d.id !== doc.id)
  list.push({
    id: doc.id, filename: doc.filename, mimeType: doc.mimeType, size: blob.size,
    tripId: trip.id, tripTitle: trip.title, savedAt: new Date().toISOString(),
  })
  await writeIndex(cache, list)
  // Ask the browser not to clear Splitty's storage when the phone runs low.
  navigator.storage?.persist?.().catch(() => {})
  changed()
}

export async function removeOffline(ids) {
  if (!offlineSupported() || !ids.length) return
  const cache = await open()
  await Promise.all(ids.map(id => cache.delete(offlineSrc(id))))
  await writeIndex(cache, (await readIndex(cache)).filter(d => !ids.includes(d.id)))
  changed()
}

// After loading a trip's documents online: drop kept copies of documents
// that are no longer there for this user, and refresh the trip's title.
export async function syncTrip(trip, currentIds) {
  if (!offlineSupported()) return
  const cache = await open()
  const list = await readIndex(cache)
  const gone = list.filter(d => d.tripId === trip.id && !currentIds.includes(d.id)).map(d => d.id)
  if (gone.length) await removeOffline(gone)
  else if (list.some(d => d.tripId === trip.id && d.tripTitle !== trip.title)) {
    await writeIndex(cache, list.map(d => (d.tripId === trip.id ? { ...d, tripTitle: trip.title } : d)))
    changed()
  }
}

// Asks the server which kept documents this user may still see, and drops
// the rest (deleted, or made private by their owner). Only when signed in and
// the server answers: offline, or with an expired session, nothing changes
// (and no redirect to the login page: a plain request, not the API client).
export async function pruneOffline() {
  const token = (() => { try { return localStorage.getItem('token') } catch { return null } })()
  const kept = await listOffline()
  if (!token || !kept.length) return
  try {
    const res = await fetch('/api/trips/documents/visible', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids: kept.map(d => d.id) }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return
    const visible = new Set((await res.json()).ids ?? [])
    const gone = kept.filter(d => !visible.has(d.id)).map(d => d.id)
    if (gone.length) await removeOffline(gone)
  } catch { /* no connection: keep them */ }
}

export async function clearOffline() {
  if (typeof caches === 'undefined') return
  try { await caches.delete(CACHE) } catch { /* nothing kept */ }
  changed()
}
