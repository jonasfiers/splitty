import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { longestWaitMs } from '../utils/connection.js'
import { sincePageOpened } from '../utils/pageStart.js'
import { useOfflineTrips, keptLabel } from '../utils/useOfflineDocs.js'

// "Loading…". When a request to the server has been waiting more than 3 s
// (a weak or no connection: with a VPN, requests can wait for their whole
// time limit before failing), it says so, with the way to the documents kept
// on this device. Not for slow work on the phone itself (pdf.js starting):
// that is no request, so the plain text stays.
const SLOW_MS = 3000

// The cat, waiting, its tail swishing (index.css .loading-cat). Drawn here,
// not an <img>, so the tail can move.
function WaitingCat() {
  return (
    <svg className="loading-cat" viewBox="0 0 160 160" fill="none" aria-hidden="true">
      <ellipse cx="80" cy="140" rx="44" ry="7" fill="#8B6F5A" opacity=".18" />
      <path className="loading-cat-tail" d="M100 124 Q128 122 126 100 Q124 86 112 90" stroke="#E09415" strokeWidth="8" fill="none" strokeLinecap="round" />
      <ellipse cx="80" cy="108" rx="25" ry="27" fill="#F5A623" />
      <polygon points="61,58 64,39 75,53" fill="#F5A623" />
      <polygon points="85,53 96,39 99,58" fill="#F5A623" />
      <polygon points="64,56 66,45 73,53" fill="#F07167" />
      <polygon points="87,53 94,45 96,56" fill="#F07167" />
      <circle cx="80" cy="69" r="21" fill="#F5A623" />
      <path d="M70 68 Q73 71 76 68" stroke="#2C1A0E" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M84 68 Q87 71 90 68" stroke="#2C1A0E" strokeWidth="2" fill="none" strokeLinecap="round" />
      <ellipse cx="80" cy="75" rx="2" ry="1.4" fill="#F07167" />
      <line x1="60" y1="73" x2="72" y2="75" stroke="#2C1A0E" strokeWidth=".8" opacity=".4" />
      <line x1="60" y1="77" x2="72" y2="77" stroke="#2C1A0E" strokeWidth=".8" opacity=".4" />
      <line x1="88" y1="75" x2="100" y2="73" stroke="#2C1A0E" strokeWidth=".8" opacity=".4" />
      <line x1="88" y1="77" x2="100" y2="77" stroke="#2C1A0E" strokeWidth=".8" opacity=".4" />
      <ellipse cx="70" cy="133" rx="8" ry="6" fill="#E09415" />
      <ellipse cx="90" cy="133" rx="8" ry="6" fill="#E09415" />
    </svg>
  )
}

export default function Loading() {
  const [slow, setSlow] = useState(false)
  // The 0.4 s before it shows count from opening the page, not from this mount.
  const [delay] = useState(() => Math.max(0, 400 - sincePageOpened()))
  const kept = keptLabel(useOfflineTrips())

  useEffect(() => {
    const timer = setInterval(() => setSlow(longestWaitMs() > SLOW_MS), 500)
    return () => clearInterval(timer)
  }, [])

  return (
    // Shown only after a moment (index.css .loading): a quick load never
    // flashes it.
    <div className="empty-state loading" role="status" style={{ animationDelay: `${delay}ms` }}>
      <WaitingCat />
      <p className="loading-text">
        {slow ? 'Still trying to reach Splitty…' : 'Loading…'}
      </p>
      {slow && kept && (
        <Link to="/offline-documents" className="load-failed-docs">On this device: {kept} ›</Link>
      )}
    </div>
  )
}
