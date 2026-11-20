// Reload onto a new version of Splitty (2026-11-20). The service worker takes
// over as soon as a new build is installed (sw.js: skipWaiting + claim), but a
// page that is already open keeps running the old code while the new build
// serves the files. Mixing the two once showed icon names as text. So: once a
// new worker has taken over, the app reloads the next time it comes back to
// the foreground, when a reload goes unnoticed. Not while something is being
// typed or picked, so nothing gets lost; it then waits for the next time.
// Coming back is also when Splitty asks for a new version, since an installed
// app that stays open in the background would otherwise rarely look.

const UPDATE_EVERY = 10 * 60 * 1000 // the most often it asks for a new version

// Pages where a reload could lose what someone is filling in.
const BUSY_PAGES = [/\/new$/, /\/edit$/, /^\/share$/, /^\/register$/, /^\/login$/, /^\/forgot-password$/, /^\/reset-password$/]

function busy() {
  if (BUSY_PAGES.some(p => p.test(location.pathname))) return true
  if (document.querySelector('[aria-modal="true"]')) return true // a sheet, the scanner, a photo
  const el = document.activeElement
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function reloadOnUpdate() {
  const sw = navigator.serviceWorker
  if (!sw) return
  // On a first visit the worker takes control of a page it didn't serve: that
  // page is already the new build, so no reload.
  let hadController = !!sw.controller
  let updated = false
  let lastCheck = Date.now()

  sw.addEventListener('controllerchange', () => {
    if (hadController) updated = true
    hadController = true
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (updated && !busy()) {
      location.reload()
      return
    }
    if (Date.now() - lastCheck > UPDATE_EVERY) {
      lastCheck = Date.now()
      sw.getRegistration().then(r => r?.update()).catch(() => {})
    }
  })
}
