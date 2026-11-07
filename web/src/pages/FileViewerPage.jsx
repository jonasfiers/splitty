import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import ZoomArea from '../components/FileViewer/ZoomArea.jsx'
import { listOffline, offlineSrc } from '../utils/offlineDocs.js'

// A trip item's file (ticket, booking...) or a trip document (arrival card,
// passport copy...) full screen inside Splitty, for the
// installed app (utils/standalone.js): no sidebar, no bottom bar, only a slim
// bar ("‹ Back", the name, Download) over the document. Images as they are,
// PDFs drawn by pdf.js; Download saves the file or opens it in another app.
// In a browser tab files still open in a new tab with the browser's viewer.
// Its route sits outside the app's Layout (App.jsx) for the full screen.
//
// The file comes from its signed link (5 minutes, api/routes/trips.js),
// fetched fresh with the item or the trip's documents, so a reload or a
// later visit works too.

// pages beyond this are left to Download: each page is a canvas of a few MB
const MAX_PAGES = 30
// Canvas pixels for all pages together, and for one page: zoomed in 5× on a
// phone a page would be ~20 million pixels (80 MB). Beyond these the pages are
// drawn a little less sharp instead (iOS refuses canvases over ~16.7 Mpx).
const PIXEL_BUDGET = 24e6
const PAGE_PIXELS = 16e6

// Where the file comes from, each load returning the files with `src`, the
// address to read it from (fresh signed links for the server's):
//   /trips/:tripId/items/:itemId/files/:fileId   an item's attachment
//   /trips/:tripId/documents/:fileId             a trip document; without a
//                                                connection, the copy kept on
//                                                this device if there is one
//   /offline-documents/:fileId                   a document kept on this device
//                                                (works offline and signed out)
const fromServer = list => list.map(f => ({ ...f, src: `/api${f.url}` }))
const fromDevice = list => list.map(f => ({ ...f, src: offlineSrc(f.id) }))

function sourceOf(tripId, itemId) {
  if (itemId) return {
    load: async () => fromServer((await client.get(`/trips/items/${itemId}`)).data.item.attachments),
    page: `/trips/${tripId}/items/${itemId}`,
    gone: 'This file is no longer attached to the item.',
  }
  if (tripId) return {
    load: async () => {
      try {
        return fromServer((await client.get(`/trips/${tripId}/documents`)).data.documents)
      } catch (err) {
        if (err.response) throw err   // the server answered: no fallback
        return fromDevice(await listOffline())
      }
    },
    page: `/trips/${tripId}`,
    gone: 'This document was deleted, or is no longer shared with you.',
  }
  return {
    load: async () => fromDevice(await listOffline()),
    page: '/offline-documents',
    gone: 'This document is no longer kept on this device.',
  }
}

// QA only: a line at the bottom with how long each step took, and the step
// it is waiting in. For a viewer that sometimes hangs on a phone but never
// while the screen is being recorded: a screenshot then shows the step.
const SHOW_TIMINGS = window.location.hostname.startsWith('splitty-qa')

function useTimings() {
  const start = useRef(performance.now())
  const [steps, setSteps] = useState([])
  const [waiting, setWaiting] = useState('file list')
  const [, tick] = useState(0)
  const last = useRef(start.current)
  useEffect(() => {
    if (!SHOW_TIMINGS || !waiting) return
    const t = setInterval(() => tick(n => n + 1), 250)
    return () => clearInterval(t)
  }, [waiting])
  const mark = useRef((name, next) => {
    if (!SHOW_TIMINGS) return
    const now = performance.now()
    const ms = Math.round(now - last.current)
    last.current = now
    setSteps(list => [...list, `${name} ${ms}`])
    setWaiting(next)
  }).current
  const line = !SHOW_TIMINGS ? null
    : `${steps.join(' · ')}${waiting ? `${steps.length ? ' · ' : ''}waiting: ${waiting} ${Math.round((performance.now() - last.current) / 100) / 10}s` : ` · total ${Math.round(last.current - start.current)} ms`}`
  return { mark, line }
}

export default function FileViewerPage() {
  const { tripId, itemId, fileId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [files, setFiles] = useState(null)
  const [error, setError] = useState('')
  const source = sourceOf(tripId, itemId)
  const { mark, line } = useTimings()

  useEffect(() => {
    source.load()
      .then(list => {
        if (!list.some(a => a.id === fileId)) setError(source.gone)
        const f = list.find(a => a.id === fileId)
        mark('list', f ? (f.mimeType === 'application/pdf' ? 'pdf.js' : 'image') : null)
        setFiles(list)
      })
      .catch(() => setError('Could not load this file. Go back and try again.'))
  }, [tripId, itemId, fileId]) // eslint-disable-line react-hooks/exhaustive-deps

  const file = files?.find(a => a.id === fileId)

  // Back in history when the viewer was opened from the app, so the Back
  // button and Android's back gesture agree and do not pile up pages;
  // otherwise (a reload, an opened link) to the item or trip, in its place.
  const back = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate(source.page, { replace: true })
  }

  const download = async () => {
    try {
      // A fresh link: the one loaded with the page may have expired.
      const fresh = (await source.load()).find(a => a.id === fileId)
      const res = await fetch(fresh.src)
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
      {!files && !error && <Loading />}
      {file && (
        <ZoomArea>
          {file.mimeType === 'application/pdf'
            ? <PdfView url={file.src} mark={mark} onError={() => setError('This PDF could not be shown here. Use Download to open it in another app.')} />
            : <img className="file-viewer-page" src={file.src} alt={file.filename} onLoad={() => mark('image', null)} />}
        </ZoomArea>
      )}
      {line && <div className="file-viewer-timings">{line}</div>}
    </div>
  )
}

function PdfView({ url, onError, mark = () => {} }) {
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
    let drawn = false     // timings: only the first drawing counts

    // Draws every page for the box's current width, sharp on this screen
    // (CSS width × device pixel ratio). Each new canvas replaces the old one
    // only once drawn, so redrawing (a Fold unfolded, a window resized, a
    // phone turned) does not flash.
    const draw = async () => {
      const el = host
      const cssWidth = el?.clientWidth
      if (!doc || !cssWidth || cssWidth === drawnWidth) return
      drawnWidth = cssWidth
      const first = !drawn
      drawn = true
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
        if (first && n === 1) mark('page 1', shown > 1 ? 'other pages' : null)
        if (first && n === shown && shown > 1) mark('rest', null)
      }
    }

    const watch = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => draw().catch(() => {}), 200)
    })

    ;(async () => {
      try {
        const { loadPdf } = await import('../utils/pdf.js')
        mark('pdf.js', 'file')
        task = await loadPdf(url)
        mark('file', 'reading the PDF')
        if (cancelled) { task.destroy(); return }
        doc = await task.promise
        mark('read', 'page 1')
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
