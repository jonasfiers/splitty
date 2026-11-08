import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router'

// What is behind the current page in this tab's history, so "back" can really
// go back (and a form, once saved, can step out of the history) instead of
// pushing the parent page again on top: that made Android's back gesture
// return to a filled-in form, or bounce between a page and its parent.
//
// React Router keeps the entry's position in history.state.idx; we remember
// the path at each position. Entries from before a reload are unknown, and
// then the callers fall back to a normal navigation.
const paths = []

const idx = () => window.history.state?.idx ?? 0

export function useHistoryTracker() {
  const { pathname } = useLocation()
  const type = useNavigationType()
  useEffect(() => {
    const i = idx()
    if (type === 'PUSH') paths.length = i // forward entries are gone
    paths[i] = pathname
  }, [pathname, type])
}

// The path of the page behind this one, if known.
export const previousPath = () => paths[idx() - 1]

// Leave this page for `to` (a path): back through the history if that is
// where we came from, otherwise in place of this page. `state` (a notice)
// survives either way.
export function leaveTo(navigate, to, state) {
  if (previousPath() === to) {
    if (state) {
      window.addEventListener('popstate', () => navigate(to, { replace: true, state }), { once: true })
    }
    navigate(-1)
  } else {
    navigate(to, { replace: true, state })
  }
}
