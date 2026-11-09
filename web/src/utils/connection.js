import { useEffect, useState } from 'react'

// Whether Splitty can reach its server, for the offline bar (Layout) and the
// "couldn't load" state (components/LoadFailed). The browser's own
// navigator.onLine is not enough: with a VPN in airplane mode it stays true
// while every request goes nowhere. So the API client also reports: a
// request without an answer marks the server unreachable, any answer marks
// it reachable again (api/client.js).
let unreachable = false
const CHANGED = 'splitty-connection-changed'

export function reportReachable(ok) {
  if (unreachable === !ok) return
  unreachable = !ok
  window.dispatchEvent(new Event(CHANGED))
}

// One request without an answer is not yet "offline": it may be a one-off
// hiccup. Ask the server's health check (a few seconds at most); only when
// that gets no answer either is the server marked unreachable.
let probing = null
export function suspectUnreachable() {
  if (unreachable || probing) return
  probing = fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    .then(res => { if (res) reportReachable(true) })
    .catch(() => reportReachable(false))
    .finally(() => { probing = null })
}

export const isOffline = () => navigator.onLine === false || unreachable
export const isUnreachable = () => unreachable

// Requests to the server still waiting for an answer (api/client.js), so the
// loading indicator can say when one takes long (components/Loading).
const pending = new Map()
let nextId = 0
export function requestStarted() { const id = ++nextId; pending.set(id, performance.now()); return id }
export function requestEnded(id) { pending.delete(id) }
export function longestWaitMs() {
  let oldest = Infinity
  for (const t of pending.values()) oldest = Math.min(oldest, t)
  return oldest === Infinity ? 0 : performance.now() - oldest
}

// A failed request that never got an answer from the server.
export const isNetworkError = err => !!err && !err.response && err.code !== 'ERR_CANCELED'

export function useOffline() {
  const [offline, setOffline] = useState(isOffline)
  useEffect(() => {
    const update = () => setOffline(isOffline())
    const events = ['online', 'offline', CHANGED]
    events.forEach(e => window.addEventListener(e, update))
    return () => events.forEach(e => window.removeEventListener(e, update))
  }, [])
  return offline
}

// Calls `fn` when the connection comes back (the browser's online event,
// or the server answering again).
export function onReconnect(fn) {
  const handler = () => { if (!isOffline()) fn() }
  window.addEventListener('online', handler)
  window.addEventListener(CHANGED, handler)
  return () => { window.removeEventListener('online', handler); window.removeEventListener(CHANGED, handler) }
}
