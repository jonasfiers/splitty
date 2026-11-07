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

export const isOffline = () => navigator.onLine === false || unreachable

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
