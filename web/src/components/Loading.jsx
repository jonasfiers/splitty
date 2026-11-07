import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { longestWaitMs } from '../utils/connection.js'
import { useOfflineDocs } from '../utils/useOfflineDocs.js'

// "Loading…". When a request to the server has been waiting more than 3 s
// (a weak or no connection: with a VPN, requests can wait for their whole
// time limit before failing), it says so, with the way to the documents kept
// on this device. Not for slow work on the phone itself (pdf.js starting):
// that is no request, so the plain text stays.
const SLOW_MS = 3000

export default function Loading() {
  const [slow, setSlow] = useState(false)
  const kept = useOfflineDocs()

  useEffect(() => {
    const timer = setInterval(() => setSlow(longestWaitMs() > SLOW_MS), 500)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="empty-state">
      <p style={{ color: 'var(--text-3)', fontSize: 14 }}>
        {slow ? 'Still trying to reach Splitty…' : 'Loading…'}
      </p>
      {slow && kept?.length > 0 && (
        <Link to="/offline-documents" className="load-failed-docs">Offline documents · {kept.length} ›</Link>
      )}
    </div>
  )
}
