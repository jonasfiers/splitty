import { useEffect } from 'react'
import { Link } from 'react-router'
import { isNetworkError, onReconnect, reportReachable } from '../utils/connection.js'
import { useOfflineDocs } from '../utils/useOfflineDocs.js'

// What a page shows when its data could not be loaded, instead of an empty
// state ("No groups yet", "You're all settled up!", "Trip not found") that
// would be untrue. Without a connection it says so, links to the documents
// kept on this device, and tries again by itself once the connection is back.
//
//   error    the failed request's error (axios)
//   what     what could not be loaded: "your groups", "this trip"...
//   onRetry  loads again
//   docs     link to the offline documents (default; off where the page has its own)
export default function LoadFailed({ error, what, onRetry, docs = true }) {
  const noConnection = isNetworkError(error)
  const kept = useOfflineDocs()

  useEffect(() => (noConnection ? onReconnect(onRetry) : undefined), [noConnection, onRetry])

  // The browser does not always say when the connection is back (with a VPN
  // it never thought it was gone), so ask the server quietly every 10 s; only
  // an answer reloads the page, so it does not flicker between loading and
  // failing meanwhile.
  useEffect(() => {
    if (!noConnection) return
    const probe = () => fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      .then(res => { if (res.ok) reportReachable(true) })
      .catch(() => {})
    const timer = setInterval(probe, 10000)
    return () => clearInterval(timer)
  }, [noConnection])

  return (
    <div className="empty-state load-failed" role="alert">
      <img src="/cat-empty.svg" alt="" />
      <p className="empty-state-title">{noConnection ? 'No connection' : `Couldn’t load ${what}`}</p>
      <p className="empty-state-sub">
        {noConnection
          ? `Splitty can’t reach its server right now, so ${what} can’t be shown. It tries again once you’re back online.`
          : 'Something went wrong on Splitty’s side. Try again in a moment.'}
      </p>
      <button className="btn btn-primary" onClick={onRetry}>Try again</button>
      {docs && noConnection && kept?.length > 0 && (
        <Link to="/offline-documents" className="load-failed-docs">Offline documents · {kept.length} ›</Link>
      )}
    </div>
  )
}
