import { createContext, useCallback, useContext, useState } from 'react'
import Sheet from '../Sheet/Sheet.jsx'

// The app's "are you sure?": a sheet instead of the browser's own confirm()
// box, which looks foreign, cannot be styled and shows the site's address.
//
//   const confirm = useConfirm()
//   if (!(await confirm({ title: 'Delete this expense?', confirmLabel: 'Delete', danger: true }))) return
//
// Resolves true on the confirm button, false on Cancel, Escape, a tap outside
// or dragging the sheet away. One question at a time.
const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [ask, setAsk] = useState(null)
  const confirm = useCallback(options => new Promise(resolve => setAsk({ ...options, resolve })), [])
  const answer = ok => {
    ask?.resolve(ok)
    setAsk(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && (
        // Above everything else, full-screen views and other sheets included.
        <Sheet title={ask.title} onClose={() => answer(false)} zIndex={1200}>
          {ask.message && <p className="confirm-message">{ask.message}</p>}
          <div className="confirm-actions">
            <button type="button" className={`btn ${ask.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => answer(true)}>
              {ask.confirmLabel || 'OK'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => answer(false)}>Cancel</button>
          </div>
        </Sheet>
      )}
    </ConfirmContext.Provider>
  )
}

export const useConfirm = () => useContext(ConfirmContext)
