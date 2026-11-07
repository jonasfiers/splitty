import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import { formatBytes } from '../utils/trip.js'

// A trip item's file (ticket, booking...) inside Splitty, for the installed
// app (utils/standalone.js): images as they are, PDFs drawn by pdf.js, with
// Splitty's header so there is always a way back, and a Download button for
// saving the file or opening it in another app. In a browser tab files still
// open in a new tab with the browser's own viewer.
//
// The file comes from the item's signed link (5 minutes, api/routes/trips.js),
// fetched fresh with the item, so a reload or a later visit works too.

// pages beyond this are left to Download: each page is a canvas of a few MB
const MAX_PAGES = 30

export default function FileViewerPage() {
  const { tripId, itemId, fileId } = useParams()
  const [item, setItem] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    client.get(`/trips/items/${itemId}`)
      .then(({ data }) => {
        if (!data.item.attachments.some(a => a.id === fileId)) setError('This file is no longer attached to the item.')
        setItem(data.item)
      })
      .catch(() => setError('Could not load this file. Go back and try again.'))
  }, [itemId, fileId])

  const file = item?.attachments.find(a => a.id === fileId)
  if (!item && !error) return <Loading />

  const download = async () => {
    try {
      // A fresh link: the one loaded with the page may have expired.
      const { data } = await client.get(`/trips/items/${itemId}`)
      const fresh = data.item.attachments.find(a => a.id === fileId)
      const res = await fetch(`/api${fresh.url}`)
      if (!res.ok) throw new Error()
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = fresh.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000)
    } catch {
      setError('Download failed. Try again.')
    }
  }

  return (
    <>
      <PageHeader
        compact
        crumbs={[
          { to: '/trips', label: 'Trips' },
          { to: `/trips/${tripId}`, label: item?.tripTitle || 'Trip' },
          { to: `/trips/${tripId}/items/${itemId}`, label: item?.title || 'Item' },
        ]}
        name={file?.filename || 'File'}
        actions={file ? [{ label: 'Download', onClick: download, primary: true }] : []}
      />
      {error && <p className="error">{error}</p>}
      {file && (
        <div className="file-viewer">
          <div className="file-viewer-meta">{file.filename} · {formatBytes(file.size)}</div>
          {file.mimeType === 'application/pdf'
            ? <PdfView url={`/api${file.url}`} onError={() => setError('This PDF could not be shown here. Use Download to open it in another app.')} />
            : <img className="file-viewer-page" src={`/api${file.url}`} alt={file.filename} />}
        </div>
      )}
    </>
  )
}

function PdfView({ url, onError }) {
  const box = useRef(null)
  const [state, setState] = useState({ loading: true, pages: 0, shown: 0 })

  useEffect(() => {
    let cancelled = false
    let task = null
    ;(async () => {
      try {
        const { loadPdf } = await import('../utils/pdf.js')
        task = await loadPdf(url)
        if (cancelled) { task.destroy(); return }
        const doc = await task.promise
        if (cancelled) return
        const shown = Math.min(doc.numPages, MAX_PAGES)
        setState({ loading: false, pages: doc.numPages, shown })
        const el = box.current
        // Sharp on the screen it is shown on: CSS width × device pixel ratio.
        const cssWidth = el.clientWidth
        const ratio = Math.min(window.devicePixelRatio || 1, 3)
        for (let n = 1; n <= shown && !cancelled; n++) {
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio })
          const canvas = document.createElement('canvas')
          canvas.className = 'file-viewer-page'
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`
          el.appendChild(canvas)
          await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, annotationMode: 0 }).promise
          page.cleanup()
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('PDF not shown:', err?.message || err)
          setState(s => ({ ...s, loading: false }))
          onError()
        }
      }
    })()
    return () => {
      cancelled = true
      task?.destroy()
      if (box.current) box.current.replaceChildren()
    }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {state.loading && <Loading />}
      <div ref={box} className="file-viewer-pages" />
      {state.pages > state.shown && (
        <p className="file-viewer-meta">Showing the first {state.shown} of {state.pages} pages. Use Download for the rest.</p>
      )}
    </>
  )
}
