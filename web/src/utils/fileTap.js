// QA timings for the file viewer (pages/FileViewerPage.jsx): the moment a
// file was tapped. A separate module, so the lists need not load the viewer.
export function markFileTap() {
  let on = window.location.hostname.startsWith('splitty-qa')
  try { on ||= localStorage.getItem('splitty-timings') === '1' } catch { /* private mode */ }
  if (!on) return
  window.__splittyFileTap = performance.now()
  const path = window.location.pathname
  window.__splittyFileTapFrom = path.startsWith('/offline-documents') ? 'offline list'
    : /\/items\//.test(path) ? 'item page' : /^\/trips\/[^/]+$/.test(path) ? 'trip page' : path
}
