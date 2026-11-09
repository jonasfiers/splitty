import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Loading from '../components/Loading.jsx'

// A page appears in one go instead of filling in piece by piece: its parts
// register the requests they make, and the page shows once all are done; but
// never later than MAX_WAIT_MS, so one slow extra (a count, a panel) can't
// hold the page back: past that the stragglers fill in as before.
//
// <PageGate>…the page's content…</PageGate>
//   Render it once the page's own data is in, so the parts that fetch are
//   there when it mounts: one that appears later is not waited for.
//   Inside it, a part that fetches does:  const gate = useGate();  gate(promise)
// waitAtMost(promise): for extras the page fetches itself, next to its main
//   request: Promise.all([main, waitAtMost(extra)]) waits for the extra, but
//   at most MAX_WAIT_MS, and never fails because of it.
export const MAX_WAIT_MS = 1500

const GateContext = createContext(null)

// The register function of the surrounding PageGate (a no-op outside one).
export function useGate() {
  return useContext(GateContext) ?? (p => p)
}

export function waitAtMost(promise, ms = MAX_WAIT_MS) {
  return Promise.race([Promise.resolve(promise).catch(() => {}), new Promise(r => setTimeout(r, ms))])
}

export function PageGate({ children }) {
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const pending = useRef(0)
  const mounted = useRef(false)

  const open = useCallback(() => { if (!readyRef.current) { readyRef.current = true; setReady(true) } }, [])
  const check = useCallback(() => { if (mounted.current && pending.current === 0) open() }, [open])

  // Stable, and does nothing once the page shows: later requests (a reload,
  // a tab opened) are no reason to hide it again.
  const register = useCallback(promise => {
    if (readyRef.current) return promise
    pending.current++
    Promise.resolve(promise).catch(() => {}).finally(() => { pending.current--; check() })
    return promise
  }, [check])

  // The parts' effects ran before this one (children first), so whatever they
  // registered on mounting is counted by now.
  useEffect(() => {
    mounted.current = true
    check()
    const timer = setTimeout(open, MAX_WAIT_MS)
    return () => clearTimeout(timer)
  }, [check, open])

  return (
    <GateContext.Provider value={register}>
      {!ready && <Loading />}
      {/* Laid out but invisible while waiting: maps and charts can measure themselves. */}
      <div className={ready ? 'page-gate' : 'page-gate waiting'} aria-busy={!ready}>{children}</div>
    </GateContext.Provider>
  )
}
