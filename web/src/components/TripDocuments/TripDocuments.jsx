import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router'
import client from '../../api/client'
import { isStandalone } from '../../utils/standalone.js'
import { formatBytes } from '../../utils/trip.js'
import './TripDocuments.css'

// A trip's travel documents: arrival cards, visas, insurance, passport copies.
// Files of the trip as a whole, not of one item (api: tripService "DOCUMENTS").
// Each is private to whoever added it ("Only you") unless they share it with
// everyone on the trip; only they can share, unshare or delete it. They open
// like item files: Splitty's viewer in the installed app, a new tab in a
// browser.
//
// Links are signed for 5 minutes: refreshed while the page is open and on
// coming back to it, as on the item page.
export default function TripDocuments({ tripId }) {
  const navigate = useNavigate()
  const standalone = useMemo(isStandalone, [])
  const [documents, setDocuments] = useState(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(null)
  const fileInput = useRef(null)
  const loadedAt = useRef(0)

  const load = useCallback(async () => {
    const { data } = await client.get(`/trips/${tripId}/documents`)
    setDocuments(data.documents)
    loadedAt.current = Date.now()
  }, [tripId])

  useEffect(() => {
    load().catch(() => setDocuments([]))
    const refresh = () => { if (document.visibilityState === 'visible') load().catch(() => {}) }
    const timer = setInterval(refresh, 4 * 60 * 1000)
    const onVisible = () => { if (Date.now() - loadedAt.current > 60 * 1000) refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  // As on the item page: with a PDF here, fetch the viewer and pdf.js while
  // the phone is idle, so opening it is instant.
  const hasPdf = !!documents?.some(d => d.mimeType === 'application/pdf')
  useEffect(() => {
    if (!standalone || !hasPdf) return
    const idle = window.requestIdleCallback ?? (fn => setTimeout(fn, 1500))
    const cancel = window.cancelIdleCallback ?? clearTimeout
    const handle = idle(() => {
      import('../../pages/FileViewerPage.jsx').catch(() => {})
      import('../../utils/pdf.js').then(m => m.warmUp()).catch(() => {})
    })
    return () => cancel(handle)
  }, [standalone, hasPdf])

  const upload = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || uploading) return
    setError('')
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      await client.post(`/trips/${tripId}/documents`, body) // private until shared
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const setShared = async (doc, shared) => {
    if (shared && !window.confirm(`Share “${doc.filename}” with everyone on this trip?`)) return
    setBusy(doc.id)
    try {
      await client.patch(`/trips/documents/${doc.id}`, { shared })
      await load()
    } catch {
      setError('Could not change who sees it.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async doc => {
    if (!window.confirm(`Delete “${doc.filename}”?`)) return
    setBusy(doc.id)
    try {
      await client.delete(`/trips/documents/${doc.id}`)
      await load()
    } catch {
      setError('Failed to delete the document.')
    } finally {
      setBusy(null)
    }
  }

  const who = doc => {
    if (!doc.shared) return '🔒 Only you'
    return doc.mine ? 'Shared with the trip' : `Shared by ${doc.ownerName}`
  }

  return (
    <section className="trip-docs">
      <div className="section-label">Documents{documents?.length ? ` · ${documents.length}` : ''}</div>
      {error && <p className="error">{error}</p>}
      {documents?.length > 0 && (
        <div className="expense-list">
          {documents.map(doc => {
            const viewer = `/trips/${tripId}/documents/${doc.id}`
            return (
              <a
                key={doc.id}
                className="expense-item"
                href={standalone ? viewer : `/api${doc.url}`}
                {...(standalone
                  ? { onClick: event => { event.preventDefault(); navigate(viewer) } }
                  : { target: '_blank', rel: 'noopener noreferrer' })}
              >
                <div className="expense-icon">{doc.mimeType === 'application/pdf' ? '📄' : '🖼️'}</div>
                <div className="expense-info">
                  <div className="expense-name">{doc.filename}</div>
                  <div className="expense-meta">{who(doc)} · {formatBytes(doc.size)}</div>
                </div>
                {doc.mine && (
                  <div className="trip-docs-actions">
                    <button
                      type="button"
                      className={`trip-docs-icon${doc.shared ? ' on' : ''}`}
                      disabled={busy === doc.id}
                      aria-pressed={doc.shared}
                      aria-label={doc.shared ? `Make “${doc.filename}” private` : `Share “${doc.filename}” with the trip`}
                      title={doc.shared ? 'Shared with the trip · tap to make private' : 'Only you · tap to share with the trip'}
                      onClick={event => { event.preventDefault(); event.stopPropagation(); setShared(doc, !doc.shared) }}
                    >
                      <PeopleIcon />
                    </button>
                    <button
                      type="button"
                      className="trip-docs-icon danger"
                      disabled={busy === doc.id}
                      aria-label={`Delete “${doc.filename}”`}
                      title="Delete"
                      onClick={event => { event.preventDefault(); event.stopPropagation(); remove(doc) }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )}
              </a>
            )
          })}
        </div>
      )}
      <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={upload} />
      <button className="btn-pill-outline trip-docs-add" onClick={() => fileInput.current?.click()} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Add a document'}
      </button>
      <p className="trip-docs-hint">
        Arrival cards, visas, insurance, a copy of your passport. Only you see what you add, until you share it with the trip.
      </p>
    </section>
  )
}

// Line icons in the style of the navigation's (Layout.jsx).
function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.6a3.2 3.2 0 010 6.3" />
      <path d="M18 14.3c1.8.8 3 2.7 3 4.9" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="4 7 20 7" />
      <path d="M9 7V4.8c0-.4.4-.8.8-.8h4.4c.4 0 .8.4.8.8V7" />
      <path d="M6 7l1 12.2c.1 1 .9 1.8 1.9 1.8h6.2c1 0 1.8-.8 1.9-1.8L18 7" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}
