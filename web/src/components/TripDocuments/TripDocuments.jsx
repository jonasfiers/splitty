import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { ListRow } from '../List/List.jsx'
import client from '../../api/client'
import { isStandalone } from '../../utils/standalone.js'
import { formatBytes } from '../../utils/trip.js'
import { keepOffline, removeOffline, syncTrip, offlineSupported } from '../../utils/offlineDocs.js'
import { useOfflineDocs } from '../../utils/useOfflineDocs.js'
import './TripDocuments.css'
import { useConfirm } from '../Confirm/ConfirmProvider.jsx'

// A trip's travel documents: arrival cards, visas, insurance, passport copies
// (on their own page, pages/TripDocumentsPage, from the trip's Documents chip).
// Files of the trip as a whole, not of one item (api: tripService "DOCUMENTS").
// Each is private to whoever added it ("Only you") unless they share it with
// everyone on the trip; only they can share, unshare or delete it. They open
// like item files: Splitty's viewer in the installed app, a new tab in a
// browser.
//
// Any of them can be kept on this device to open without a connection
// (utils/offlineDocs.js, the Offline documents page).
//
// Links are signed for 5 minutes: refreshed while the page is open and on
// coming back to it, as on the item page.
export default function TripDocuments({ tripId, tripTitle, heading = true }) {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const standalone = useMemo(isStandalone, [])
  const [documents, setDocuments] = useState(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(null)
  const fileInput = useRef(null)
  const loadedAt = useRef(0)

  const offline = useOfflineDocs()
  const kept = useMemo(() => new Set((offline ?? []).map(d => d.id)), [offline])
  const canKeep = useMemo(offlineSupported, [])

  const load = useCallback(async () => {
    const { data } = await client.get(`/trips/${tripId}/documents`)
    setDocuments(data.documents)
    loadedAt.current = Date.now()
    // Kept copies of documents that are gone (deleted, made private) go too.
    syncTrip({ id: tripId, title: tripTitle }, data.documents.map(d => d.id)).catch(() => {})
  }, [tripId, tripTitle])

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
      await client.post(`/trips/${tripId}/documents`, body, { timeout: 120000 }) // private until shared
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const setShared = async (doc, shared) => {
    if (shared && !(await confirm({ title: `Share “${doc.filename}”?`, message: 'Everyone on this trip can then see and download it.', confirmLabel: 'Share' }))) return
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

  const toggleOffline = async doc => {
    setBusy(doc.id)
    setError('')
    try {
      if (kept.has(doc.id)) await removeOffline([doc.id])
      else await keepOffline(doc, { id: tripId, title: tripTitle })
    } catch {
      setError('Could not keep it on this device. Is there room left on the phone?')
    } finally {
      setBusy(null)
    }
  }

  const remove = async doc => {
    if (!(await confirm({ title: `Delete “${doc.filename}”?`, confirmLabel: 'Delete', danger: true }))) return
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
    const base = !doc.shared ? '🔒 Only you' : doc.mine ? 'Shared with the trip' : `Shared by ${doc.ownerName}`
    return kept.has(doc.id) ? `${base} · on this device` : base
  }

  return (
    <section className="trip-docs">
      {heading && <div className="section-label">Documents{documents?.length ? ` · ${documents.length}` : ''}</div>}
      {error && <p className="error">{error}</p>}
      {documents?.length > 0 && (
        <div className="list">
          {documents.map(doc => {
            const viewer = `/trips/${tripId}/documents/${doc.id}`
            return (
              <ListRow
                key={doc.id}
                href={standalone ? viewer : `/api${doc.url}`}
                {...(standalone
                  ? { onClick: event => { event.preventDefault(); navigate(viewer) } }
                  : { target: '_blank', rel: 'noopener noreferrer' })}
                icon={doc.mimeType === 'application/pdf' ? '📄' : '🖼️'}
                title={doc.filename}
                meta={<>{who(doc)} · {formatBytes(doc.size)}</>}
                end={
                  <div className="trip-docs-actions">
                    {canKeep && (
                      <button
                        type="button"
                        className={`trip-docs-icon${kept.has(doc.id) ? ' on' : ''}`}
                        disabled={busy === doc.id}
                        aria-pressed={kept.has(doc.id)}
                        aria-label={kept.has(doc.id) ? `Remove “${doc.filename}” from this device` : `Keep “${doc.filename}” on this device`}
                        title={kept.has(doc.id) ? 'On this device, opens offline · tap to remove' : 'Keep on this device, to open offline'}
                        onClick={() => { toggleOffline(doc) }}
                      >
                        {kept.has(doc.id) ? <OnDeviceIcon /> : <KeepIcon />}
                      </button>
                    )}
                    {doc.mine && (<>
                      <button
                        type="button"
                        className={`trip-docs-icon${doc.shared ? ' on' : ''}`}
                        disabled={busy === doc.id}
                        aria-pressed={doc.shared}
                        aria-label={doc.shared ? `Make “${doc.filename}” private` : `Share “${doc.filename}” with the trip`}
                        title={doc.shared ? 'Shared with the trip · tap to make private' : 'Only you · tap to share with the trip'}
                        onClick={() => { setShared(doc, !doc.shared) }}
                      >
                        <PeopleIcon />
                      </button>
                      <button
                        type="button"
                        className="trip-docs-icon danger"
                        disabled={busy === doc.id}
                        aria-label={`Delete “${doc.filename}”`}
                        title="Delete"
                        onClick={() => { remove(doc) }}
                      >
                        <TrashIcon />
                      </button>
                    </>)}
                  </div>
                }
              />
            )
          })}
        </div>
      )}
      <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={upload} />
      <button className="btn btn-secondary trip-docs-add" onClick={() => fileInput.current?.click()} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Add a document'}
      </button>
      <p className="trip-docs-hint">
        Arrival cards, visas, insurance, a copy of your passport. Only you see what you add, until you share it with the trip.
        {canKeep && ' Keep one on this device to open it without a connection, under Trips › Offline documents.'}
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

// Arrow into a tray: keep on this device.
function KeepIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11" />
      <polyline points="7.5 10.5 12 15 16.5 10.5" />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
    </svg>
  )
}

// Tick in a tray: kept on this device.
function OnDeviceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="7.5 10 10.5 13 16.5 7" />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
    </svg>
  )
}
