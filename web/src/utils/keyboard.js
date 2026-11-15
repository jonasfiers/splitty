// iOS opens the keyboard only for a focus made inside the tap itself. A page
// whose first field appears after loading (the new-expense form) focuses it
// too late, so iOS leaves the keyboard shut while Android opens it. Called in
// the tap that opens such a page, this focuses a stand-in field at once (the
// keyboard opens) and lets the page's own autofocus take it over; iOS keeps
// the keyboard open when focus moves from field to field. The stand-in goes
// once focus has moved on, or after a few seconds if nothing takes it.
// Only on touch screens: with a mouse there is no on-screen keyboard.
const GIVE_UP_MS = 4000

export function openKeyboardNow({ inputMode = 'decimal' } = {}) {
  if (!globalThis.matchMedia?.('(pointer: coarse)').matches) return
  const stand = document.createElement('input')
  stand.setAttribute('aria-hidden', 'true')
  stand.tabIndex = -1
  stand.inputMode = inputMode // the same keyboard as the field it hands over to
  // 16px: smaller makes iOS zoom in. Off-screen but not display:none (that
  // can't take focus).
  Object.assign(stand.style, { position: 'fixed', top: '0', left: '-1000px', width: '1px', height: '1px', opacity: '0', fontSize: '16px' })
  document.body.appendChild(stand)
  stand.focus()
  const remove = () => { clearTimeout(timer); stand.removeEventListener('blur', remove); stand.remove() }
  stand.addEventListener('blur', remove)
  const timer = setTimeout(remove, GIVE_UP_MS)
}
