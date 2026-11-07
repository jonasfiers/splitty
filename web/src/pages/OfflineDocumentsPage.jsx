import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../context/AuthContext'
import Loading from '../components/Loading.jsx'
import { removeOffline, pruneOffline } from '../utils/offlineDocs.js'
import { useOfflineDocs } from '../utils/useOfflineDocs.js'
import { formatBytes } from '../utils/trip.js'
import '../components/TripDocuments/TripDocuments.css'

// The trip documents kept on this device (utils/offlineDocs.js), grouped by
// trip. Works without a connection and without being signed in (an expired
// session must not lock you out of your arrival card at the border), so it
// sits outside the sign-in guard; signing out removes the documents anyway.
// Each opens in the full-screen viewer from the device's copy.
export default function OfflineDocumentsPage() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const docs = useOfflineDocs()
  const [busy, setBusy] = useState(null)

  const trips = useMemo(() => {
    const byTrip = new Map()
    for (const d of docs ?? []) {
      if (!byTrip.has(d.tripId)) byTrip.set(d.tripId, { id: d.tripId, title: d.tripTitle, docs: [] })
      byTrip.get(d.tripId).docs.push(d)
    }
    for (const t of byTrip.values()) t.docs.sort((a, b) => a.filename.localeCompare(b.filename))
    return [...byTrip.values()].sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  }, [docs])

  // Online and signed in: drop copies of documents that were deleted or made
  // private since they were kept.
  useEffect(() => { pruneOffline() }, [])

  // As on the trip page: with a PDF here, load the viewer and pdf.js while
  // the phone is idle, so opening one does not wait for them.
  const hasPdf = !!docs?.some(d => d.mimeType === 'application/pdf')
  useEffect(() => {
    if (!hasPdf) return
    const idle = window.requestIdleCallback ?? (fn => setTimeout(fn, 1500))
    const cancel = window.cancelIdleCallback ?? clearTimeout
    const handle = idle(() => {
      import('./FileViewerPage.jsx').catch(() => {})
      import('../utils/pdf.js').then(m => m.warmUp()).catch(() => {})
    })
    return () => cancel(handle)
  }, [hasPdf])

  const remove = async doc => {
    if (!window.confirm(`Remove “${doc.filename}” from this device? It stays in the trip.`)) return
    setBusy(doc.id)
    try { await removeOffline([doc.id]) } finally { setBusy(null) }
  }

  return (
    <div className="privacy-page">
      <article className="privacy offline-docs">
        <Link to={token ? '/trips' : '/login'} className="privacy-back">‹ {token ? 'Trips' : 'Sign in'}</Link>
        <h1>Offline documents</h1>
        <p className="privacy-updated">
          On this device only. They open without a connection, also when you are signed out.
          Signing out removes them.
        </p>

        {docs === null && <Loading />}
        {docs?.length === 0 && (
          <p>
            Nothing kept on this device yet. Open a trip, and under Documents tap the arrow next to one
            to keep it here.
          </p>
        )}

        {trips.map(trip => (
          <section key={trip.id} className="offline-docs-trip">
            <div className="section-label">{trip.title || 'Trip'}</div>
            <div className="expense-list">
              {trip.docs.map(doc => (
                <a
                  key={doc.id}
                  className="expense-item"
                  href={`/offline-documents/${doc.id}`}
                  onClick={event => { event.preventDefault(); navigate(`/offline-documents/${doc.id}`) }}
                >
                  <div className="expense-icon">{doc.mimeType === 'application/pdf' ? '📄' : '🖼️'}</div>
                  <div className="expense-info">
                    <div className="expense-name">{doc.filename}</div>
                    <div className="expense-meta">{formatBytes(doc.size)}</div>
                  </div>
                  <button
                    type="button"
                    className="trip-docs-icon danger"
                    disabled={busy === doc.id}
                    aria-label={`Remove “${doc.filename}” from this device`}
                    title="Remove from this device"
                    onClick={event => { event.preventDefault(); event.stopPropagation(); remove(doc) }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <line x1="6" y1="6" x2="18" y2="18" />
                      <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                  </button>
                </a>
              ))}
            </div>
          </section>
        ))}
      </article>
    </div>
  )
}
