// QA timings for the file viewer (pages/FileViewerPage.jsx): the moment a
// file was tapped. A separate module, so the lists need not load the viewer.
export function markFileTap() {
  if (window.location.hostname.startsWith('splitty-qa')) window.__splittyFileTap = performance.now()
}
