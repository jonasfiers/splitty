// Trip files kept on this device, to open without a connection (at a border,
// a gate, with roaming off): trip documents and items' files (tickets,
// boarding passes). Stored in the browser's Cache Storage under
// /offline-docs/<id>, which the service worker (src/sw.js) answers from: a
// same-origin address, so the viewer, pdf.js and <img> load it like any file
// and the Content Security Policy needs nothing new.
//
//   /offline-docs/<id>         the file
//   /offline-docs/index.json   [{ id, filename, mimeType, size, tripId, tripTitle, savedAt,
//                                 kind: 'document' | 'attachment', itemId, itemTitle,
//                                 auto: fetched by itself (else kept by hand) }]
//
// Which: with the trips kept offline (utils/offlineTrips.js), every item file
// and your own documents of those trips come by themselves (syncFiles; not
// with the phone's data saver on). Documents others shared with the trip only
// when you keep one (the Documents page).
// Removed the same way as the trips: when the trip leaves the offline copy
// (over, deleted, no longer yours), when the file is deleted or no longer
// shared with you, all of them on signing out, deleting the account or
// switching "Keep trips offline" off. Not on an expired session: the offline
// screen works signed out, so a trip's files survive the session running out
// on the way.

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

// One change of the index at a time: a download in the background and a tap
// on "keep" must not write over each other's list.
let queue = Promise.resolve()
function withIndex(fn) {
  const run = queue.then(async () => {
    const cache = await open()
    const list = await readIndex(cache)
    const next = await fn(list, cache)
    if (next) await writeIndex(cache, next)
  })
  queue = run.catch(() => {})
  return run
}

// Calls `fn` whenever the kept files change (in this tab). Returns the unsubscribe.
export function onOfflineDocsChange(fn) {
  window.addEventListener(CHANGED, fn)
  return () => window.removeEventListener(CHANGED, fn)
}

export async function listOffline() {
  if (!offlineSupported()) return []
  try { return await readIndex(await open()) } catch { return [] }
}

// file: with its signed `url` (GET /trips/:id/documents, /trips/offline).
// meta: { kind, itemId, itemTitle, auto } (a document kept by hand without).
export async function keepOffline(file, trip, meta = {}) {
  const res = await fetch(`/api${file.url}`, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  await withIndex(async (list, cache) => {
    await cache.put(offlineSrc(file.id), new Response(blob, {
      headers: { 'Content-Type': file.mimeType, 'Content-Length': String(blob.size) },
    }))
    return [...list.filter(d => d.id !== file.id), {
      id: file.id, filename: file.filename, mimeType: file.mimeType, size: blob.size,
      tripId: trip.id, tripTitle: trip.title, savedAt: new Date().toISOString(),
      kind: meta.kind ?? 'document', itemId: meta.itemId ?? null, itemTitle: meta.itemTitle ?? null, auto: !!meta.auto,
    }]
  })
  // Ask the browser not to clear Splitty's storage when the phone runs low.
  navigator.storage?.persist?.().catch(() => {})
  changed()
}

export async function removeOffline(ids) {
  if (!offlineSupported() || !ids.length) return
  await withIndex(async (list, cache) => {
    await Promise.all(ids.map(id => cache.delete(offlineSrc(id))))
    return list.filter(d => !ids.includes(d.id))
  })
  changed()
}

// After loading a trip's documents online: drop kept copies of documents
// that are no longer there for this user, and refresh the trip's title.
// Items' files are left to syncFiles (they are not in that list).
export async function syncTrip(trip, currentIds) {
  if (!offlineSupported()) return
  const list = await listOffline()
  const gone = list.filter(d => d.tripId === trip.id && d.kind !== 'attachment' && !currentIds.includes(d.id)).map(d => d.id)
  if (gone.length) await removeOffline(gone)
  else if (list.some(d => d.tripId === trip.id && d.tripTitle !== trip.title)) {
    await withIndex(async l => l.map(d => (d.tripId === trip.id ? { ...d, tripTitle: trip.title } : d)))
    changed()
  }
}

// With the trips kept offline just fetched (GET /trips/offline, with file
// links): fetch the files that should come by themselves and aren't here yet,
// and remove every kept file that may no longer be here. One at a time, quiet
// on failure (the next round tries again). `stillWanted()`: false once the
// copy is wiped or someone else signed in meanwhile.
let syncing = null
export function syncFiles(trips, stillWanted = () => true) {
  if (!offlineSupported()) return Promise.resolve()
  if (syncing) return syncing
  syncing = (async () => {
    const allowed = new Map() // id -> { file, trip, meta }
    for (const t of trips) {
      const trip = { id: t.trip.id, title: t.trip.title }
      for (const item of t.items) {
        for (const a of item.attachments) allowed.set(a.id, { file: a, trip, meta: { kind: 'attachment', itemId: item.id, itemTitle: item.title, auto: true } })
      }
      for (const d of t.documents ?? []) allowed.set(d.id, { file: d, trip, meta: { kind: 'document', auto: !!d.mine } })
    }
    const kept = await listOffline()
    const gone = kept.filter(d => !allowed.has(d.id)).map(d => d.id)
    if (gone.length) await removeOffline(gone)
    // Titles that changed since.
    if (kept.some(d => { const a = allowed.get(d.id); return a && (a.trip.title !== d.tripTitle || (a.meta.itemTitle ?? null) !== (d.itemTitle ?? null)) })) {
      await withIndex(async l => l.map(d => {
        const a = allowed.get(d.id)
        return a ? { ...d, tripTitle: a.trip.title, itemTitle: a.meta.itemTitle ?? d.itemTitle ?? null } : d
      }))
      changed()
    }
    // The phone's data saver: nothing new is fetched (removing still is).
    if (navigator.connection?.saveData) return
    const have = new Set(kept.map(d => d.id))
    for (const { file, trip, meta } of allowed.values()) {
      if (!meta.auto || have.has(file.id)) continue
      if (!stillWanted() || navigator.onLine === false) return
      try { await keepOffline(file, trip, meta) } catch { /* next round */ }
    }
  })().catch(() => {}).finally(() => { syncing = null })
  return syncing
}

export async function clearOffline() {
  if (typeof caches === 'undefined') return
  try {
    await (queue = queue.then(() => caches.delete(CACHE)).catch(() => {}))
  } catch { /* nothing kept */ }
  changed()
}
