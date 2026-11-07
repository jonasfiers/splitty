import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import ZoomArea from '../components/FileViewer/ZoomArea.jsx'

// A trip item's file (ticket, booking...) full screen inside Splitty, for the
// installed app (utils/standalone.js): no sidebar, no bottom bar, only a slim
// bar ("‹ Back", the name, Download) over the document. Images as they are,
// PDFs drawn by pdf.js; Download saves the file or opens it in another app.
// In a browser tab files still open in a new tab with the browser's viewer.
// Its route sits outside the app's Layout (App.jsx) for the full screen.
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
  const navigate = useNavigate()
  const location = useLocation()
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

  // Back in history when the viewer was opened from the app, so the Back
  // button and Android's back gesture agree and do not pile up pages;
  // otherwise (a reload, an opened link) to the item, in place of the viewer.
  const back = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate(`/trips/${tripId}/items/${itemId}`, { replace: true })
  }

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
    <div className="file-viewer">
      <header className="file-viewer-bar">
        <button type="button" className="file-viewer-back" onClick={back}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
        <div className="file-viewer-name">{file?.filename ?? ''}</div>
        {file && <button type="button" className="file-viewer-action" onClick={download}>Download</button>}
      </header>
      {error && <p className="error file-viewer-error">{error}</p>}
      {!item && !error && <Loading />}
      {file && (
        <ZoomArea>
          {file.mimeType === 'application/pdf'
            ? <PdfView url={`/api${file.url}`} onError={() => setError('This PDF could not be shown here. Use Download to open it in another app.')} />
            : <img className="file-viewer-page" src={`/api${file.url}`} alt={file.filename} />}
        </ZoomArea>
      )}
    </div>
  )
}

function PdfView({ url, onError }) {
  const box = useRef(null)
  const [state, setState] = useState({ loading: true, pages: 0, shown: 0 })

  useEffect(() => {
    let cancelled = false
    let task = null
    let doc = null
    // React clears box.current before this effect's cleanup runs: keep it.
    const host = box.current
    // A canvas holds its pixels (6 MB a page here, ~50 MB zoomed in) until
    // the browser gets round to collecting it; on a phone, opening a ticket a
    // few times in a row then ran out of memory and slowed down. Emptying it
    // frees them at once.
    const release = canvas => { canvas.width = 0; canvas.height = 0 }
    let pass = 0          // a newer drawing pass stops an older one
    let drawnWidth = 0
    let timer = null

    // Draws every page for the box's current width, sharp on this screen
    // (CSS width × device pixel ratio). Each new canvas replaces the old one
    // only once drawn, so redrawing (a Fold unfolded, a window resized, a
    // phone turned) does not flash.
    const draw = async () => {
      const el = host
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
        if (cancelled || mine !== pass) { release(canvas); return }
        const old = el.children[n - 1]
        if (old) { old.replaceWith(canvas); release(old) }
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
        if (host) watch.observe(host)
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
      for (const canvas of host?.querySelectorAll('canvas') ?? []) release(canvas)
      host?.replaceChildren()
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
