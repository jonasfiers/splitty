import client from '../api/client'
import { today } from './trip.js'
import { isOffline } from './connection.js'
import { syncFiles, clearOffline } from './offlineDocs.js'

// The trips kept on this device, to read without a connection (their files:
// utils/offlineDocs.js, fetched after each refresh here): the trip page
// and its items open from here when the server can't be reached (on the
// plane, at a border, abroad without data). Read-only: nothing is changed
// offline, and nothing waits to be sent.
//
// IndexedDB 'splitty-offline':
//   meta    'owner' -> { userId }        whose copy it is
//   trips   trip id -> { id, savedAt, trip, places, items, documents }
//           as GET /trips/:id answers, each item also with its `expenses`
//           and `attachments`, and the trip's documents as GET
//           /trips/:id/documents (no file links; GET /trips/offline in the API)
//
// Which trips: those not over yet, ended in the last 3 days, or undated (the
// API decides). Refreshed while online: on signing in, on opening the app or
// coming back to it (at most every 2 minutes), when the connection returns,
// and shortly after any change you make. A trip no longer in the answer
// (over, deleted, no longer yours to see) is removed.
// Wiped: on signing out or deleting the account, when someone else signs in
// on this device, and when "Keep trips on this device" is turned off
// (Profile). Not on an expired session, like the offline documents.

const DB = 'splitty-offline'
const VERSION = 1
const CHANGED = 'splitty-offline-trips-changed'
const SETTING = 'splitty.keepTrips'
const MIN_INTERVAL_MS = 2 * 60 * 1000
const AFTER_CHANGE_MS = 5000

export const offlineTripsSupported = () => typeof indexedDB !== 'undefined'

export function keepTripsEnabled() {
  try { return localStorage.getItem(SETTING) !== 'off' } catch { return true }
}
export async function setKeepTrips(on) {
  try { localStorage.setItem(SETTING, on ? 'on' : 'off') } catch { /* this visit only */ }
  if (on) await syncOfflineTrips({ force: true })
  else await Promise.all([clearOfflineTrips(), clearOffline()]) // the trips and their files
}

// Whose token is in use, from the token itself (no request).
function currentUserId() {
  try { return JSON.parse(atob(localStorage.getItem('token').split('.')[1])).id ?? null } catch { return null }
}

let dbPromise = null
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
        if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => { db.close(); dbPromise = null }
        resolve(db)
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('blocked'))
    }).catch(err => { dbPromise = null; throw err })
  }
  return dbPromise
}

// Runs `fn(stores)` in one transaction; resolves with what fn returned once
// it is committed.
async function tx(mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(['meta', 'trips'], mode)
    let result
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
    result = fn({ meta: t.objectStore('meta'), trips: t.objectStore('trips') })
  })
}
const asPromise = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })

const changed = () => window.dispatchEvent(new Event(CHANGED))
export function onOfflineTripsChange(fn) {
  window.addEventListener(CHANGED, fn)
  return () => window.removeEventListener(CHANGED, fn)
}

// The copy only for the user it was made for.
async function ownedBy(userId) {
  const db = await openDb()
  const owner = await asPromise(db.transaction('meta').objectStore('meta').get('owner'))
  return !!userId && owner?.userId === userId
}

// One trip as kept: { id, savedAt, trip, places, items }, or null.
export async function getOfflineTrip(id) {
  if (!offlineTripsSupported() || !keepTripsEnabled()) return null
  try {
    if (!(await ownedBy(currentUserId()))) return null
    const db = await openDb()
    return (await asPromise(db.transaction('trips').objectStore('trips').get(id))) ?? null
  } catch { return null }
}

// One item as the item page takes it (GET /trips/items/:id's shape), from
// its trip's copy; null if it isn't kept.
export async function getOfflineItem(tripId, itemId) {
  const kept = await getOfflineTrip(tripId)
  const item = kept?.items.find(i => i.id === itemId)
  if (!item) return null
  const place = id => kept.places.find(p => p.id === id) ?? null
  return {
    savedAt: kept.savedAt,
    item: {
      ...item,
      place: place(item.placeId),
      from: place(item.fromPlaceId),
      to: place(item.toPlaceId),
      tripId, tripTitle: kept.trip.title,
      groupId: kept.trip.groupId, groupIso: kept.trip.groupIso,
    },
  }
}

// What the Offline page lists: [{ id, title, icon, startDate, endDate, savedAt }].
export async function listOfflineTrips() {
  if (!offlineTripsSupported() || !keepTripsEnabled()) return []
  try {
    if (!(await ownedBy(currentUserId()))) return []
    const db = await openDb()
    const all = await asPromise(db.transaction('trips').objectStore('trips').getAll())
    return all
      .map(({ id, savedAt, trip }) => ({ id, savedAt, title: trip.title, icon: trip.icon, startDate: trip.startDate, endDate: trip.endDate }))
      .sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999'))
  } catch { return [] }
}

export async function clearOfflineTrips() {
  if (!offlineTripsSupported()) return
  try {
    await tx('readwrite', ({ meta, trips }) => { meta.clear(); trips.clear() })
  } catch { /* nothing kept, or storage unavailable */ }
  changed()
}

// Fetches the copy and replaces what is kept. `force`: also within the
// 2 minutes since the last one. Quiet on failure: the old copy stays.
let lastSync = 0
let running = null
export function syncOfflineTrips({ force = false } = {}) {
  if (!offlineTripsSupported() || !keepTripsEnabled() || isOffline()) return Promise.resolve()
  const userId = currentUserId()
  if (!userId) return Promise.resolve()
  if (running) return running
  if (!force && Date.now() - lastSync < MIN_INTERVAL_MS) return Promise.resolve()
  lastSync = Date.now()
  running = (async () => {
    const { data } = await client.get('/trips/offline', { params: { today: today() } })
    // Signed out, or someone else signed in, while it was on its way.
    if (currentUserId() !== userId || !keepTripsEnabled()) return
    const savedAt = new Date().toISOString()
    await tx('readwrite', ({ meta, trips }) => {
      const owner = meta.get('owner')
      owner.onsuccess = () => {
        if (owner.result?.userId !== userId) trips.clear() // someone else's copy
        meta.put({ userId }, 'owner')
        const keep = new Set(data.trips.map(t => t.trip.id))
        const keys = trips.getAllKeys()
        keys.onsuccess = () => {
          for (const k of keys.result) if (!keep.has(k)) trips.delete(k)
          // The file links in it expire in minutes: not kept (files open from
          // the device's copy, utils/offlineDocs.js).
          for (const t of data.trips) {
            const items = t.items.map(i => ({ ...i, attachments: i.attachments.map(({ url, ...a }) => a) }))
            const documents = (t.documents ?? []).map(({ url, ...d }) => d)
            trips.put({ id: t.trip.id, savedAt, trip: t.trip, places: t.places, items, documents })
          }
        }
      }
    })
    // Ask the browser not to clear Splitty's storage when the phone runs low.
    navigator.storage?.persist?.().catch(() => {})
    changed()
    // Their files: fetched in the background, after the plans are saved.
    syncFiles(data.trips, () => currentUserId() === userId && keepTripsEnabled())
  })().catch(() => {}).finally(() => { running = null })
  return running
}

// After a change you made (a save, a delete, a bar moved): refresh the copy
// a few seconds later, once for a burst of changes.
let pendingTimer = null
client.interceptors.response.use(res => {
  const method = (res.config?.method || 'get').toLowerCase()
  if (method !== 'get' && !String(res.config?.url || '').startsWith('/auth/')) {
    clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => syncOfflineTrips({ force: true }), AFTER_CHANGE_MS)
  }
  return res
})

// "as of today 14:32" / "as of 12 Nov, 14:32"
export function asOf(savedAt) {
  const d = new Date(savedAt)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? `as of today ${time}` : `as of ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`
}
