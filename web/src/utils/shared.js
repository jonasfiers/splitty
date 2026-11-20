// Files shared into Splitty from another app (2026-11-20): Android's share
// sheet hands them to the service worker (manifest share_target, POST
// /share-target in sw.js), which keeps them in a cache until the share page
// (pages/SharePage.jsx) has put them on a trip item.
const SHARED = 'splitty-shared' // also sw.js

// The kept files, as File objects in the order shared ([] when none).
export async function loadShared() {
  if (typeof caches === 'undefined') return []
  const cache = await caches.open(SHARED)
  const keys = (await cache.keys()).sort((a, b) => Number(a.url.split('/').pop()) - Number(b.url.split('/').pop()))
  const files = []
  for (const key of keys) {
    const res = await cache.match(key)
    if (!res) continue
    const name = decodeURIComponent(res.headers.get('X-Name') || 'file')
    files.push(new File([await res.blob()], name, { type: res.headers.get('Content-Type') || '' }))
  }
  return files
}

export const clearShared = () => (typeof caches === 'undefined' ? Promise.resolve() : caches.delete(SHARED))

// What the share page chose for a new item ({ tickets, files }): the item form
// (?shared=1) fills in the tickets and attaches the files once saved. In
// memory: it only lives across the in-app navigation; cleared once saved.
let pending = null
export const setPendingShare = share => { pending = share }
export const getPendingShare = () => pending
export const donePendingShare = () => { pending = null; return clearShared() }
