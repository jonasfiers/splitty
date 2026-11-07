import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import ZoomArea from '../components/FileViewer/ZoomArea.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'

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
// Canvas pixels for all pages together, and for one page: zoomed in 5× on a
// phone a page would be ~20 million pixels (80 MB). Beyond these the pages are
// drawn a little less sharp instead (iOS refuses canvases over ~16.7 Mpx).
const PIXEL_BUDGET = 24e6
const PAGE_PIXELS = 16e6

export default function FileViewerPage() {
  const { tripId, itemId, fileId } = useParams()
  const [item, setItem] = useState(null)
  const [error, setError] = useState('')
  const wide = useMediaQuery('(min-width: 768px)')

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
        // Phone: the bar ("‹ Back", the name, Download). Wider: a title row
        // with Download beside it, under "‹ Back".
        compact={!wide}
        // "‹ Back", not the item's title: a journey's title ("Brussels
        // National Airport → Schiphol Airport") wraps over three lines.
        back={{ to: `/trips/${tripId}/items/${itemId}` }}
        title={wide ? file?.filename : undefined}
        name={file?.filename || 'File'}
        actions={file ? [{ label: 'Download', onClick: download, primary: true }] : []}
      />
      {error && <p className="error">{error}</p>}
      {file && (
        <div className="file-viewer">
          <ZoomArea>
            {file.mimeType === 'application/pdf'
              ? <PdfView url={`/api${file.url}`} onError={() => setError('This PDF could not be shown here. Use Download to open it in another app.')} />
              : <img className="file-viewer-page" src={`/api${file.url}`} alt={file.filename} />}
          </ZoomArea>
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
    let doc = null
    let pass = 0          // a newer drawing pass stops an older one
    let drawnWidth = 0
    let timer = null

    // Draws every page for the box's current width, sharp on this screen
    // (CSS width × device pixel ratio). Each new canvas replaces the old one
    // only once drawn, so redrawing (a Fold unfolded, a window resized, a
    // phone turned) does not flash.
    const draw = async () => {
      const el = box.current
      const cssWidth = el?.clientWidth
      if (!doc || !cssWidth || cssWidth === drawnWidth) return
      drawnWidth = cssWidth
      const mine = ++pass
      const shown = Math.min(doc.numPages, MAX_PAGES)
      let ratio = Math.min(window.devicePixelRatio || 1, 3)
      // The budget, from the first page's shape (tickets' pages are alike).
      const first = (await doc.getPage(1)).getViewport({ scale: 1 })
      const pagePx = (cssWidth * ratio) ** 2 * (first.height / first.width)
      ratio *= Math.min(1, Math.sqrt(PIXEL_BUDGET / (pagePx * shown)), Math.sqrt(PAGE_PIXELS / pagePx))
      for (let n = 1; n <= shown; n++) {
        const page = await doc.getPage(n)
        if (cancelled || mine !== pass) return
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio })
        const canvas = document.createElement('canvas')
        canvas.className = 'file-viewer-page'
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, annotationMode: 0 }).promise
        page.cleanup()
        if (cancelled || mine !== pass) return
        const old = el.children[n - 1]
        if (old) old.replaceWith(canvas)
        else el.appendChild(canvas)
      }
    }

    const watch = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => draw().catch(() => {}), 200)
    })

    ;(async () => {
      try {
        const { loadPdf } = await import('../utils/pdf.js')
        task = await loadPdf(url)
        if (cancelled) { task.destroy(); return }
        doc = await task.promise
        if (cancelled) return
        setState({ loading: false, pages: doc.numPages, shown: Math.min(doc.numPages, MAX_PAGES) })
        await draw()
        if (box.current) watch.observe(box.current)
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
      clearTimeout(timer)
      watch.disconnect()
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
